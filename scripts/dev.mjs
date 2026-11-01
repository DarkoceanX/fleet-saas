import { spawn } from "node:child_process";
import { config } from "dotenv";
config({ quiet: true });
const children = [];
const run = (args) => {
  const p = spawn(process.execPath, args, {
    stdio: "inherit",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  });
  children.push(p);
  return p;
};
const build = run([
  "node_modules/typescript/bin/tsc",
  "-p",
  "packages/shared/tsconfig.json",
]);
await new Promise((resolve, reject) => {
  build.on("exit", (code) =>
    code === 0 ? resolve() : reject(new Error("Shared build failed")),
  );
});
const apiBuild = run([
  "node_modules/typescript/bin/tsc",
  "-p",
  "apps/api/tsconfig.json",
]);
await new Promise((resolve, reject) => {
  apiBuild.on("exit", (code) =>
    code === 0 ? resolve() : reject(new Error("API build failed")),
  );
});
const api = run(["apps/api/dist/main.js"]);
const web = run([
  "node_modules/next/dist/bin/next",
  "dev",
  "apps/web",
  "--hostname",
  "127.0.0.1",
  "--port",
  "3000",
]);
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of [api, web])
  child.on("exit", (code) => {
    if (!stopping) {
      process.exitCode = code || 1;
      stop();
    }
  });
