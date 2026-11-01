import test from "node:test";
import assert from "node:assert/strict";
import {
  applicableCategories,
  calculatePeriod,
  manualCostSchema,
  nextDay,
  periodRangeSchema,
  readingSchema,
  validCategory,
  type PeriodEntry,
  type PeriodReading,
  type ReviewState,
} from "@fleet/shared";
const readings: PeriodReading[] = [
  {
    id: "a",
    date: "2026-09-01",
    km: "10000",
    work_hours: "400",
    engine_hours: "500",
    version: 1,
    note: "",
  },
  {
    id: "b",
    date: "2026-10-01",
    km: "11000",
    work_hours: "440",
    engine_hours: "550",
    version: 1,
    note: "",
  },
];
const cost = (
  amount: string,
  extra: Partial<PeriodEntry> = {},
): PeriodEntry => ({
  id: "one",
  source: "manual",
  source_id: "one",
  vehicle_id: "vehicle",
  date: "2026-09-15",
  category: "fuel",
  amount,
  note: "Synthetic recognized cost",
  version: 1,
  source_version: null,
  voided: false,
  source_warning: false,
  ...extra,
});
const input = {
  ownership: "owned" as const,
  start_date: "2026-09-01",
  end_date: "2026-09-30",
  readings,
  entries: [cost("50000")],
  revision: 1,
};
const review = (revision = 1): { revision: number; states: ReviewState[] } => ({
  revision,
  states: applicableCategories("owned").map((category) => ({
    category,
    status: "reviewed",
    reason: "",
  })),
});
test("period golden: baseline, add, edit, delete restore the same two denominators", () => {
  for (const [entries, total, km, hour] of [
    [[cost("50000")], "50000.00", "50.0000", "1250.0000"],
    [
      [cost("50000"), cost("10000", { id: "specific", category: "other" })],
      "60000.00",
      "60.0000",
      "1500.0000",
    ],
    [
      [cost("50000"), cost("20000", { id: "specific", category: "other" })],
      "70000.00",
      "70.0000",
      "1750.0000",
    ],
    [
      [cost("50000"), cost("20000", { id: "specific", voided: true })],
      "50000.00",
      "50.0000",
      "1250.0000",
    ],
  ] as [PeriodEntry[], string, string, string][]) {
    const r = calculatePeriod({ ...input, entries });
    assert.equal(r.total_cost, total);
    assert.equal(r.metrics.km.unit_cost, km);
    assert.equal(r.metrics.work_hours.unit_cost, hour);
    assert.equal(r.metrics.engine_hours.value, "50.000");
    assert.equal(r.metrics.engine_hours.unit_cost, null);
  }
});
test("missing boundaries preserve 5000 cost without inventing activity", () => {
  const r = calculatePeriod({
    ...input,
    readings: [],
    entries: [cost("5000")],
  });
  assert.equal(r.total_cost, "5000.00");
  assert.equal(r.metrics.km.value, null);
  assert.equal(r.metrics.km.unit_cost, null);
  assert.equal(r.metrics.work_hours.status, "missing_boundary");
});
test("true zero is distinct from unknown; idle costs remain", () => {
  const r = calculatePeriod({
    ...input,
    readings: [readings[0], { ...readings[1], km: "10000", work_hours: null }],
  });
  assert.equal(r.metrics.km.status, "no_activity");
  assert.equal(r.metrics.km.value, "0.000");
  assert.equal(r.metrics.work_hours.status, "missing_boundary");
  assert.equal(r.total_cost, "50000.00");
});
test("no interpolation, and each meter has independent boundaries", () => {
  const r = calculatePeriod({
    ...input,
    readings: [
      { ...readings[0], work_hours: null },
      readings[1],
      { ...readings[0], date: "2026-08-31" },
    ],
  });
  assert.equal(r.metrics.km.unit_cost, "50.0000");
  assert.equal(r.metrics.work_hours.unit_cost, null);
  assert.equal(
    calculatePeriod({
      ...input,
      readings: [{ ...readings[0], date: "2026-08-31" }, readings[1]],
    }).metrics.km.unit_cost,
    null,
  );
});
test("zero costs require current review; all groups present never imply reviewed", () => {
  assert.equal(
    calculatePeriod({ ...input, entries: [] }).metrics.km.unit_cost,
    null,
  );
  assert.equal(
    calculatePeriod({ ...input, entries: [], review: review() }).metrics.km
      .unit_cost,
    "0.0000",
  );
  assert.equal(
    calculatePeriod({ ...input, entries: [], review: review(), revision: 2 })
      .metrics.km.unit_cost,
    null,
  );
  assert.equal(calculatePeriod(input).costs_reviewed, false);
});
test("unresolved and reassigned trip sources block full attestation", () => {
  assert.equal(
    calculatePeriod({ ...input, review: review(), unresolved_sources: 1 })
      .costs_reviewed,
    false,
  );
  assert.equal(
    calculatePeriod({
      ...input,
      review: review(),
      entries: [cost("50000", { source: "trip", source_warning: true })],
    }).costs_reviewed,
    false,
  );
});
test("date recognition controls membership; voids are excluded", () => {
  const r = calculatePeriod({
    ...input,
    entries: [
      cost("1", { date: "2026-09-01" }),
      cost("2", { date: "2026-09-30" }),
      cost("100", { date: "2026-10-01" }),
      cost("200", { voided: true }),
    ],
  });
  assert.equal(r.total_cost, "3.00");
});
test("decimal precision, half-up ties and tiny positive rates", () => {
  assert.equal(
    calculatePeriod({ ...input, entries: [cost("0.10"), cost("0.20")] })
      .total_cost,
    "0.30",
  );
  const tiny = calculatePeriod({ ...input, entries: [cost("0.01")] });
  assert.equal(tiny.metrics.km.unit_cost, "0.0000");
  assert.equal(tiny.metrics.km.unit_cost_below_precision, true);
  assert.equal(
    calculatePeriod({
      ...input,
      entries: [cost("0.01")],
      readings: [readings[0], { ...readings[1], km: "10008" }],
    }).metrics.km.unit_cost,
    "0.0013",
  );
});
test("calendar boundaries and invalid ranges", () => {
  assert.equal(nextDay("2024-02-28"), "2024-02-29");
  assert.equal(nextDay("2024-02-29"), "2024-03-01");
  assert.equal(nextDay("2026-12-31"), "2027-01-01");
  for (const range of [
    { start_date: "2026-02-30", end_date: "2026-03-01" },
    { start_date: "2026-10-01", end_date: "2026-09-01" },
    { start_date: "9999-12-01", end_date: "9999-12-31" },
  ])
    assert.equal(periodRangeSchema.safeParse(range).success, false);
});
test("26 groups, ownership and described specific costs", () => {
  assert.equal(applicableCategories("owned").length, 25);
  assert.ok(applicableCategories("rented").includes("rental"));
  assert.equal(validCategory("owned", "rental"), false);
  assert.equal(validCategory("rented", "depreciation"), false);
  assert.equal(validCategory("owned", "attachment_rental"), true);
  const body = {
    date: "2026-09-15",
    amount: "12.50",
    category: "other",
    currency: "RUB",
    note: "Specific hydraulic fluid",
  };
  assert.equal(manualCostSchema.safeParse(body).success, true);
  for (const amount of ["1.001", "-1", "NaN", "Infinity", "1e3", 1])
    assert.equal(
      manualCostSchema.safeParse({ ...body, amount }).success,
      false,
    );
  assert.equal(
    manualCostSchema.safeParse({ ...body, note: " " }).success,
    false,
  );
  assert.equal(
    readingSchema.safeParse({
      date: "2026-09-01",
      km: null,
      work_hours: null,
      engine_hours: null,
      note: "",
    }).success,
    false,
  );
});
