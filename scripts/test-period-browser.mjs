import { build } from "esbuild";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
// esbuild is already provided by tsx; no browser download or package installation.
// Set CHROME_BIN explicitly; each run owns a new profile and never touches open tabs.
if (!process.env.CHROME_BIN)
  throw new Error("Set CHROME_BIN to an existing Chrome/Chromium binary");
const temp = await mkdtemp(join(tmpdir(), "fleet-period-browser-"));
async function cleanup() {
  if (
    dirname(resolve(temp)) !== resolve(tmpdir()) ||
    !basename(temp).startsWith("fleet-period-browser-")
  )
    throw new Error("Unsafe temporary cleanup target");
  await rm(temp, {
    recursive: true,
    force: true,
    maxRetries: 4,
    retryDelay: 100,
  });
}
try {
  await build({
    entryPoints: [resolve("tests-app/period-browser.tsx")],
    bundle: true,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    // Exercise current source even when the working application's dist is older.
    alias: { "@fleet/shared": resolve("packages/shared/src/index.ts") },
    outfile: join(temp, "test.js"),
    define: { "process.env.NODE_ENV": '"development"' },
  });
  await writeFile(
    join(temp, "index.html"),
    '<!doctype html><meta charset="utf-8"><div id="root"></div><pre id="result" data-status="running"></pre><script src="test.js"></script>',
  );
  const { stdout } = await promisify(execFile)(
    process.env.CHROME_BIN,
    [
      "--headless",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      `--user-data-dir=${join(temp, "profile")}`,
      "--virtual-time-budget=20000",
      "--dump-dom",
      pathToFileURL(join(temp, "index.html")).href,
    ],
    { windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024 },
  );
  const result = stdout.match(
    /<pre id="result" data-status="([^"]+)">([\s\S]*?)<\/pre>/,
  );
  console.log(result?.[2] ?? "Browser produced no test result");
  if (result?.[1] !== "passed") process.exitCode = 1;
} finally {
  await cleanup();
}
