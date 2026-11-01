import test from "node:test";
import assert from "node:assert/strict";
import { incomeSchema, summarizeIncome, type IncomeEntry } from "@fleet/shared";
const entry = (
  amount: string,
  extra: Partial<IncomeEntry> = {},
): IncomeEntry => ({
  id: "one",
  vehicle_id: "vehicle",
  trip_id: null,
  recognized_on: "2026-09-01",
  amount,
  currency: "RUB",
  source_ref: "SOURCE-1",
  note: "Synthetic",
  version: 1,
  voided_at: null,
  source_warning: false,
  ...extra,
});
test("income unknown is not zero, and unknown result is not a loss", () => {
  const r = summarizeIncome([], 1, null, "50000", true);
  assert.equal(r.status, "unknown");
  assert.equal(r.actual_revenue, null);
  assert.equal(r.financial_result, null);
});
test("recorded income is partial until reviewed; profit does not replace gross cost", () => {
  const r = summarizeIncome([entry("80000")], 1, null, "50000", true);
  assert.equal(r.actual_revenue, "80000.00");
  assert.equal(r.financial_result, "30000.00");
  assert.equal(r.status, "partial");
  assert.equal(r.financial_result_reviewed, false);
});
test("confirmed zero without entries is known and yields a separately labelled loss", () => {
  const r = summarizeIncome(
    [],
    1,
    { revision: 1, status: "zero", reason: "Checked no income" },
    "50000",
    true,
  );
  assert.equal(r.status, "confirmed_zero");
  assert.equal(r.financial_result, "-50000.00");
  assert.equal(r.financial_result_reviewed, true);
});
test("income precision, void, stale review and source warnings", () => {
  const rows = [
    entry("0.10"),
    entry("0.20"),
    entry("999", { voided_at: "2026-10-01" }),
  ];
  const review = {
    revision: 1,
    status: "confirmed" as const,
    reason: "Checked",
  };
  assert.equal(
    summarizeIncome(rows, 1, review, "0.10", true).financial_result,
    "0.20",
  );
  assert.equal(summarizeIncome(rows, 2, review).status, "partial");
  assert.equal(
    summarizeIncome([entry("10", { source_warning: true })], 1, review)
      .income_reviewed,
    false,
  );
  assert.equal(
    summarizeIncome(rows, 1, review, "0.10", false).financial_result_reviewed,
    false,
  );
});
test("income validation rejects ambiguity and precision loss; reference canonicalized", () => {
  const body = {
    vehicle_id: "10000000-0000-4000-8000-000000000001",
    trip_id: null,
    recognized_on: "2026-09-01",
    amount: "0",
    currency: "RUB",
    source_ref: " abc-1 ",
    note: "Synthetic",
  };
  assert.equal(incomeSchema.parse(body).source_ref, "ABC-1");
  for (const amount of ["1.001", "-1", "NaN", 1])
    assert.equal(incomeSchema.safeParse({ ...body, amount }).success, false);
  assert.equal(
    incomeSchema.safeParse({ ...body, recognized_on: "2026-02-30" }).success,
    false,
  );
  assert.equal(
    incomeSchema.safeParse({ ...body, source_ref: "" }).success,
    false,
  );
});
