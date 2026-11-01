import assert from "node:assert/strict";
// Never read .env or default to a working database for integration tests.
export function isolatedDatabaseUrl() {
  const value = process.env.PERIOD_TEST_DATABASE_URL;
  assert.ok(
    value,
    "Set PERIOD_TEST_DATABASE_URL explicitly to the isolated test database",
  );
  const target = new URL(value);
  assert.ok(
    ["localhost", "127.0.0.1"].includes(target.hostname) &&
      target.pathname === "/fleet_period_test",
    "Only the dedicated local fleet_period_test database is accepted",
  );
  return target.toString();
}
