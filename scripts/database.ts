import { config } from "dotenv";
import { Pool } from "pg";
import { readFile, readdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { hashPassword } from "../apps/api/src/password";
import { calculateCost } from "@fleet/shared";
config({ quiet: true });
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL обязателен");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(827341)");
    if (process.argv[2] === "migrate") {
      await c.query(
        "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
      );
      for (const name of (await readdir("migrations"))
        .filter((n) => n.endsWith(".sql"))
        .sort()) {
        const sql = await readFile(`migrations/${name}`, "utf8");
        const checksum = createHash("sha256").update(sql).digest("hex");
        const prior = await c.query(
          "SELECT checksum FROM schema_migrations WHERE name=$1",
          [name],
        );
        if (prior.rows[0]) {
          if (prior.rows[0].checksum !== checksum)
            throw new Error(`Изменена применённая миграция ${name}`);
          continue;
        }
        await c.query(sql);
        await c.query(
          "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",
          [name, checksum],
        );
        console.log(`Applied ${name}`);
      }
    } else if (process.argv[2] === "seed") {
      if (process.env.APP_ENV !== "development" || !process.env.DEMO_PASSWORD)
        throw new Error("Seed требует APP_ENV=development и DEMO_PASSWORD");
      const input = JSON.parse(
        await readFile("examples/trip-cost.json", "utf8"),
      );
      const result = calculateCost(input);
      const tenants = [
        {
          id: "10000000-0000-4000-8000-000000000001",
          name: "Север · демо",
          prefix: "sever",
          vehicle: "Тягач Север 01",
          plate: "ДЕМО-001",
        },
        {
          id: "20000000-0000-4000-8000-000000000002",
          name: "Вектор · демо",
          prefix: "vector",
          vehicle: "Фургон Вектор 01",
          plate: "ДЕМО-002",
        },
      ];
      for (const t of tenants) {
        await c.query(
          "INSERT INTO organizations(id,name) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [t.id, t.name],
        );
        let owner = "";
        for (const role of ["owner", "dispatcher", "accountant", "viewer"]) {
          const email = `${role}@${t.prefix}.demo`;
          const existing = await c.query(
            "SELECT id FROM users WHERE email=$1",
            [email],
          );
          const uid = existing.rows[0]?.id || randomUUID();
          if (!existing.rows[0])
            await c.query(
              "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)",
              [
                uid,
                email,
                `${role} · ${t.name}`,
                await hashPassword(process.env.DEMO_PASSWORD),
              ],
            );
          await c.query(
            "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
            [t.id, uid, role],
          );
          if (role === "owner") owner = uid;
        }
        const exists = await c.query(
          "SELECT id FROM vehicles WHERE tenant_id=$1 AND plate=$2",
          [t.id, t.plate],
        );
        await c.query(
          "INSERT INTO drivers(id,tenant_id,name,staff_code) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,staff_code) DO NOTHING",
          [
            randomUUID(),
            t.id,
            `Демо-водитель ${t.prefix === "sever" ? "Север" : "Вектор"} 01`,
            "DEMO-01",
          ],
        );
        if (!exists.rows[0]) {
          const vid = randomUUID(),
            tid = randomUUID();
          await c.query(
            "INSERT INTO vehicles(id,tenant_id,name,plate) VALUES($1,$2,$3,$4)",
            [vid, t.id, t.vehicle, t.plate],
          );
          await c.query(
            "INSERT INTO trips(id,tenant_id,vehicle_id,origin,destination,departure_date) VALUES($1,$2,$3,$4,$5,$6)",
            [
              tid,
              t.id,
              vid,
              "Склад Северный (демо)",
              "Терминал Южный (демо)",
              "2026-10-26",
            ],
          );
          await c.query(
            `INSERT INTO cost_estimates(id,tenant_id,trip_id,currency,calculation_version,tariff_version,input_snapshot,result,total,created_by) VALUES($1,$2,$3,'RUB','1','manual-v1',$4,$5,$6,$7)`,
            [
              randomUUID(),
              t.id,
              tid,
              JSON.stringify(input),
              JSON.stringify(result),
              result.total,
              owner,
            ],
          );
        }
      }
      console.log(
        "Демо: Север и Вектор, по четыре роли. Пароль берётся из DEMO_PASSWORD в .env.",
      );
    } else throw new Error("Используйте migrate или seed");
    await c.query("COMMIT");
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally {
    c.release();
    await pool.end();
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Database setup failed",
  );
  process.exitCode = 1;
});
