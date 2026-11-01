import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  calculateCost,
  compareCosts,
  expenseSchema,
  transitions,
} from "@fleet/shared";
const plan = calculateCost(
  JSON.parse(readFileSync("examples/trip-cost.json", "utf8")),
);
test("plan/fact: exact sums, categories and positive overrun", () => {
  const r = compareCosts(
    plan,
    {
      fuel: "11000.00",
      driver: "5000.00",
      maintenance: "2400.00",
      depreciation: "1800.00",
      tolls: "1500.00",
      other_direct: "500.00",
      overhead: "2800.00",
    },
    7,
  );
  assert.equal(r.actual_total, "25000.00");
  assert.equal(r.variance, "1020.00");
  assert.equal(r.variance_percent, "4.25");
  assert.equal(r.rows[0].variance, "200.00");
});
test("no actual entries is unknown, not savings", () => {
  const r = compareCosts(plan, {}, 0);
  assert.equal(r.actual_total, null);
  assert.equal(r.variance, null);
  assert.equal(r.variance_percent, null);
  assert.ok(r.rows.every((row) => row.actual === null));
});
test("unrecorded categories remain unknown with a partial actual total", () => {
  const r = compareCosts(plan, { fuel: "11000.00" }, 1);
  assert.equal(r.actual_total, "11000.00");
  assert.equal(r.rows[0].variance, "200.00");
  assert.ok(
    r.rows
      .slice(1)
      .every((row) => row.actual === null && row.variance === null),
  );
});
test("missing and zero plans do not invent percentages", () => {
  assert.equal(compareCosts(null, { fuel: "0.10" }, 1).variance, null);
  const r = compareCosts(
    { ...plan, total: "0.00" },
    { fuel: "0.10", driver: "0.20" },
    2,
  );
  assert.equal(r.actual_total, "0.30");
  assert.equal(r.variance, "0.30");
  assert.equal(r.variance_percent, null);
});
test("savings and rounding are decimal, not binary float", () => {
  const r = compareCosts(plan, { fuel: "0.10", driver: "0.20" }, 2);
  assert.equal(r.actual_total, "0.30");
  assert.equal(r.variance, "-23979.70");
  assert.equal(r.variance_percent, "-100.00");
});
test("expenses reject precision loss, invalid dates, unknown fields and nonpositive values", () => {
  const valid = {
    category: "fuel",
    amount: "12.50",
    currency: "RUB",
    incurred_on: "2026-10-24",
    note: "Synthetic receipt",
  };
  assert.ok(expenseSchema.safeParse(valid).success);
  for (const amount of ["0", "-1", "1.001", "NaN", "1e3", "1\n", 12])
    assert.equal(expenseSchema.safeParse({ ...valid, amount }).success, false);
  for (const incurred_on of ["0000-01-01", "2026-02-30"])
    assert.equal(
      expenseSchema.safeParse({ ...valid, incurred_on }).success,
      false,
    );
  assert.equal(
    expenseSchema.safeParse({ ...valid, tenant_id: "other" }).success,
    false,
  );
});
test("terminal statuses cannot reopen and cancellation stops before departure", () => {
  assert.deepEqual(transitions.completed, []);
  assert.deepEqual(transitions.cancelled, []);
  assert.deepEqual(transitions.in_progress, ["completed"]);
  assert.deepEqual(transitions.draft, ["planned", "cancelled"]);
});
