import Decimal from "decimal.js";
import { z } from "zod";
import { dateOnly } from "./operations";
import { periodRangeSchema } from "./period";
const D = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_UP });
export const incomeSchema = z
  .object({
    vehicle_id: z.uuid(),
    trip_id: z.uuid().nullable(),
    recognized_on: dateOnly,
    amount: z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$(?![\s\S])/),
    currency: z.literal("RUB"),
    source_ref: z
      .string()
      .trim()
      .min(3)
      .max(120)
      .transform((v) => v.toUpperCase()),
    note: z.string().trim().min(3).max(2000),
  })
  .strict();
export const incomeUpdateSchema = incomeSchema.extend({
  version: z.number().int().positive(),
  reason: z.string().trim().min(3).max(2000),
});
export const incomeVoidSchema = z
  .object({
    version: z.number().int().positive(),
    reason: z.string().trim().min(3).max(2000),
  })
  .strict();
export const incomeReviewSchema = z
  .object({
    ...periodRangeSchema.shape,
    expected_revision: z.number().int().nonnegative(),
    status: z.enum(["confirmed", "zero", "unreviewed"]),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
export type IncomeEntry = {
  id: string;
  vehicle_id: string;
  trip_id: string | null;
  recognized_on: string;
  amount: string;
  currency: "RUB";
  source_ref: string;
  note: string;
  version: number;
  voided_at: string | null;
  source_warning: boolean;
};
export type IncomeReview = {
  revision: number;
  status: "confirmed" | "zero" | "unreviewed";
  reason: string;
};
export function summarizeIncome(
  entries: IncomeEntry[],
  revision: number,
  review?: IncomeReview | null,
  cost: string | null = null,
  costsReviewed = false,
) {
  const active = entries.filter((e) => !e.voided_at);
  const sum = active.reduce((s, e) => s.plus(e.amount), new D(0));
  const warnings = active.some((e) => e.source_warning);
  const current = review?.revision === revision;
  const confirmed =
    !!current &&
    !warnings &&
    (review?.status === "confirmed" ||
      (review?.status === "zero" && sum.isZero()));
  const known = active.length > 0 || confirmed;
  const status = confirmed
    ? sum.isZero()
      ? "confirmed_zero"
      : "confirmed"
    : known
      ? "partial"
      : "unknown";
  return {
    status,
    recorded_total: sum.toFixed(2),
    actual_revenue: known ? sum.toFixed(2) : null,
    financial_result:
      known && cost !== null ? sum.minus(cost).toFixed(2) : null,
    income_reviewed: confirmed,
    financial_result_reviewed: confirmed && costsReviewed,
    review_current: !!current,
    source_warning: warnings,
    revision,
    review: current ? (review ?? null) : null,
  };
}
export type IncomeSummary = ReturnType<typeof summarizeIncome>;
export type IncomeWorkspace = {
  entries: IncomeEntry[];
  summary: IncomeSummary;
  recognized_elsewhere: {
    id: string;
    vehicle_id: string;
    source_ref: string;
    amount: string;
  }[];
};
