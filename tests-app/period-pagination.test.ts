import test from "node:test";
import assert from "node:assert/strict";
import {
  periodEntriesQuerySchema,
  periodReportQuerySchema,
  periodPage,
  calculatePeriod,
  summarizeIncome,
  applicableCategories,
  type PeriodEntry,
  type IncomeEntry,
  type PeriodPage,
} from "@fleet/shared";
const range = { start_date: "2026-09-01", end_date: "2026-09-30" };
test("period pagination validates explicit revision, integer bounds and legacy report", () => {
  assert.deepEqual(periodReportQuerySchema.parse(range), range);
  for (const page_size of ["0", "101", "1.5", "", ["20", "30"]]) {
    assert.equal(
      periodReportQuerySchema.safeParse({ ...range, page_size }).success,
      false,
    );
  }
  const q = { ...range, kind: "costs", expected_revision: "8" };
  assert.equal(periodEntriesQuerySchema.parse(q).limit, 20);
  for (const extra of [
    { limit: "0" },
    { limit: "101" },
    { offset: "-1" },
    { offset: "1000001" },
    { offset: "1.5" },
    { limit: "01" },
    { limit: ["20", "30"] },
    { expected_revision: undefined },
    { expected_revision: "2147483648" },
    { kind: "other" },
    { tenant_id: "foreign" },
    { start_date: "2026-10-01" },
    { end_date: "2026-09-31" },
  ]) {
    assert.equal(
      periodEntriesQuerySchema.safeParse({ ...q, ...extra }).success,
      false,
      JSON.stringify(extra),
    );
  }
});
test("stable equal-date collection traverses first, exact boundary, tail and empty pages once", () => {
  const rows = Array.from({ length: 41 }, (_, i) => ({
    date: range.start_date,
    id: String(i).padStart(3, "0"),
  }));
  const collected = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const p: PeriodPage<(typeof rows)[number]> = periodPage(
      rows,
      20,
      offset,
      8,
    );
    collected.push(...p.items);
    offset = p.next_offset;
    assert.equal(p.revision, 8);
    assert.equal(p.total, 41);
  }
  assert.deepEqual(collected, rows);
  assert.equal(new Set(collected.map((r) => r.id)).size, 41);
  assert.equal(periodPage(rows.slice(0, 40), 20, 20, 8).next_offset, null);
  assert.deepEqual(periodPage(rows, 20, 41, 8).items, []);
  assert.equal(periodPage([], 20, 0, 0).next_offset, null);
});
test("late-page money and warnings contribute to full totals and completeness", () => {
  const entries: PeriodEntry[] = Array.from({ length: 21 }, (_, i) => ({
    id: `cost-${i}`,
    source: "manual",
    source_id: `cost-${i}`,
    vehicle_id: "synthetic",
    date: range.start_date,
    category: "fuel",
    amount: i === 20 ? "50000.00" : "0.00",
    note: "Synthetic",
    version: 1,
    source_version: null,
    voided: false,
    source_warning: false,
  }));
  const report = calculatePeriod({
    ...range,
    ownership: "owned",
    entries,
    readings: [],
    revision: 8,
    review: {
      revision: 8,
      states: applicableCategories("owned").map((category) => ({
        category,
        status: "reviewed",
        reason: "",
      })),
    },
  });
  const incomes: IncomeEntry[] = entries.map((e, i) => ({
    id: `income-${i}`,
    vehicle_id: e.vehicle_id,
    trip_id: null,
    recognized_on: e.date,
    amount: i === 20 ? "100000.00" : "0.00",
    currency: "RUB",
    source_ref: `BASIS-${i}`,
    note: e.note,
    version: 1,
    voided_at: null,
    source_warning: false,
  }));
  const summary = summarizeIncome(
    incomes,
    8,
    { revision: 8, status: "confirmed", reason: "Checked" },
    report.total_cost,
    report.costs_reviewed,
  );
  assert.equal(
    periodPage(report.entries, 20, 0, 8).items.every(
      (e) => e.amount === "0.00",
    ),
    true,
  );
  assert.equal(report.total_cost, "50000.00");
  assert.equal(summary.financial_result, "50000.00");
  assert.equal(summary.financial_result_reviewed, true);
  const warning = summarizeIncome(
    incomes.map((e, i) => ({ ...e, source_warning: i === 20 })),
    8,
    { revision: 8, status: "confirmed", reason: "Checked" },
    report.total_cost,
    true,
  );
  assert.equal(warning.source_warning, true);
  assert.equal(warning.income_reviewed, false);
});
