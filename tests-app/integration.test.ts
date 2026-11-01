import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { isolatedDatabaseUrl } from "./test-database";
import { Pool } from "pg";
import { hashPassword } from "../apps/api/src/password";
test("real PostgreSQL + NestJS: isolation, roles, persistence and retries", async (t) => {
  process.env.DATABASE_URL = isolatedDatabaseUrl();
  const admin = new Pool({ connectionString: process.env.DATABASE_URL });
  const schema = `fleet_test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.toString();
  process.env.SESSION_SECRET = "integration-secret-for-test-only-000000";
  process.env.APP_BASE_URL = "http://localhost:3000";
  const pool = new Pool({ connectionString: url.toString() });
  const require = createRequire(resolve("tests-app/integration.test.ts"));
  const { createApp } = require("../apps/api/dist/app.js") as {
    createApp: () => Promise<import("@nestjs/common").INestApplication>;
  };
  const app = await createApp();
  try {
    await pool.query(await readFile("migrations/001_initial.sql", "utf8"));
    await pool.query(await readFile("migrations/002_operations.sql", "utf8"));
    await pool.query(
      await readFile("migrations/003_vehicle_period.sql", "utf8"),
    );
    await pool.query(
      await readFile("migrations/004_recognized_income.sql", "utf8"),
    );
    const tenantA = randomUUID(),
      tenantB = randomUUID(),
      ownerA = randomUUID(),
      ownerB = randomUUID(),
      viewer = randomUUID(),
      accountant = randomUUID(),
      dispatcher = randomUUID();
    const password = "SyntheticTest123!";
    const hash = await hashPassword(password);
    await pool.query(
      "INSERT INTO organizations(id,name) VALUES($1,$2),($3,$4)",
      [tenantA, "Test A", tenantB, "Test B"],
    );
    for (const [uid, email, tenant, role] of [
      [ownerA, "a@test.demo", tenantA, "owner"],
      [ownerB, "b@test.demo", tenantB, "owner"],
      [viewer, "viewer@test.demo", tenantA, "viewer"],
      [accountant, "accountant@test.demo", tenantA, "accountant"],
      [dispatcher, "dispatcher@test.demo", tenantA, "dispatcher"],
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
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    const request = async (
      path: string,
      method = "GET",
      body?: unknown,
      cookie = "",
      key: string = randomUUID(),
      origin = "http://localhost:3000",
    ) => {
      const response = await fetch(`${base}/api/v1${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          Cookie: cookie,
          "Idempotency-Key": key,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return {
        status: response.status,
        data: await response.json(),
        cookie: response.headers.get("set-cookie")?.split(";")[0] || "",
        headers: response.headers,
      };
    };
    const login = async (email: string) => {
      const r = await request("/auth/login", "POST", { email, password });
      assert.equal(r.status, 200);
      assert.match(r.headers.get("set-cookie")!, /HttpOnly/i);
      return r.cookie;
    };
    const a = await login("a@test.demo"),
      b = await login("b@test.demo"),
      v = await login("viewer@test.demo"),
      acc = await login("accountant@test.demo"),
      disp = await login("dispatcher@test.demo");
    await t.test("authentication and origin checks", async () => {
      assert.equal((await request("/vehicles")).status, 401);
      assert.equal(
        (
          await request("/auth/login", "POST", {
            email: "a@test.demo",
            password: "bad",
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await request(
            "/vehicles",
            "POST",
            { name: "Xx", plate: "AA" },
            a,
            randomUUID(),
            "https://foreign.invalid",
          )
        ).status,
        403,
      );
    });
    const va = await request(
      "/vehicles",
      "POST",
      { name: "Vehicle A", plate: "A-01" },
      a,
    );
    const vb = await request(
      "/vehicles",
      "POST",
      { name: "Vehicle B", plate: "B-01" },
      b,
    );
    assert.equal(va.status, 201);
    assert.equal(vb.status, 201);
    const tripBody = {
      vehicle_id: va.data.id,
      origin: "Origin A",
      destination: "Destination A",
      departure_date: "2026-10-24",
    };
    const ta = await request("/trips", "POST", tripBody, a);
    const tb = await request(
      "/trips",
      "POST",
      { ...tripBody, vehicle_id: vb.data.id },
      b,
    );
    assert.equal(ta.status, 201);
    assert.equal(tb.status, 201);
    await t.test("foreign vehicles cannot be read or changed", async () => {
      assert.equal(
        (await request(`/vehicles/${vb.data.id}`, "GET", undefined, a)).status,
        404,
      );
      assert.equal(
        (
          await request(
            `/vehicles/${vb.data.id}`,
            "PATCH",
            { name: "Changed", plate: "X", version: 1 },
            a,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await request(
            `/vehicles/${vb.data.id}`,
            "PATCH",
            { name: "Changed", plate: "XX", version: 1 },
            a,
          )
        ).status,
        404,
      );
      assert.equal(
        (await request(`/vehicles/${vb.data.id}`, "GET", undefined, b)).data
          .name,
        "Vehicle B",
      );
    });
    await t.test("foreign trips cannot be read or changed", async () => {
      assert.equal(
        (await request(`/trips/${tb.data.id}`, "GET", undefined, a)).status,
        404,
      );
      assert.equal(
        (
          await request(
            `/trips/${tb.data.id}`,
            "PATCH",
            { ...tripBody, version: 1 },
            a,
          )
        ).status,
        404,
      );
      assert.equal(
        (await request(`/trips/${tb.data.id}/estimates`, "GET", undefined, a))
          .status,
        404,
      );
    });
    await t.test(
      "lists are scoped and finance never leaks in trip response",
      async () => {
        const vehicles = (await request("/vehicles", "GET", undefined, a)).data
          .items;
        assert.equal(vehicles.length, 1);
        assert.equal(vehicles[0].id, va.data.id);
        const trips = (await request("/trips", "GET", undefined, a)).data.items;
        assert.equal(trips.length, 1);
        assert.equal(trips[0].id, ta.data.id);
        assert.equal(trips[0].result, undefined);
      },
    );
    await t.test(
      "cross-tenant assignment denied by API and PostgreSQL FK",
      async () => {
        assert.equal(
          (
            await request(
              "/trips",
              "POST",
              { ...tripBody, vehicle_id: vb.data.id },
              a,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await request(
              `/trips/${ta.data.id}`,
              "PATCH",
              { ...tripBody, vehicle_id: vb.data.id, version: 1 },
              a,
            )
          ).status,
          404,
        );
        await assert.rejects(
          pool.query(
            "INSERT INTO trips(id,tenant_id,vehicle_id,origin,destination,departure_date) VALUES($1,$2,$3,$4,$5,$6)",
            [randomUUID(), tenantA, vb.data.id, "A", "B", "2026-10-24"],
          ),
          { code: "23503" },
        );
      },
    );
    const example = JSON.parse(
      await readFile("examples/trip-cost.json", "utf8"),
    );
    await t.test(
      "cost persisted with input/version/author and hidden from foreign tenant",
      async () => {
        const r = await request(
          `/trips/${ta.data.id}/estimates`,
          "POST",
          example,
          a,
        );
        assert.equal(r.status, 201);
        assert.equal(r.data.total, "23980.00");
        assert.equal(r.data.result.target_price, "29975.00");
        assert.deepEqual(r.data.input_snapshot, example);
        assert.equal(r.data.calculation_version, "1");
        const read = await request(
          `/trips/${ta.data.id}/estimates`,
          "GET",
          undefined,
          a,
        );
        assert.equal(read.data.items[0].id, r.data.id);
        const stored = await pool.query(
          "SELECT total,created_by FROM cost_estimates WHERE id=$1",
          [r.data.id],
        );
        assert.equal(stored.rows[0].total, "23980.00");
        assert.equal(stored.rows[0].created_by, ownerA);
        assert.equal(
          (await request(`/trips/${tb.data.id}/estimates`, "POST", example, a))
            .status,
          404,
        );
      },
    );
    await t.test("role matrix enforced on direct HTTP requests", async () => {
      for (const cookie of [v, acc])
        assert.equal(
          (
            await request(
              "/vehicles",
              "POST",
              { name: "Nope", plate: "NO" },
              cookie,
            )
          ).status,
          403,
        );
      for (const cookie of [v, disp]) {
        assert.equal(
          (
            await request(
              `/trips/${ta.data.id}/estimates`,
              "POST",
              example,
              cookie,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              `/trips/${ta.data.id}/estimates`,
              "GET",
              undefined,
              cookie,
            )
          ).status,
          403,
        );
      }
      assert.equal(
        (await request(`/trips/${ta.data.id}/estimates`, "POST", example, acc))
          .status,
        201,
      );
      assert.equal(
        (await request("/vehicles", "GET", undefined, v)).status,
        200,
      );
    });
    await t.test(
      "concurrent create retries return one durable record; different body conflicts",
      async () => {
        const key = randomUUID(),
          body = { name: "Idempotent", plate: "ID-01" };
        const rs = await Promise.all([
          request("/vehicles", "POST", body, a, key),
          request("/vehicles", "POST", body, a, key),
        ]);
        assert.equal(rs[0].status, 201);
        assert.equal(rs[1].status, 201);
        assert.equal(rs[0].data.id, rs[1].data.id);
        assert.equal(
          (
            await request(
              "/vehicles",
              "POST",
              { ...body, name: "Changed" },
              a,
              key,
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*) FROM vehicles WHERE tenant_id=$1 AND plate=$2",
              [tenantA, body.plate],
            )
          ).rows[0].count,
          "1",
        );
      },
    );
    await t.test(
      "concurrent calculation retry preserves one snapshot",
      async () => {
        const key = randomUUID();
        const rs = await Promise.all([
          request(`/trips/${ta.data.id}/estimates`, "POST", example, a, key),
          request(`/trips/${ta.data.id}/estimates`, "POST", example, a, key),
        ]);
        assert.equal(rs[0].data.id, rs[1].data.id);
        assert.equal(rs[0].status, 201);
        assert.equal(
          (
            await request(
              `/trips/${ta.data.id}/estimates`,
              "POST",
              { ...example, tolls: "2000" },
              a,
              key,
            )
          ).status,
          409,
        );
      },
    );
    await t.test(
      "stale versions rejected without overwriting changes",
      async () => {
        const first = await request(
          `/vehicles/${va.data.id}`,
          "PATCH",
          { name: "Updated A", plate: "A-01", version: 1 },
          a,
        );
        assert.equal(first.status, 200);
        assert.equal(first.data.version, 2);
        assert.equal(
          (
            await request(
              `/vehicles/${va.data.id}`,
              "PATCH",
              { name: "Stale", plate: "A-01", version: 1 },
              a,
            )
          ).status,
          409,
        );
        const tr = await request(
          `/trips/${ta.data.id}`,
          "PATCH",
          { ...tripBody, version: 1, destination: "Updated destination" },
          a,
        );
        assert.equal(tr.status, 200);
        assert.equal(
          (
            await request(
              `/trips/${ta.data.id}`,
              "PATCH",
              { ...tripBody, version: 1 },
              a,
            )
          ).status,
          409,
        );
      },
    );
    await t.test(
      "unknown fields, pagination, missing keys and invalid costs rejected",
      async () => {
        assert.equal(
          (
            await request(
              "/vehicles",
              "POST",
              { name: "Bad tenant", plate: "BAD", tenant_id: tenantB },
              a,
            )
          ).status,
          400,
        );
        assert.equal(
          (await request("/vehicles?limit=1000", "GET", undefined, a)).status,
          400,
        );
        assert.equal(
          (
            await request(
              "/vehicles",
              "POST",
              { name: "No key", plate: "KEY" },
              a,
              "",
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              `/trips/${ta.data.id}/estimates`,
              "POST",
              { ...example, target_margin: "1" },
              a,
            )
          ).status,
          400,
        );
      },
    );
    await t.test("logout revokes stored session", async () => {
      assert.equal((await request("/auth/logout", "POST", {}, a)).status, 200);
      assert.equal(
        (await request("/auth/me", "GET", undefined, a)).status,
        401,
      );
    });
    await t.test(
      "malformed numeric fields return validation errors rather than 500",
      async () => {
        for (const field of ["loaded_km", "overhead_rate", "target_margin"]) {
          const r = await request(
            `/trips/${ta.data.id}/estimates`,
            "POST",
            { ...example, [field]: "abc" },
            acc,
          );
          assert.equal(r.status, 400);
          assert.ok(r.data.error.fields[field]);
        }
      },
    );
  } finally {
    await app.close();
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
