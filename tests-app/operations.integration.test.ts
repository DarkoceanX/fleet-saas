import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { Pool } from "pg";
import { isolatedDatabaseUrl } from "./test-database";
import { calculateCost } from "@fleet/shared";
import { hashPassword } from "../apps/api/src/password";
test("stage 2: upgrade, driver isolation, lifecycle and financial integrity", async (t) => {
  process.env.DATABASE_URL = isolatedDatabaseUrl();
  const admin = new Pool({ connectionString: process.env.DATABASE_URL });
  const schema = `fleet_test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.toString();
  process.env.SESSION_SECRET = "stage2-integration-secret-for-tests-000000";
  process.env.APP_BASE_URL = "http://localhost:3000";
  const pool = new Pool({ connectionString: url.toString() });
  const require = createRequire(
    resolve("tests-app/operations.integration.test.ts"),
  );
  const { createApp } = require("../apps/api/dist/app.js") as {
    createApp: () => Promise<import("@nestjs/common").INestApplication>;
  };
  const app = await createApp();
  try {
    await pool.query(await readFile("migrations/001_initial.sql", "utf8"));
    const tenantA = randomUUID(),
      tenantB = randomUUID(),
      ownerA = randomUUID(),
      ownerB = randomUUID(),
      viewer = randomUUID(),
      dispatcher = randomUUID(),
      accountant = randomUUID();
    const password = "Stage2Synthetic123!",
      hash = await hashPassword(password);
    await pool.query(
      "INSERT INTO organizations(id,name) VALUES($1,$2),($3,$4)",
      [tenantA, "Synthetic A", tenantB, "Synthetic B"],
    );
    for (const [uid, email, tenant, role] of [
      [ownerA, "a@stage2.demo", tenantA, "owner"],
      [ownerB, "b@stage2.demo", tenantB, "owner"],
      [viewer, "viewer@stage2.demo", tenantA, "viewer"],
      [dispatcher, "dispatcher@stage2.demo", tenantA, "dispatcher"],
      [accountant, "accountant@stage2.demo", tenantA, "accountant"],
    ]) {
      await pool.query(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)",
        [uid, email, role, hash],
      );
      await pool.query(
        "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)",
        [tenant, uid, role],
      );
    }
    const oldVehicle = randomUUID(),
      oldTrip = randomUUID(),
      oldEstimate = randomUUID();
    const input = JSON.parse(await readFile("examples/trip-cost.json", "utf8"));
    const result = calculateCost(input);
    await pool.query(
      "INSERT INTO vehicles(id,tenant_id,name,plate) VALUES($1,$2,$3,$4)",
      [oldVehicle, tenantA, "Legacy vehicle", "LEGACY"],
    );
    await pool.query(
      "INSERT INTO trips(id,tenant_id,vehicle_id,origin,destination,departure_date) VALUES($1,$2,$3,$4,$5,$6)",
      [
        oldTrip,
        tenantA,
        oldVehicle,
        "Legacy origin",
        "Legacy destination",
        "2026-10-24",
      ],
    );
    await pool.query(
      "INSERT INTO cost_estimates(id,tenant_id,trip_id,currency,calculation_version,tariff_version,input_snapshot,result,total,created_by) VALUES($1,$2,$3,'RUB','1','manual-v1',$4,$5,$6,$7)",
      [
        oldEstimate,
        tenantA,
        oldTrip,
        JSON.stringify(input),
        JSON.stringify(result),
        result.total,
        ownerA,
      ],
    );
    await t.test(
      "migration upgrades stage 1 without changing historical calculations",
      async () => {
        await pool.query("BEGIN");
        await pool.query(
          await readFile("migrations/002_operations.sql", "utf8"),
        );
        await pool.query("COMMIT");
        await pool.query(
          await readFile("migrations/003_vehicle_period.sql", "utf8"),
        );
        await pool.query(
          await readFile("migrations/004_recognized_income.sql", "utf8"),
        );
        const old = await pool.query(
          "SELECT * FROM cost_estimates WHERE id=$1",
          [oldEstimate],
        );
        assert.deepEqual(old.rows[0].input_snapshot, input);
        assert.deepEqual(old.rows[0].result, result);
        assert.equal(old.rows[0].assignment_snapshot, null);
        assert.equal(old.rows[0].assignment_version, null);
        assert.equal(
          (
            await pool.query("SELECT status,driver_id FROM trips WHERE id=$1", [
              oldTrip,
            ])
          ).rows[0].status,
          "draft",
        );
      },
    );
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    async function request(
      path: string,
      method = "GET",
      body?: unknown,
      cookie = "",
      key: string = randomUUID(),
    ) {
      const response = await fetch(`${base}/api/v1${path}`, {
        method,
        headers: {
          Origin: "http://localhost:3000",
          Cookie: cookie,
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return {
        status: response.status,
        data: await response.json(),
        cookie: response.headers.get("set-cookie")?.split(";")[0] || "",
      };
    }
    async function login(email: string) {
      const r = await request("/auth/login", "POST", { email, password });
      assert.equal(r.status, 200);
      return r.cookie;
    }
    const a = await login("a@stage2.demo"),
      b = await login("b@stage2.demo"),
      v = await login("viewer@stage2.demo"),
      disp = await login("dispatcher@stage2.demo"),
      acc = await login("accountant@stage2.demo");
    const da = await request(
        "/drivers",
        "POST",
        { name: "Driver A", staff_code: "A-01" },
        a,
      ),
      db = await request(
        "/drivers",
        "POST",
        { name: "Driver B", staff_code: "B-01" },
        b,
      ),
      da2 = await request(
        "/drivers",
        "POST",
        { name: "Driver A2", staff_code: "A-02" },
        a,
      );
    assert.equal(da.status, 201);
    assert.equal(db.status, 201);
    const va = await request(
        "/vehicles",
        "POST",
        { name: "Vehicle A2", plate: "A-02" },
        a,
      ),
      vb = await request(
        "/vehicles",
        "POST",
        { name: "Vehicle B", plate: "B-01" },
        b,
      );
    const body = {
      vehicle_id: oldVehicle,
      driver_id: da.data.id,
      origin: "Origin A",
      destination: "Destination A",
      departure_date: "2026-10-24",
    };
    const created = await request("/trips", "POST", body, a),
      foreign = await request(
        "/trips",
        "POST",
        { ...body, vehicle_id: vb.data.id, driver_id: db.data.id },
        b,
      );
    assert.equal(created.status, 201);
    let trip = created.data;
    async function transition(
      status: string,
      reason?: string,
      key = randomUUID(),
    ) {
      const r = await request(
        `/trips/${trip.id}/status`,
        "POST",
        { status, version: trip.version, ...(reason ? { reason } : {}) },
        a,
        key,
      );
      if (r.status === 201) trip = r.data;
      return r;
    }
    await t.test(
      "driver lists, detail and edits remain tenant scoped",
      async () => {
        const list = await request("/drivers", "GET", undefined, a);
        assert.equal(list.data.items.length, 2);
        assert.ok(
          list.data.items.every((d: { id: string }) => d.id !== db.data.id),
        );
        assert.equal(
          (await request(`/drivers/${db.data.id}`, "GET", undefined, a)).status,
          404,
        );
        assert.equal(
          (
            await request(
              `/drivers/${db.data.id}`,
              "PATCH",
              { name: "Wrong", staff_code: "WRONG", active: true, version: 1 },
              a,
            )
          ).status,
          404,
        );
        assert.equal(
          (await request(`/drivers/${db.data.id}`, "GET", undefined, b)).data
            .name,
          "Driver B",
        );
      },
    );
    await t.test(
      "driver edits versioned and inactive drivers cannot be assigned",
      async () => {
        const edit = await request(
          `/drivers/${da2.data.id}`,
          "PATCH",
          {
            name: "Inactive driver",
            staff_code: "A-02",
            active: false,
            version: 1,
          },
          disp,
        );
        assert.equal(edit.status, 200);
        assert.equal(
          (
            await request(
              `/drivers/${da2.data.id}`,
              "PATCH",
              { name: "Stale", staff_code: "A-02", active: true, version: 1 },
              disp,
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await request(
              `/trips/${trip.id}/assignment`,
              "PATCH",
              {
                vehicle_id: oldVehicle,
                driver_id: da2.data.id,
                version: trip.version,
              },
              a,
            )
          ).status,
          409,
        );
      },
    );
    await t.test(
      "foreign driver rejected by create, assignment and database FK",
      async () => {
        assert.equal(
          (
            await request(
              "/trips",
              "POST",
              { ...body, driver_id: db.data.id },
              a,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await request(
              `/trips/${trip.id}/assignment`,
              "PATCH",
              {
                vehicle_id: oldVehicle,
                driver_id: db.data.id,
                version: trip.version,
              },
              a,
            )
          ).status,
          404,
        );
        await assert.rejects(
          pool.query(
            "UPDATE trips SET driver_id=$1 WHERE tenant_id=$2 AND id=$3",
            [db.data.id, tenantA, trip.id],
          ),
          { code: "23503" },
        );
      },
    );
    await t.test(
      "foreign trip assignment, statuses and history denied",
      async () => {
        assert.equal(
          (
            await request(
              `/trips/${foreign.data.id}/assignment`,
              "PATCH",
              { vehicle_id: oldVehicle, driver_id: da.data.id, version: 1 },
              a,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await request(
              `/trips/${foreign.data.id}/status`,
              "POST",
              { status: "planned", version: 1 },
              a,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await request(
              `/trips/${foreign.data.id}/status-history`,
              "GET",
              undefined,
              a,
            )
          ).status,
          404,
        );
      },
    );
    await t.test(
      "driver and operational writes require operator roles",
      async () => {
        for (const user of [v, acc]) {
          assert.equal(
            (
              await request(
                "/drivers",
                "POST",
                { name: "Denied", staff_code: "NO" },
                user,
              )
            ).status,
            403,
          );
          assert.equal(
            (
              await request(
                `/trips/${trip.id}/assignment`,
                "PATCH",
                {
                  vehicle_id: oldVehicle,
                  driver_id: da.data.id,
                  version: trip.version,
                },
                user,
              )
            ).status,
            403,
          );
          assert.equal(
            (
              await request(
                `/trips/${trip.id}/status`,
                "POST",
                { status: "planned", version: trip.version },
                user,
              )
            ).status,
            403,
          );
        }
        assert.equal(
          (await request("/drivers", "GET", undefined, v)).status,
          200,
        );
      },
    );
    const firstPlan = await request(
      `/trips/${trip.id}/estimates`,
      "POST",
      input,
      a,
    );
    assert.equal(firstPlan.status, 201);
    await t.test(
      "changing vehicle preserves old snapshot and invalidates current comparison plan",
      async () => {
        const r = await request(
          `/trips/${trip.id}/assignment`,
          "PATCH",
          {
            vehicle_id: va.data.id,
            driver_id: da.data.id,
            version: trip.version,
          },
          a,
        );
        assert.equal(r.status, 200);
        trip = r.data;
        const history = await request(
          `/trips/${trip.id}/estimates`,
          "GET",
          undefined,
          a,
        );
        assert.equal(
          history.data.items[0].assignment_snapshot.vehicle_id,
          oldVehicle,
        );
        assert.equal(history.data.items[0].total, "23980.00");
        assert.equal(
          (await request(`/trips/${trip.id}/comparison`, "GET", undefined, a))
            .data.plan_total,
          null,
        );
        assert.equal(
          (
            await request(
              `/trips/${trip.id}/assignment`,
              "PATCH",
              { vehicle_id: oldVehicle, driver_id: da.data.id, version: 1 },
              a,
            )
          ).status,
          409,
        );
      },
    );
    const currentPlan = await request(
      `/trips/${trip.id}/estimates`,
      "POST",
      input,
      a,
    );
    assert.equal(currentPlan.status, 201);
    await t.test("plan missing facts is not reported as savings", async () => {
      const r = await request(
        `/trips/${trip.id}/comparison`,
        "GET",
        undefined,
        a,
      );
      assert.equal(r.data.plan_id, currentPlan.data.id);
      assert.equal(r.data.actual_total, null);
      assert.equal(r.data.variance, null);
      assert.equal(
        (await request(`/trips/${oldTrip}/comparison`, "GET", undefined, a))
          .data.plan_total,
        null,
      );
    });
    await t.test(
      "invalid status jumps and missing driver are rejected",
      async () => {
        assert.equal((await transition("completed")).status, 409);
        assert.equal(
          (
            await request(
              `/trips/${oldTrip}/status`,
              "POST",
              { status: "planned", version: 1 },
              a,
            )
          ).status,
          409,
        );
      },
    );
    await t.test("planning is retryable and reserves resources", async () => {
      const key = randomUUID(),
        payload = { status: "planned", version: trip.version };
      const rs = await Promise.all([
        request(`/trips/${trip.id}/status`, "POST", payload, a, key),
        request(`/trips/${trip.id}/status`, "POST", payload, a, key),
      ]);
      assert.equal(rs[0].status, 201);
      assert.equal(rs[1].status, 201);
      assert.equal(rs[0].data.version, rs[1].data.version);
      trip = rs[0].data;
      assert.equal(
        (
          await request(
            `/drivers/${da.data.id}`,
            "PATCH",
            { name: "Driver A", staff_code: "A-01", active: false, version: 1 },
            a,
          )
        ).status,
        409,
      );
    });
    const competitor = await request(
      "/trips",
      "POST",
      { ...body, vehicle_id: va.data.id },
      a,
    );
    assert.equal(competitor.status, 201);
    await t.test(
      "same vehicle/driver cannot be reserved twice including direct DB writes",
      async () => {
        assert.equal(
          (
            await request(
              `/trips/${competitor.data.id}/status`,
              "POST",
              { status: "planned", version: 1 },
              a,
            )
          ).status,
          409,
        );
        await assert.rejects(
          pool.query(
            "UPDATE trips SET status='planned' WHERE tenant_id=$1 AND id=$2",
            [tenantA, competitor.data.id],
          ),
          { code: "23505" },
        );
      },
    );
    await t.test(
      "departure freezes the plan and closes assignment and planned calculations",
      async () => {
        assert.equal((await transition("in_progress")).status, 201);
        assert.ok(trip.started_at);
        const c = await request(
          `/trips/${trip.id}/comparison`,
          "GET",
          undefined,
          a,
        );
        assert.equal(c.data.plan_mode, "frozen");
        assert.equal(c.data.plan_id, currentPlan.data.id);
        assert.equal(
          (
            await request(
              `/trips/${trip.id}/assignment`,
              "PATCH",
              {
                vehicle_id: oldVehicle,
                driver_id: da.data.id,
                version: trip.version,
              },
              a,
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await request(
              `/trips/${trip.id}`,
              "PATCH",
              { ...body, version: trip.version },
              a,
            )
          ).status,
          409,
        );
        assert.equal(
          (await request(`/trips/${trip.id}/estimates`, "POST", input, a))
            .status,
          409,
        );
        assert.equal((await transition("cancelled", "Too late")).status, 409);
      },
    );
    const expense = {
      category: "fuel",
      amount: "25000.00",
      currency: "RUB",
      incurred_on: "2026-10-24",
      note: "Synthetic receipt 01",
    };
    let expenseId = "";
    await t.test(
      "concurrent expense retry produces one money effect and audit entry",
      async () => {
        const key = randomUUID();
        const rs = await Promise.all([
          request(`/trips/${trip.id}/expenses`, "POST", expense, a, key),
          request(`/trips/${trip.id}/expenses`, "POST", expense, a, key),
        ]);
        assert.equal(rs[0].status, 201);
        assert.equal(rs[0].data.id, rs[1].data.id);
        expenseId = rs[0].data.id;
        assert.equal(
          (
            await request(
              `/trips/${trip.id}/expenses`,
              "POST",
              { ...expense, amount: "1.00" },
              a,
              key,
            )
          ).status,
          409,
        );
        const sum = await request(
          `/trips/${trip.id}/comparison`,
          "GET",
          undefined,
          a,
        );
        assert.equal(sum.data.actual_total, "25000.00");
        assert.equal(sum.data.variance, "1020.00");
        assert.equal(sum.data.variance_percent, "4.25");
        assert.equal(sum.data.entry_count, 1);
        assert.equal(
          (
            await pool.query(
              "SELECT count(*) FROM audit_events WHERE entity_id=$1 AND action='expense.created'",
              [expenseId],
            )
          ).rows[0].count,
          "1",
        );
      },
    );
    await t.test(
      "foreign expense access, void, financial reports and inserts are denied",
      async () => {
        for (const path of [
          `/expenses/${expenseId}`,
          `/trips/${trip.id}/expenses`,
          `/trips/${trip.id}/comparison`,
        ])
          assert.equal((await request(path, "GET", undefined, b)).status, 404);
        assert.equal(
          (
            await request(
              `/expenses/${expenseId}/void`,
              "POST",
              { version: 1, reason: "Not mine" },
              b,
            )
          ).status,
          404,
        );
        assert.equal(
          (await request(`/trips/${trip.id}/expenses`, "POST", expense, b))
            .status,
          404,
        );
        await assert.rejects(
          pool.query(
            "INSERT INTO expenses(id,tenant_id,trip_id,category,amount,currency,incurred_on,note,created_by) VALUES($1,$2,$3,'fuel',1,'RUB','2026-10-24','cross tenant',$4)",
            [randomUUID(), tenantB, trip.id, ownerB],
          ),
          { code: "23503" },
        );
      },
    );
    await t.test(
      "finance cannot be read or changed by viewer/dispatcher",
      async () => {
        for (const user of [v, disp]) {
          for (const path of [
            `/trips/${trip.id}/comparison`,
            `/trips/${trip.id}/expenses`,
            `/expenses/${expenseId}`,
          ])
            assert.equal(
              (await request(path, "GET", undefined, user)).status,
              403,
            );
          assert.equal(
            (await request(`/trips/${trip.id}/expenses`, "POST", expense, user))
              .status,
            403,
          );
          assert.equal(
            (
              await request(
                `/expenses/${expenseId}/void`,
                "POST",
                { version: 1, reason: "Denied" },
                user,
              )
            ).status,
            403,
          );
        }
      },
    );
    await t.test(
      "completion releases resources, preserves baseline and disallows reopening",
      async () => {
        assert.equal((await transition("completed")).status, 201);
        assert.ok(trip.completed_at);
        assert.equal((await transition("in_progress")).status, 409);
        assert.equal(
          (await request(`/trips/${trip.id}/comparison`, "GET", undefined, a))
            .data.plan_id,
          currentPlan.data.id,
        );
        const planned = await request(
          `/trips/${competitor.data.id}/status`,
          "POST",
          { status: "planned", version: 1 },
          a,
        );
        assert.equal(planned.status, 201);
        competitor.data = planned.data;
      },
    );
    await t.test(
      "late expenses allowed with basis, original records can be voided exactly once",
      async () => {
        const extra = await request(
          `/trips/${trip.id}/expenses`,
          "POST",
          { ...expense, amount: "0.10", note: "Late synthetic receipt" },
          acc,
        );
        assert.equal(extra.status, 201);
        assert.equal(
          (await request(`/trips/${trip.id}/comparison`, "GET", undefined, a))
            .data.actual_total,
          "25000.10",
        );
        const key = randomUUID(),
          payload = { version: 1, reason: "Synthetic duplicate correction" };
        const rs = await Promise.all([
          request(`/expenses/${expenseId}/void`, "POST", payload, acc, key),
          request(`/expenses/${expenseId}/void`, "POST", payload, acc, key),
        ]);
        assert.equal(rs[0].status, 201);
        assert.equal(rs[1].status, 201);
        assert.equal(rs[0].data.amount, "25000.00");
        assert.ok(rs[0].data.voided_at);
        assert.equal(
          (await request(`/trips/${trip.id}/comparison`, "GET", undefined, a))
            .data.actual_total,
          "0.10",
        );
        assert.equal(
          (await request(`/expenses/${expenseId}/void`, "POST", payload, acc))
            .status,
          409,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*) FROM audit_events WHERE entity_id=$1 AND action='expense.voided'",
              [expenseId],
            )
          ).rows[0].count,
          "1",
        );
      },
    );
    await t.test(
      "bad expenses and absent correction reasons are rejected",
      async () => {
        for (const amount of ["-1", "1.001", "NaN", "0"])
          assert.equal(
            (
              await request(
                `/trips/${trip.id}/expenses`,
                "POST",
                { ...expense, amount },
                acc,
              )
            ).status,
            400,
          );
        assert.equal(
          (
            await request(
              `/expenses/${expenseId}/void`,
              "POST",
              { version: 2, reason: "" },
              acc,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              `/trips/${trip.id}/expenses?limit=1000`,
              "GET",
              undefined,
              a,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              "/drivers",
              "POST",
              { name: "Bad", staff_code: "BAD", tenant_id: tenantB },
              a,
            )
          ).status,
          400,
        );
      },
    );
    await t.test(
      "cancellation requires reason and records status history",
      async () => {
        assert.equal(
          (
            await request(
              `/trips/${competitor.data.id}/status`,
              "POST",
              { status: "cancelled", version: competitor.data.version },
              a,
            )
          ).status,
          400,
        );
        const r = await request(
          `/trips/${competitor.data.id}/status`,
          "POST",
          {
            status: "cancelled",
            version: competitor.data.version,
            reason: "Synthetic cancellation",
          },
          a,
        );
        assert.equal(r.status, 201);
        assert.equal(
          (
            await request(
              `/trips/${competitor.data.id}/status`,
              "POST",
              { status: "planned", version: r.data.version },
              a,
            )
          ).status,
          409,
        );
        const history = await request(
          `/trips/${trip.id}/status-history`,
          "GET",
          undefined,
          v,
        );
        assert.equal(history.data.items.length, 3);
        assert.equal(history.data.items[0].to_status, "completed");
      },
    );
    await t.test(
      "two concurrent planning requests compete for a single driver",
      async () => {
        const one = await request("/trips", "POST", body, a),
          two = await request(
            "/trips",
            "POST",
            { ...body, vehicle_id: va.data.id },
            a,
          );
        const rs = await Promise.all([
          request(
            `/trips/${one.data.id}/status`,
            "POST",
            { status: "planned", version: 1 },
            a,
          ),
          request(
            `/trips/${two.data.id}/status`,
            "POST",
            { status: "planned", version: 1 },
            a,
          ),
        ]);
        assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409]);
      },
    );
    await t.test(
      "no-plan departure keeps plan absent instead of attaching unrelated historical estimate",
      async () => {
        const d = await request(
          "/drivers",
          "POST",
          { name: "Independent driver", staff_code: "INDEPENDENT" },
          a,
        );
        const veh = await request(
          "/vehicles",
          "POST",
          { name: "Independent vehicle", plate: "INDEPENDENT" },
          a,
        );
        const tr = await request(
          "/trips",
          "POST",
          { ...body, vehicle_id: veh.data.id, driver_id: d.data.id },
          a,
        );
        const p = await request(
          `/trips/${tr.data.id}/status`,
          "POST",
          { status: "planned", version: 1 },
          a,
        );
        const start = await request(
          `/trips/${tr.data.id}/status`,
          "POST",
          { status: "in_progress", version: p.data.version },
          a,
        );
        assert.equal(start.status, 201);
        const c = await request(
          `/trips/${tr.data.id}/comparison`,
          "GET",
          undefined,
          a,
        );
        assert.equal(c.data.plan_mode, "frozen");
        assert.equal(c.data.plan_total, null);
      },
    );
  } finally {
    await app.close();
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
