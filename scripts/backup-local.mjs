import { config } from "dotenv";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
config({ quiet: true });
const db = new URL(process.env.DATABASE_URL);
if (db.hostname !== "127.0.0.1" || db.pathname !== "/fleet_saas")
  throw new Error("Ожидалась локальная база Fleet");
mkdirSync("work/backups", { recursive: true });
const file = resolve(
  "work/backups",
  `fleet-${new Date().toISOString().replaceAll(":", "-")}.dump`,
);
execFileSync(
  resolve("work/pgsql/bin/pg_dump.exe"),
  [
    "-h",
    db.hostname,
    "-p",
    db.port,
    "-U",
    decodeURIComponent(db.username),
    "-d",
    db.pathname.slice(1),
    "-Fc",
    "-f",
    file,
  ],
  {
    env: { ...process.env, PGPASSWORD: decodeURIComponent(db.password) },
    stdio: "pipe",
  },
);
console.log(`Резервная копия: ${file}`);
