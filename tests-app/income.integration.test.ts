import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { Pool } from "pg";
import { applicableCategories, type IncomeWorkspace } from "@fleet/shared";
import { hashPassword } from "../apps/api/src/password";
import { isolatedDatabaseUrl } from "./test-database";

test("recognized income: one source, period and trip, isolated HTTP and database", async (t) => {
  const url = new URL(isolatedDatabaseUrl()),
    admin = new Pool({ connectionString: url.toString() }),
    schema = `fleet_test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  url.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.toString();
  process.env.SESSION_SECRET = "income-test-session-secret-synthetic-000000";
  process.env.APP_BASE_URL = "http://localhost:3000";
  const pool = new Pool({ connectionString: url.toString() });
  const require = createRequire(
    resolve("tests-app/income.integration.test.ts"),
  );
  const { createApp } = require("../apps/api/dist/app.js") as {
    createApp: () => Promise<import("@nestjs/common").INestApplication>;
  };
  const app = await createApp();
  try {
    for (const file of [
      "001_initial.sql",
      "002_operations.sql",
      "003_vehicle_period.sql",
    ])
      await pool.query(await readFile(`migrations/${file}`, "utf8"));
    const tenant = randomUUID(),
      foreign = randomUUID(),
      owner = randomUUID(),
      otherOwner = randomUUID(),
      vehicle = randomUUID(),
      second = randomUUID(),
      otherVehicle = randomUUID(),
      trip = randomUUID(),
      otherTrip = randomUUID();
    await pool.query(
      "INSERT INTO organizations(id,name) VALUES($1,'Synthetic income A'),($2,'Synthetic income B')",
      [tenant, foreign],
    );
    const password = "IncomeSynthetic123!",
      hash = await hashPassword(password);
    for (const [id, email, org, role] of [
      [owner, "owner@income.demo", tenant, "owner"],
      [otherOwner, "other@income.demo", foreign, "owner"],
      [randomUUID(), "viewer@income.demo", tenant, "viewer"],
      [randomUUID(), "dispatcher@income.demo", tenant, "dispatcher"],
      [randomUUID(), "accountant@income.demo", tenant, "accountant"],
    ]) {
      await pool.query(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)",
        [id, email, role, hash],
      );
      await pool.query(
        "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)",
        [org, id, role],
      );
    }
    for (const [id, org, name] of [
      [vehicle, tenant, "MAIN"],
      [second, tenant, "SECOND"],
      [otherVehicle, foreign, "FOREIGN"],
    ])
      await pool.query(
        "INSERT INTO vehicles(id,tenant_id,name,plate) VALUES($1,$2,$3,$3)",
        [id, org, name],
      );
    for (const [id, org, v] of [
      [trip, tenant, vehicle],
      [otherTrip, foreign, otherVehicle],
    ])
      await pool.query(
        "INSERT INTO trips(id,tenant_id,vehicle_id,origin,destination,departure_date) VALUES($1,$2,$3,'Synthetic A','Synthetic B','2026-09-15')",
        [id, org, v],
      );
    // Simulate a legacy snapshot with revenue before migration. No event or date may be invented from it.
    const estimate = randomUUID();
    await pool.query(
      "INSERT INTO cost_estimates(id,tenant_id,trip_id,currency,calculation_version,tariff_version,input_snapshot,result,total,created_by) VALUES($1,$2,$3,'RUB','1','manual-v1',$4,$5,50000,$6)",
      [
        estimate,
        tenant,
        trip,
        JSON.stringify({ revenue: "90000" }),
        JSON.stringify({ revenue: "90000", profit: "40000" }),
        owner,
      ],
    );
    const before = (
      await pool.query("SELECT * FROM cost_estimates WHERE id=$1", [estimate])
    ).rows;
    await pool.query(
      await readFile("migrations/004_recognized_income.sql", "utf8"),
    );
    await t.test(
      "004 preserves legacy planned revenue without inventing actual recognition",
      async () => {
        assert.deepEqual(
          (
            await pool.query("SELECT * FROM cost_estimates WHERE id=$1", [
              estimate,
            ])
          ).rows,
          before,
        );
        assert.equal(
          (await pool.query("SELECT count(*)::int n FROM recognized_income"))
            .rows[0].n,
          0,
        );
      },
    );
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    async function raw(
      path: string,
      method = "GET",
      body?: unknown,
      cookie = "",
      key: string = randomUUID(),
    ) {
      const r = await fetch(`${base}/api/v1${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
          Cookie: cookie,
          "Idempotency-Key": key,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return {
        status: r.status,
        data: await r.json(),
        cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "",
      };
    }
    const login = async (email: string) => {
      const r = await raw("/auth/login", "POST", { email, password });
      assert.equal(r.status, 200);
      return r.cookie;
    };
    const a = await login("owner@income.demo"),
      b = await login("other@income.demo"),
      viewer = await login("viewer@income.demo"),
      dispatcher = await login("dispatcher@income.demo"),
      accountant = await login("accountant@income.demo");
    const range = { start_date: "2026-09-01", end_date: "2026-09-30" },
      prefix = `/vehicles/${vehicle}/period`;
    const post = (path: string, body: unknown, cookie = a, key?: string) =>
      raw(path, "POST", body, cookie, key);
    type Workspace = {
      income: IncomeWorkspace;
      report: {
        total_cost: string;
        revision: number;
        costs_reviewed: boolean;
        metrics: {
          km: { unit_cost: string | null };
          work_hours: { unit_cost: string | null };
        };
      };
    };
    async function period(
      v = vehicle,
      start = "2026-09-01",
      end = "2026-09-30",
    ) {
      const r = await raw(
        `/vehicles/${v}/period?start_date=${start}&end_date=${end}`,
        "GET",
        undefined,
        a,
      );
      assert.equal(r.status, 200, JSON.stringify(r.data));
      return r.data as Workspace;
    }
    const body = (
      amount: string,
      ref: string,
      tid: string | null = trip,
      v = vehicle,
    ) => ({
      vehicle_id: v,
      trip_id: tid,
      recognized_on: "2026-09-20",
      amount,
      currency: "RUB",
      source_ref: ref,
      note: "Synthetic recognized income basis",
    });
    const review = async (status = "confirmed", revision?: number) =>
      post(`${prefix}/income-review`, {
        ...range,
        expected_revision: revision ?? (await period()).report.revision,
        status,
        reason: "Synthetic review of all income sources",
      });
    await post(`${prefix}/ownership`, { ownership: "owned", version: 0 });
    await post(`${prefix}/costs`, {
      date: "2026-09-15",
      amount: "50000",
      currency: "RUB",
      category: "fuel",
      note: "Synthetic all recognized cost",
    });
    await post(`${prefix}/readings`, {
      date: "2026-09-01",
      km: "10000",
      work_hours: "400",
      engine_hours: "500",
      note: "start",
    });
    await post(`${prefix}/readings`, {
      date: "2026-10-01",
      km: "11000",
      work_hours: "440",
      engine_hours: "550",
      note: "end",
    });
    let linked = "",
      manual = "";
    await t.test(
      "unknown revenue and result never become zero; planned snapshot excluded",
      async () => {
        const r = await period();
        assert.equal(r.income.summary.actual_revenue, null);
        assert.equal(r.income.summary.financial_result, null);
        assert.equal(r.report.metrics.km.unit_cost, "50.0000");
        assert.equal(
          (await raw(`/trips/${trip}/income`, "GET", undefined, a)).data.summary
            .actual_revenue,
          null,
        );
      },
    );
    await t.test(
      "same recognized trip source appears once in both views; concurrent retries",
      async () => {
        const key = randomUUID(),
          payload = body("80000", "TRIP-001");
        const rs = await Promise.all([
          post("/income", payload, a, key),
          post("/income", payload, a, key),
        ]);
        assert.deepEqual(
          rs.map((r) => r.status),
          [201, 201],
        );
        assert.equal(rs[0].data.id, rs[1].data.id);
        linked = rs[0].data.id;
        const p = await period(),
          tr = await raw(`/trips/${trip}/income`, "GET", undefined, a);
        assert.equal(p.income.entries[0].id, tr.data.entries[0].id);
        assert.equal(p.income.summary.actual_revenue, "80000.00");
        assert.equal(p.income.summary.status, "partial");
        assert.equal(p.income.summary.financial_result, "30000.00");
        assert.equal(tr.data.summary.financial_result, null);
        assert.equal(
          (await post("/income", { ...payload, amount: "1" }, a, key)).status,
          409,
        );
      },
    );
    await t.test(
      "outside-trip revenue and source identity prevent duplicate manual/trip journals",
      async () => {
        const r = await post("/income", body("20000", "MANUAL-001", null));
        assert.equal(r.status, 201);
        manual = r.data.id;
        assert.equal(
          (await post("/income", body("20000", " manual-001 "))).status,
          409,
        );
        assert.equal(
          (
            await post(`/income/${manual}`, {
              ...body("20000", "MANUAL-001"),
              version: 1,
              reason: "Link the existing source to this trip",
            })
          ).status,
          201,
        );
        const p = await period();
        assert.equal(p.income.summary.actual_revenue, "100000.00");
        assert.equal(p.income.entries.filter((e) => e.id === manual).length, 1);
        assert.equal(
          (await raw(`/trips/${trip}/income`, "GET", undefined, a)).data.summary
            .actual_revenue,
          "100000.00",
        );
        assert.equal(p.report.metrics.km.unit_cost, "50.0000");
        assert.equal(p.report.metrics.work_hours.unit_cost, "1250.0000");
      },
    );
    await t.test(
      "income and cost completeness are separate, zero conflicts, versions invalidate both",
      async () => {
        assert.equal((await review("zero")).status, 409);
        assert.equal((await review()).status, 201);
        let p = await period();
        assert.equal(p.income.summary.income_reviewed, true);
        assert.equal(p.income.summary.financial_result_reviewed, false);
        await post(`${prefix}/review`, {
          ...range,
          expected_revision: p.report.revision,
          states: applicableCategories("owned").map((category) => ({
            category,
            status: "reviewed",
            reason: "",
          })),
        });
        p = await period();
        assert.equal(p.income.summary.financial_result_reviewed, true);
        assert.equal(
          (
            await post(`/income/${manual}`, {
              ...body("25000", "MANUAL-001"),
              version: 2,
              reason: "Correct source amount",
            })
          ).status,
          201,
        );
        assert.equal(
          (
            await post(`/income/${manual}`, {
              ...body("1", "MANUAL-001"),
              version: 2,
              reason: "Stale overwrite",
            })
          ).status,
          409,
        );
        const changed = await period();
        assert.equal(changed.income.summary.actual_revenue, "105000.00");
        assert.equal(changed.income.summary.financial_result, "55000.00");
        assert.equal(changed.report.costs_reviewed, false);
        assert.equal(changed.income.summary.income_reviewed, false);
        assert.equal(
          (await review("confirmed", p.report.revision)).status,
          409,
        );
      },
    );
    await t.test(
      "source edit date changes period membership; void removes the same source in both views",
      async () => {
        assert.equal(
          (
            await post(`/income/${manual}`, {
              ...body("25000", "MANUAL-001"),
              recognized_on: "2026-10-02",
              version: 3,
              reason: "Correct recognition date",
            })
          ).status,
          201,
        );
        assert.equal(
          (await period()).income.summary.actual_revenue,
          "80000.00",
        );
        assert.equal(
          (await period(vehicle, "2026-10-01", "2026-10-31")).income.summary
            .actual_revenue,
          "25000.00",
        );
        assert.equal(
          (
            await post(`/income/${manual}/void`, {
              version: 4,
              reason: "Cancel erroneous source",
            })
          ).status,
          201,
        );
        assert.equal(
          (await period(vehicle, "2026-10-01", "2026-10-31")).income.summary
            .actual_revenue,
          null,
        );
        assert.equal(
          (await raw(`/trips/${trip}/income`, "GET", undefined, a)).data.summary
            .actual_revenue,
          "80000.00",
        );
        assert.equal(
          (
            await post(`/income/${manual}/void`, {
              version: 4,
              reason: "Duplicate void",
            })
          ).status,
          409,
        );
      },
    );
    await t.test(
      "reassignment warns, does not move money; explicit versioned correction moves one source",
      async () => {
        await review();
        assert.equal(
          (
            await raw(
              `/trips/${trip}`,
              "PATCH",
              {
                vehicle_id: second,
                origin: "Synthetic A",
                destination: "Synthetic B",
                departure_date: "2026-09-15",
                version: 1,
              },
              a,
            )
          ).status,
          200,
        );
        assert.equal((await period()).income.summary.source_warning, true);
        assert.equal((await review()).status, 409);
        assert.equal(
          (await period(second)).income.recognized_elsewhere[0].id,
          linked,
        );
        assert.equal(
          (
            await post(`/income/${linked}`, {
              ...body("80000", "TRIP-001", trip, second),
              version: 1,
              reason: "Explicitly attribute this source to the second vehicle",
            })
          ).status,
          201,
        );
        assert.equal((await period()).income.summary.actual_revenue, null);
        const moved = await period(second);
        assert.equal(moved.income.summary.actual_revenue, "80000.00");
        assert.equal(moved.income.summary.source_warning, false);
        assert.equal(
          (await raw(`/trips/${trip}/income`, "GET", undefined, a)).data.summary
            .actual_revenue,
          "80000.00",
        );
      },
    );
    await t.test(
      "explicit no-income review means zero, a later edit invalidates it",
      async () => {
        assert.equal((await review("zero")).status, 201);
        const p = await period();
        assert.equal(p.income.summary.actual_revenue, "0.00");
        assert.equal(p.income.summary.financial_result, "-50000.00");
        assert.equal(p.report.metrics.km.unit_cost, "50.0000");
        assert.equal(
          (await post("/income", body("0", "KNOWN-ZERO", null))).status,
          201,
        );
        assert.equal((await period()).income.summary.status, "partial");
      },
    );
    await t.test(
      "every income endpoint enforces finance roles and tenant-scoped IDs",
      async () => {
        const actions: [string, unknown][] = [
          ["/income", body("1", "FORBIDDEN")],
          [
            `/income/${linked}`,
            { ...body("1", "TRIP-001"), version: 2, reason: "Forbidden edit" },
          ],
          [`/income/${linked}/void`, { version: 2, reason: "Forbidden void" }],
          [
            `${prefix}/income-review`,
            {
              ...range,
              expected_revision: (await period()).report.revision,
              status: "confirmed",
              reason: "Forbidden review",
            },
          ],
        ];
        assert.equal((await raw(`/trips/${trip}/income`)).status, 401);
        for (const cookie of [viewer, dispatcher]) {
          assert.equal(
            (await raw(`/trips/${trip}/income`, "GET", undefined, cookie))
              .status,
            403,
          );
          for (const [path, payload] of actions)
            assert.equal((await post(path, payload, cookie)).status, 403, path);
        }
        assert.equal(
          (await raw(`/trips/${trip}/income`, "GET", undefined, b)).status,
          404,
        );
        assert.equal(
          (
            await post(
              "/income",
              body("1", "FOREIGN-VEHICLE", null, otherVehicle),
            )
          ).status,
          404,
        );
        assert.equal(
          (await post("/income", body("1", "FOREIGN-TRIP", otherTrip))).status,
          404,
        );
        const foreignIncome = await post(
          "/income",
          body("1", "FOREIGN-SOURCE", otherTrip, otherVehicle),
          b,
        );
        assert.equal(foreignIncome.status, 201);
        assert.equal(
          (
            await post(`/income/${foreignIncome.data.id}`, {
              ...body("1", "FOREIGN-SOURCE"),
              version: 1,
              reason: "Cross tenant",
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await post(`/income/${foreignIncome.data.id}/void`, {
              version: 1,
              reason: "Cross tenant",
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await post(`/vehicles/${otherVehicle}/period/income-review`, {
              ...range,
              expected_revision: 0,
              status: "zero",
              reason: "Cross tenant",
            })
          ).status,
          404,
        );
        assert.equal(
          (await raw(`/trips/${trip}/income`, "GET", undefined, accountant))
            .status,
          200,
        );
        assert.equal(
          (
            await post(
              "/income",
              { ...body("1", "ACCOUNTANT", null), recognized_on: "2026-11-01" },
              accountant,
            )
          ).status,
          201,
        );
      },
    );
    await t.test(
      "database foreign keys and validation reject cross-tenant or imprecise sources",
      async () => {
        await assert.rejects(
          pool.query(
            "INSERT INTO recognized_income(id,tenant_id,vehicle_id,recognized_on,amount,currency,source_ref,note,created_by) VALUES($1,$2,$3,'2026-09-01',1,'RUB','CROSS-FK','Synthetic',$4)",
            [randomUUID(), tenant, otherVehicle, owner],
          ),
          { code: "23503" },
        );
        await assert.rejects(
          pool.query(
            "INSERT INTO recognized_income(id,tenant_id,vehicle_id,trip_id,source_vehicle_id,recognized_on,amount,currency,source_ref,note,created_by) VALUES($1,$2,$3,$4,$3,'2026-09-01',1,'RUB','CROSS-TRIP','Synthetic',$5)",
            [randomUUID(), tenant, vehicle, otherTrip, owner],
          ),
          { code: "23503" },
        );
        for (const amount of ["1.001", "-1", 1])
          assert.equal(
            (await post("/income", { ...body("1", "BAD"), amount })).status,
            400,
          );
        assert.equal(
          (
            await post("/income", {
              ...body("1", "BAD"),
              recognized_on: "2026-02-30",
            })
          ).status,
          400,
        );
      },
    );
    await t.test(
      "concurrent income and review cannot leave a false current confirmation",
      async () => {
        const before = await period();
        const [added, reviewed] = await Promise.all([
          post("/income", body("0.10", "CONCURRENT", null)),
          review("confirmed", before.report.revision),
        ]);
        assert.equal(added.status, 201);
        assert.ok([201, 409].includes(reviewed.status));
        assert.equal((await period()).income.summary.income_reviewed, false);
      },
    );
  } finally {
    await app.close();
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
