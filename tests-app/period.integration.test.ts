import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { Pool } from "pg";
import { applicableCategories } from "@fleet/shared";
import { hashPassword } from "../apps/api/src/password";

test("vehicle periods: isolated PostgreSQL, HTTP, sources, tenancy and corrections", async (t) => {
  // Deliberately never load .env or fall back to a working DATABASE_URL.
  const testUrl = process.env.PERIOD_TEST_DATABASE_URL;
  assert.ok(
    testUrl,
    "PERIOD_TEST_DATABASE_URL must explicitly identify the isolated test database",
  );
  const target = new URL(testUrl);
  assert.ok(
    ["localhost", "127.0.0.1"].includes(target.hostname) &&
      target.pathname === "/fleet_period_test",
    "Only the dedicated local fleet_period_test database is accepted",
  );
  const admin = new Pool({ connectionString: testUrl });
  const schema = `fleet_test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  target.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = target.toString();
  process.env.SESSION_SECRET = "period-synthetic-session-secret-only-0000000";
  process.env.APP_BASE_URL = "http://localhost:3000";
  const pool = new Pool({ connectionString: target.toString() });
  const require = createRequire(
    resolve("tests-app/period.integration.test.ts"),
  );
  const { createApp } = require("../apps/api/dist/app.js") as {
    createApp: () => Promise<import("@nestjs/common").INestApplication>;
  };
  const app = await createApp();
  try {
    await pool.query(await readFile("migrations/001_initial.sql", "utf8"));
    await pool.query(await readFile("migrations/002_operations.sql", "utf8"));
    const tenant = randomUUID(),
      foreign = randomUUID(),
      owner = randomUUID(),
      otherOwner = randomUUID();
    await pool.query(
      "INSERT INTO organizations(id,name) VALUES($1,'Synthetic A'),($2,'Synthetic B')",
      [tenant, foreign],
    );
    const password = "PeriodSynthetic123!",
      hash = await hashPassword(password);
    for (const [uid, email, organization, role] of [
      [owner, "owner@period.demo", tenant, "owner"],
      [otherOwner, "other@period.demo", foreign, "owner"],
      [randomUUID(), "viewer@period.demo", tenant, "viewer"],
      [randomUUID(), "dispatcher@period.demo", tenant, "dispatcher"],
      [randomUUID(), "accountant@period.demo", tenant, "accountant"],
    ]) {
      await pool.query(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)",
        [uid, email, role, hash],
      );
      await pool.query(
        "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)",
        [organization, uid, role],
      );
    }
    await t.test(
      "003 upgrades populated stage 2 without changing existing trip facts",
      async () => {
        const v = randomUUID(),
          trip = randomUUID(),
          expense = randomUUID();
        await pool.query(
          "INSERT INTO vehicles(id,tenant_id,name,plate) VALUES($1,$2,'Legacy synthetic','LEGACY')",
          [v, tenant],
        );
        await pool.query(
          "INSERT INTO trips(id,tenant_id,vehicle_id,origin,destination,departure_date) VALUES($1,$2,$3,'A','B','2026-08-01')",
          [trip, tenant, v],
        );
        await pool.query(
          "INSERT INTO expenses(id,tenant_id,trip_id,category,amount,currency,incurred_on,note,created_by) VALUES($1,$2,$3,'fuel',123.45,'RUB','2026-08-01','Legacy source',$4)",
          [expense, tenant, trip, owner],
        );
        const before = await pool.query("SELECT * FROM expenses WHERE id=$1", [
          expense,
        ]);
        await pool.query(
          await readFile("migrations/003_vehicle_period.sql", "utf8"),
        );
        await pool.query(
          await readFile("migrations/004_recognized_income.sql", "utf8"),
        );
        assert.deepEqual(
          (await pool.query("SELECT * FROM expenses WHERE id=$1", [expense]))
            .rows,
          before.rows,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM vehicle_cost_entries",
            )
          ).rows[0].n,
          0,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM vehicle_cost_profiles",
            )
          ).rows[0].n,
          0,
        );
      },
    );
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    type Result = {
      status: number;
      data: Record<string, unknown>;
      cookie: string;
    };
    async function raw(
      path: string,
      method = "GET",
      body?: unknown,
      cookie = "",
      key: string = randomUUID(),
    ): Promise<Result> {
      const response = await fetch(`${base}/api/v1${path}`, {
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
        status: response.status,
        data: (await response.json()) as Record<string, unknown>,
        cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
      };
    }
    const login = async (email: string) => {
      const r = await raw("/auth/login", "POST", { email, password });
      assert.equal(r.status, 200);
      return r.cookie;
    };
    const a = await login("owner@period.demo"),
      b = await login("other@period.demo"),
      viewer = await login("viewer@period.demo"),
      dispatcher = await login("dispatcher@period.demo"),
      accountant = await login("accountant@period.demo");
    async function createVehicle(cookie: string, name: string) {
      const r = await raw("/vehicles", "POST", { name, plate: name }, cookie);
      assert.equal(r.status, 201);
      return r.data.id as string;
    }
    const vehicle = await createVehicle(a, "PERIOD-A"),
      otherVehicle = await createVehicle(b, "PERIOD-B"),
      secondVehicle = await createVehicle(a, "PERIOD-C");
    const prefix = `/vehicles/${vehicle}/period`,
      range = "?start_date=2026-09-01&end_date=2026-09-30";
    const get = async () => {
      const r = await raw(prefix + range, "GET", undefined, a);
      assert.equal(r.status, 200, JSON.stringify(r.data));
      return r.data as unknown as {
        profile: { ownership: string; version: number } | null;
        readings: { id: string; version: number }[];
        pending_sources: { id: string }[];
        report: {
          total_cost: string;
          revision: number;
          costs_reviewed: boolean;
          entries: {
            id: string;
            source: string;
            source_id: string;
            source_warning: boolean;
            version: number;
          }[];
          metrics: Record<
            string,
            { status: string; value: string | null; unit_cost: string | null }
          >;
        };
      };
    };
    const post = async (
      path: string,
      body: unknown,
      cookie = a,
      key?: string,
    ) => raw(prefix + path, "POST", body, cookie, key);
    const manual = (
      amount: string,
      category = "fuel",
      date = "2026-09-15",
    ) => ({
      amount,
      category,
      date,
      currency: "RUB",
      note: "Synthetic recognized basis",
    });
    const reviewBody = (revision: number) => ({
      start_date: "2026-09-01",
      end_date: "2026-09-30",
      expected_revision: revision,
      states: applicableCategories("owned").map((category) => ({
        category,
        status: "reviewed",
        reason: "",
      })),
    });
    let firstReading = "",
      baseCost = "";
    await t.test(
      "no ownership backfill; missing readings retain actual money",
      async () => {
        assert.equal((await get()).profile, null);
        assert.equal((await post("/costs", manual("5000"))).status, 409);
        assert.equal(
          (await post("/ownership", { ownership: "owned", version: 0 })).status,
          201,
        );
        const r = await post("/costs", manual("5000"));
        assert.equal(r.status, 201);
        baseCost = r.data.id as string;
        const data = await get();
        assert.equal(data.report.total_cost, "5000.00");
        assert.equal(data.report.metrics.km.unit_cost, null);
      },
    );
    await t.test(
      "baseline is exactly 50000 / 1000 / 40; engine 50 is not work 40",
      async () => {
        assert.equal(
          (await post(`/costs/${baseCost}`, { ...manual("50000"), version: 1 }))
            .status,
          201,
        );
        const r = await post("/readings", {
          date: "2026-09-01",
          km: "10000",
          work_hours: "400",
          engine_hours: "500",
          note: "start",
        });
        assert.equal(r.status, 201);
        firstReading = r.data.id as string;
        assert.equal(
          (
            await post("/readings", {
              date: "2026-10-01",
              km: "11000",
              work_hours: "440",
              engine_hours: "550",
              note: "end",
            })
          ).status,
          201,
        );
        const data = await get();
        assert.equal(data.report.total_cost, "50000.00");
        assert.equal(data.report.metrics.km.unit_cost, "50.0000");
        assert.equal(data.report.metrics.work_hours.unit_cost, "1250.0000");
        assert.equal(data.report.metrics.engine_hours.unit_cost, null);
      },
    );
    await t.test(
      "specific cost add/edit/delete/add preserves identity and version conflicts",
      async () => {
        const added = await post("/costs", manual("10000", "other"));
        assert.equal(added.status, 201);
        const id = added.data.id as string;
        assert.equal(
          (await get()).report.metrics.work_hours.unit_cost,
          "1500.0000",
        );
        assert.equal(
          (
            await post(`/costs/${id}`, {
              ...manual("20000", "other"),
              version: 1,
            })
          ).status,
          201,
        );
        assert.equal((await get()).report.metrics.km.unit_cost, "70.0000");
        assert.equal(
          (await get()).report.metrics.work_hours.unit_cost,
          "1750.0000",
        );
        assert.equal(
          (await post(`/costs/${id}`, { ...manual("1", "other"), version: 1 }))
            .status,
          409,
        );
        assert.equal(
          (await post(`/costs/${id}/delete`, { version: 2 })).status,
          201,
        );
        assert.equal((await get()).report.total_cost, "50000.00");
        const fresh = await post("/costs", manual("10", "other"));
        assert.notEqual(fresh.data.id, id);
        await post(`/costs/${fresh.data.id}/delete`, { version: 1 });
      },
    );
    await t.test(
      "counter ordering, unknown values and duplicate dates reject without damage",
      async () => {
        const body = {
          date: "2026-09-01",
          km: "12000",
          work_hours: "400",
          engine_hours: "500",
          note: "bad",
          version: 1,
        };
        assert.equal(
          (await post(`/readings/${firstReading}`, body)).status,
          409,
        );
        assert.equal(
          (
            await post("/readings", {
              date: "2026-09-02",
              km: null,
              work_hours: null,
              engine_hours: null,
              note: "",
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await post("/readings", {
              ...body,
              version: undefined,
              km: "10000",
            })
          ).status,
          409,
        );
        assert.equal((await get()).report.metrics.km.value, "1000.000");
      },
    );
    await t.test(
      "reviews are versioned and invalidated by financial changes",
      async () => {
        const before = await get();
        assert.equal(
          (await post("/review", reviewBody(before.report.revision))).status,
          201,
        );
        assert.equal((await get()).report.costs_reviewed, true);
        const r = await post("/costs", manual("1"));
        assert.equal(r.status, 201);
        assert.equal(
          (await post("/review", reviewBody(before.report.revision))).status,
          409,
        );
        assert.equal((await get()).report.costs_reviewed, false);
        const invalid = reviewBody((await get()).report.revision);
        invalid.states[0].status = "zero";
        assert.equal((await post("/review", invalid)).status, 409);
        invalid.states[0].status = "not_applicable";
        assert.equal((await post("/review", invalid)).status, 400);
        await post(`/costs/${r.data.id}/delete`, { version: 1 });
      },
    );
    await t.test(
      "ownership conflicts and wrong precision cannot enter ledger",
      async () => {
        assert.equal((await post("/costs", manual("1", "rental"))).status, 409);
        const dep = await post("/costs", manual("1", "depreciation"));
        assert.equal(dep.status, 201);
        assert.equal(
          (await post("/ownership", { ownership: "rented", version: 1 }))
            .status,
          409,
        );
        assert.equal((await post("/costs", manual("1.001"))).status, 400);
        assert.equal(
          (await post("/costs", { ...manual("1", "other"), note: " " })).status,
          400,
        );
        await post(`/costs/${dep.data.id}/delete`, { version: 1 });
      },
    );
    let tripId = "",
      sourceId = "",
      linkedId = "";
    await t.test(
      "trip plan is never an actual; pending expense blocks full attestation",
      async () => {
        const trip = await raw(
          "/trips",
          "POST",
          {
            vehicle_id: vehicle,
            origin: "Synthetic origin",
            destination: "Synthetic destination",
            departure_date: "2026-09-15",
          },
          a,
        );
        assert.equal(trip.status, 201);
        tripId = trip.data.id as string;
        const plan = JSON.parse(
          await readFile("examples/trip-cost.json", "utf8"),
        );
        assert.equal(
          (await raw(`/trips/${tripId}/estimates`, "POST", plan, a)).status,
          201,
        );
        assert.equal((await get()).report.total_cost, "50000.00");
        const expense = await raw(
          `/trips/${tripId}/expenses`,
          "POST",
          {
            category: "other_direct",
            amount: "1000.00",
            currency: "RUB",
            incurred_on: "2026-09-20",
            note: "Specific trip source",
          },
          a,
        );
        assert.equal(expense.status, 201);
        sourceId = expense.data.id as string;
        const state = await get();
        assert.equal(state.report.total_cost, "50000.00");
        assert.equal(state.pending_sources[0].id, sourceId);
        assert.equal(
          (await post("/review", reviewBody(state.report.revision))).status,
          409,
        );
      },
    );
    await t.test(
      "replace duplicate manual entry by unique source; concurrent retry has one effect",
      async () => {
        const existing = await post(
          "/costs",
          manual("1000", "other", "2026-09-20"),
        );
        assert.equal(existing.status, 201);
        linkedId = existing.data.id as string;
        const body = {
          expense_id: sourceId,
          expense_version: 1,
          category: "other",
          note: "Same receipt, replace manual duplicate",
          replace_entry_id: linkedId,
          replace_version: 1,
        };
        const key = randomUUID();
        const rs = await Promise.all([
          post("/recognize", body, a, key),
          post("/recognize", body, a, key),
        ]);
        assert.deepEqual(
          rs.map((r) => r.status),
          [201, 201],
        );
        assert.equal(rs[0].data.id, rs[1].data.id);
        const report = await get();
        assert.equal(report.report.total_cost, "51000.00");
        assert.equal(report.pending_sources.length, 0);
        assert.equal(
          report.report.entries.filter((e) => e.source_id === sourceId).length,
          1,
        );
        assert.equal(
          (
            await post("/recognize", {
              ...body,
              replace_entry_id: null,
              replace_version: null,
            })
          ).status,
          409,
        );
        assert.equal(
          (await post(`/costs/${linkedId}`, { ...manual("10"), version: 2 }))
            .status,
          409,
        );
        assert.equal(
          (await post(`/costs/${linkedId}/delete`, { version: 2 })).status,
          409,
        );
      },
    );
    await t.test(
      "assignment changes do not silently move recognized cost, require recheck",
      async () => {
        const before = await get();
        await post("/review", reviewBody(before.report.revision));
        const changed = await raw(
          `/trips/${tripId}`,
          "PATCH",
          {
            vehicle_id: secondVehicle,
            origin: "Synthetic origin",
            destination: "Synthetic destination",
            departure_date: "2026-09-15",
            version: 1,
          },
          a,
        );
        assert.equal(changed.status, 200);
        const state = await get();
        assert.equal(state.report.total_cost, "51000.00");
        assert.equal(
          state.report.entries.find((e) => e.id === linkedId)?.source_warning,
          true,
        );
        assert.equal(state.report.costs_reviewed, false);
        const reassigned = await raw(
          `/vehicles/${secondVehicle}/period${range}`,
          "GET",
          undefined,
          a,
        );
        assert.equal(
          (reassigned.data.recognized_elsewhere as { id: string }[])[0].id,
          sourceId,
        );
        assert.equal(
          (reassigned.data.report as { total_cost: string }).total_cost,
          "0.00",
        );
        assert.equal(
          (await post("/review", reviewBody(state.report.revision))).status,
          409,
        );
        assert.equal(
          (
            await post("/recognize", {
              expense_id: sourceId,
              expense_version: 1,
              category: "other",
              note: "Retain original vehicle explicitly after reassignment",
              replace_entry_id: linkedId,
              replace_version: 2,
            })
          ).status,
          201,
        );
        assert.equal(
          (await get()).report.entries.find((e) => e.id === linkedId)
            ?.source_warning,
          false,
        );
      },
    );
    await t.test(
      "source edits follow recognition date and amount without copying; void excludes",
      async () => {
        // Existing public correction is void + new expense. Direct fixture edits also test future source edits.
        await pool.query(
          "UPDATE expenses SET amount=1200,incurred_on='2026-10-02',version=version+1 WHERE tenant_id=$1 AND id=$2",
          [tenant, sourceId],
        );
        assert.equal((await get()).report.total_cost, "50000.00");
        const october = await raw(
          prefix + "?start_date=2026-10-01&end_date=2026-10-31",
          "GET",
          undefined,
          a,
        );
        assert.equal(
          (october.data.report as { total_cost: string }).total_cost,
          "1200.00",
        );
        assert.equal(
          (
            await raw(
              `/expenses/${sourceId}/void`,
              "POST",
              { version: 2, reason: "Synthetic correction" },
              a,
            )
          ).status,
          201,
        );
        const after = await raw(
          prefix + "?start_date=2026-10-01&end_date=2026-10-31",
          "GET",
          undefined,
          a,
        );
        assert.equal(
          (after.data.report as { total_cost: string }).total_cost,
          "0.00",
        );
      },
    );
    await t.test(
      "all endpoints reject forbidden roles and foreign vehicles",
      async () => {
        const actions: [string, unknown][] = [
          ["/ownership", { ownership: "owned", version: 1 }],
          [
            "/readings",
            {
              date: "2026-09-03",
              km: "10001",
              work_hours: null,
              engine_hours: null,
              note: "",
            },
          ],
          [
            `/readings/${firstReading}`,
            {
              date: "2026-09-01",
              km: "10000",
              work_hours: "400",
              engine_hours: "500",
              note: "",
              version: 1,
            },
          ],
          [`/readings/${firstReading}/delete`, { version: 1 }],
          ["/costs", manual("1")],
          [`/costs/${baseCost}`, { ...manual("1"), version: 2 }],
          [`/costs/${baseCost}/delete`, { version: 2 }],
          [
            "/recognize",
            {
              expense_id: sourceId,
              expense_version: 3,
              category: "other",
              note: "Synthetic",
              replace_entry_id: null,
              replace_version: null,
            },
          ],
          ["/review", reviewBody((await get()).report.revision)],
        ];
        assert.equal((await raw(prefix + range)).status, 401);
        for (const cookie of [viewer, dispatcher]) {
          assert.equal(
            (await raw(prefix + range, "GET", undefined, cookie)).status,
            403,
          );
          for (const [path, body] of actions)
            assert.equal((await post(path, body, cookie)).status, 403, path);
        }
        assert.equal(
          (await raw(prefix + range, "GET", undefined, b)).status,
          404,
        );
        for (const [path, body] of actions)
          assert.equal((await post(path, body, b)).status, 404, path);
        assert.equal(
          (await raw(prefix + range, "GET", undefined, accountant)).status,
          200,
        );
        assert.equal(
          (
            await raw(
              `/vehicles/${otherVehicle}/period${range}`,
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
      "foreign entry IDs and composite foreign keys cannot bypass tenant scope",
      async () => {
        await raw(
          `/vehicles/${otherVehicle}/period/ownership`,
          "POST",
          { ownership: "owned", version: 0 },
          b,
        );
        const foreignCost = await raw(
          `/vehicles/${otherVehicle}/period/costs`,
          "POST",
          manual("100"),
          b,
        );
        assert.equal(
          (
            await post(`/costs/${foreignCost.data.id}`, {
              ...manual("1"),
              version: 1,
            })
          ).status,
          404,
        );
        await assert.rejects(
          pool.query(
            "INSERT INTO vehicle_readings(id,tenant_id,vehicle_id,date,km,note) VALUES($1,$2,$3,'2026-09-01',0,'cross')",
            [randomUUID(), tenant, otherVehicle],
          ),
          { code: "23503" },
        );
        await assert.rejects(
          pool.query(
            "INSERT INTO vehicle_cost_entries(id,tenant_id,vehicle_id,source,trip_expense_id,source_category,source_vehicle_id,category,note,created_by) VALUES($1,$2,$3,'trip',$4,'other_direct',$3,'other','cross source',$5)",
            [randomUUID(), foreign, otherVehicle, sourceId, otherOwner],
          ),
          { code: "23503" },
        );
      },
    );
    await t.test(
      "parallel changed expense and stale review never leave false attestation",
      async () => {
        const state = await get();
        const [expense, review] = await Promise.all([
          post("/costs", manual("1")),
          post("/review", reviewBody(state.report.revision)),
        ]);
        assert.equal(expense.status, 201);
        assert.ok([201, 409].includes(review.status));
        assert.equal((await get()).report.costs_reviewed, false);
      },
    );
    await t.test(
      "paged period HTTP preserves full aggregates, stable boundaries, roles and revisions",
      async () => {
        const v = await createVehicle(a, "PAGED"),
          p = `/vehicles/${v}/period`;
        assert.equal(
          (
            await raw(
              p + "/ownership",
              "POST",
              { ownership: "owned", version: 0 },
              a,
            )
          ).status,
          201,
        );
        const ids: string[] = [],
          incomeIds: string[] = [];
        for (let i = 0; i < 5; i++) {
          const cost = await raw(
            p + "/costs",
            "POST",
            manual(String(i + 1)),
            a,
          );
          assert.equal(cost.status, 201);
          ids.push(cost.data.id as string);
          const income = await raw(
            "/income",
            "POST",
            {
              vehicle_id: v,
              trip_id: null,
              recognized_on: "2026-09-15",
              amount: "10",
              currency: "RUB",
              source_ref: `PAGE-${i}`,
              note: "Synthetic income",
            },
            a,
          );
          assert.equal(income.status, 201);
          incomeIds.push(income.data.id as string);
        }
        const full = (await raw(p + range, "GET", undefined, a))
          .data as unknown as {
          report: {
            entries: { id: string }[];
            revision: number;
            total_cost: string;
            costs_reviewed: boolean;
          };
          income: {
            entries: { id: string }[];
            summary: Record<string, unknown>;
          };
        };
        const rev = full.report.revision;
        assert.equal(
          (await raw(p + "/review", "POST", reviewBody(rev), a)).status,
          201,
        );
        assert.equal(
          (
            await raw(
              p + "/income-review",
              "POST",
              {
                start_date: "2026-09-01",
                end_date: "2026-09-30",
                expected_revision: rev,
                status: "confirmed",
                reason: "All checked",
              },
              a,
            )
          ).status,
          201,
        );
        const paged = (
          await raw(p + range + "&page_size=2", "GET", undefined, a)
        ).data as unknown as typeof full & {
          pages: {
            costs: { next_offset: number };
            income: { next_offset: number };
          };
        };
        assert.equal(paged.report.total_cost, "15.00");
        assert.equal(paged.report.costs_reviewed, true);
        assert.equal(paged.income.summary.actual_revenue, "50.00");
        assert.equal(paged.income.summary.financial_result, "35.00");
        assert.equal(paged.income.summary.financial_result_reviewed, true);
        assert.equal(paged.report.entries.length, 2);
        assert.equal(paged.income.entries.length, 2);
        const pagePath = (kind: string, offset: number) =>
          p +
          `/entries${range}&kind=${kind}&limit=2&offset=${offset}&expected_revision=${rev}`;
        for (const [kind, expected] of [
          ["costs", ids],
          ["income", incomeIds],
        ] as const) {
          const seen: string[] = [];
          let offset: number | null = 0;
          while (offset !== null) {
            const result = await raw(
              pagePath(kind, offset),
              "GET",
              undefined,
              a,
            );
            assert.equal(result.status, 200);
            const page = result.data as unknown as {
              items: { id: string }[];
              next_offset: number | null;
              total: number;
              revision: number;
            };
            seen.push(...page.items.map((e) => e.id));
            offset = page.next_offset;
            assert.equal(page.total, 5);
            assert.equal(page.revision, rev);
          }
          assert.deepEqual(seen, [...expected].sort());
          assert.equal(
            (await raw(pagePath(kind, 5), "GET", undefined, a)).data
              .next_offset,
            null,
          );
          assert.deepEqual(
            (await raw(pagePath(kind, 5), "GET", undefined, a)).data.items,
            [],
          );
          assert.equal((await raw(pagePath(kind, 0))).status, 401);
          for (const cookie of [viewer, dispatcher])
            assert.equal(
              (await raw(pagePath(kind, 0), "GET", undefined, cookie)).status,
              403,
            );
          assert.equal(
            (await raw(pagePath(kind, 0), "GET", undefined, accountant)).status,
            200,
          );
          assert.equal(
            (await raw(pagePath(kind, 0), "GET", undefined, b)).status,
            404,
          );
        }
        for (const suffix of [
          "&limit=0",
          "&offset=-1",
          "&kind=unknown",
          "&tenant_id=foreign",
        ]) {
          assert.equal(
            (await raw(pagePath("costs", 0) + suffix, "GET", undefined, a))
              .status,
            400,
          );
        }
        const selected = ids.at(-1)!;
        const trip = await raw(
          "/trips",
          "POST",
          {
            vehicle_id: v,
            origin: "Synthetic A",
            destination: "Synthetic B",
            departure_date: "2026-09-15",
          },
          a,
        );
        const expense = await raw(
          `/trips/${trip.data.id}/expenses`,
          "POST",
          {
            category: "fuel",
            amount: "5",
            currency: "RUB",
            incurred_on: "2026-09-15",
            note: "Same synthetic receipt",
          },
          a,
        );
        assert.equal(expense.status, 201);
        assert.equal(
          (await raw(pagePath("costs", 2), "GET", undefined, a)).status,
          409,
        );
        assert.equal(
          (await raw(pagePath("income", 2), "GET", undefined, a)).status,
          409,
        );
        const body = {
          expense_id: expense.data.id,
          expense_version: 1,
          category: "fuel",
          note: "Replace selected manual source",
          replace_entry_id: selected,
          replace_version: 1,
        };
        const key = randomUUID();
        assert.equal(
          (await raw(p + "/recognize", "POST", body, a, key)).status,
          201,
        );
        assert.equal(
          (await raw(p + "/recognize", "POST", body, a, key)).status,
          201,
        );
        const refreshed = (
          await raw(p + range + "&page_size=2", "GET", undefined, a)
        ).data as unknown as typeof paged;
        assert.equal(refreshed.report.total_cost, "15.00");
        assert.equal(refreshed.report.costs_reviewed, false);
        assert.equal(refreshed.income.summary.financial_result_reviewed, false);
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int n FROM vehicle_cost_entries WHERE tenant_id=$1 AND vehicle_id=$2 AND trip_expense_id=$3",
              [tenant, v, expense.data.id],
            )
          ).rows[0].n,
          1,
        );
      },
    );
  } finally {
    await app.close();
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
