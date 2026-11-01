import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import Decimal from "decimal.js";
import { calculateCost, costFields, type CostInput } from "@fleet/shared";
const example: CostInput = JSON.parse(
  readFileSync("examples/trip-cost.json", "utf8"),
);
Decimal.set({ precision: 80 });
test("reference: TypeScript matches the original Python calculator", () => {
  const expected = JSON.parse(
    execFileSync(
      process.env.PYTHON || "python",
      ["scripts/calculate_trip.py", "examples/trip-cost.json"],
      { encoding: "utf8" },
    ),
  );
  assert.deepEqual(calculateCost(example), expected);
  assert.equal(expected.total, "23980.00");
  assert.equal(expected.target_price, "29975.00");
});
test("zero distance and revenue preserve undefined ratios", () => {
  const r = calculateCost({
    ...example,
    loaded_km: "0",
    empty_km: "0",
    revenue: "0",
  });
  assert.equal(r.cost_per_km, null);
  assert.equal(r.actual_margin, null);
  assert.ok(new Decimal(r.total).gt(0));
});
test("optional revenue is not zero", () => {
  const { revenue, ...input } = example;
  assert.ok(revenue);
  const r = calculateCost(input);
  assert.equal(r.revenue, null);
  assert.equal(r.profit, null);
});
test("reject missing, unknown fields and unsupported currency", () => {
  const { loaded_km, ...input } = example;
  assert.ok(loaded_km);
  for (const data of [
    input,
    { ...example, tenant_id: "foreign" },
    { ...example, currency: "USD" },
    null,
    [],
  ])
    assert.throws(() => calculateCost(data));
});
test("reject non-decimal and out-of-range inputs", () => {
  for (const value of [
    "",
    "-1",
    "NaN",
    "Infinity",
    "1e3",
    "1,5",
    "1\n",
    "1.0000001",
    "1000000000000",
    5,
  ])
    assert.throws(() => calculateCost({ ...example, loaded_km: value }));
  assert.throws(() => calculateCost({ ...example, target_margin: "1" }));
  assert.throws(() => calculateCost({ ...example, overhead_rate: "1.000001" }));
});
test("line rounding reconciles and price rounds up", () => {
  const zero = Object.fromEntries(costFields.map((k) => [k, "0"]));
  const r = calculateCost({
    ...zero,
    currency: "RUB",
    tolls: "0.005",
    other_direct: "0.005",
    target_margin: "0.3",
    revenue: "0.025",
  });
  assert.equal(r.lines.tolls, "0.01");
  assert.equal(r.total, "0.02");
  assert.equal(r.target_price, "0.03");
  assert.equal(r.revenue, "0.03");
  assert.equal(r.profit, "0.01");
  assert.equal(r.actual_margin, "0.333333");
});
test("empty mileage increases costs and margin near one stays exact", () => {
  const r = calculateCost({ ...example, target_margin: "0.999999" });
  assert.equal(r.target_price, "23980000000.00");
  assert.ok(
    new Decimal(calculateCost({ ...example, empty_km: "0" }).total).lt(r.total),
  );
});
test("all displayed components sum exactly even for large inputs", () => {
  const input = {
    ...example,
    loaded_km: "999999999999.999999",
    fuel_l_per_100km: "999999999999.999999",
    fuel_price_per_l: "999999999999.999999",
  };
  const r = calculateCost(input);
  const sum = Object.values(r.lines).reduce(
    (a, b) => a.plus(b),
    new Decimal(0),
  );
  assert.equal(sum.toFixed(2), r.direct);
  assert.equal(sum.plus(r.overhead).toFixed(2), r.total);
});
