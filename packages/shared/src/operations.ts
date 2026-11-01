import { z } from "zod";
import Decimal from "decimal.js";
const D = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_UP });
export const tripStatuses = [
  "draft",
  "planned",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export type TripStatus = (typeof tripStatuses)[number];
export const statusLabels: Record<TripStatus, string> = {
  draft: "Черновик",
  planned: "Запланирован",
  in_progress: "В пути",
  completed: "Завершён",
  cancelled: "Отменён",
};
export const transitions: Record<TripStatus, TripStatus[]> = {
  draft: ["planned", "cancelled"],
  planned: ["in_progress", "cancelled"],
  in_progress: ["completed"],
  completed: [],
  cancelled: [],
};
export const dateOnly = z.iso
  .date()
  .refine((v) => !v.startsWith("0000-"), "Год должен быть больше нуля");
export const driverSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    staff_code: z
      .string()
      .trim()
      .min(2)
      .max(30)
      .transform((v) => v.toUpperCase()),
  })
  .strict();
export const driverUpdateSchema = driverSchema.extend({
  active: z.boolean(),
  version: z.number().int().positive(),
});
export const assignmentSchema = z
  .object({
    vehicle_id: z.uuid(),
    driver_id: z.uuid().nullable(),
    version: z.number().int().positive(),
  })
  .strict();
export const statusSchema = z
  .object({
    status: z.enum(tripStatuses),
    version: z.number().int().positive(),
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .strict();
export const expenseCategories = [
  "fuel",
  "driver",
  "maintenance",
  "depreciation",
  "tolls",
  "other_direct",
  "overhead",
] as const;
export type ExpenseCategory = (typeof expenseCategories)[number];
export const categoryLabels: Record<ExpenseCategory, string> = {
  fuel: "Топливо",
  driver: "Работа водителя",
  maintenance: "Обслуживание",
  depreciation: "Амортизация",
  tolls: "Платные дороги",
  other_direct: "Прочие прямые",
  overhead: "Накладные",
};
export const expenseSchema = z
  .object({
    category: z.enum(expenseCategories),
    amount: z
      .string()
      .regex(
        /^\d{1,12}(?:\.\d{1,2})?$(?![\s\S])/,
        "Сумма: число с точкой, не более двух знаков после точки",
      )
      .pipe(
        z
          .string()
          .refine((v) => new D(v).gt(0), "Сумма должна быть больше нуля"),
      ),
    currency: z.literal("RUB"),
    incurred_on: dateOnly,
    note: z.string().trim().min(3).max(500),
  })
  .strict();
export const voidExpenseSchema = z
  .object({
    version: z.number().int().positive(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
export type Driver = {
  id: string;
  name: string;
  staff_code: string;
  active: boolean;
  version: number;
  created_at: string;
};
export type Expense = {
  id: string;
  trip_id: string;
  category: ExpenseCategory;
  amount: string;
  currency: "RUB";
  incurred_on: string;
  note: string;
  created_at: string;
  version: number;
  voided_at: string | null;
  void_reason: string | null;
};
export type StatusEvent = {
  id: string;
  from_status: TripStatus;
  to_status: TripStatus;
  reason: string | null;
  trip_version: number;
  created_at: string;
};
export type AssignmentSnapshot = {
  vehicle_id: string;
  vehicle_name: string;
  plate: string;
  driver_id: string | null;
  driver_name: string | null;
  origin: string;
  destination: string;
  departure_date: string;
};
export function compareCosts(
  plan: {
    lines: Record<string, string>;
    overhead: string;
    total: string;
  } | null,
  actuals: Partial<Record<ExpenseCategory, string>>,
  entryCount: number,
) {
  const total = expenseCategories.reduce(
    (sum, key) => sum.plus(actuals[key] || "0"),
    new D(0),
  );
  const hasActual = entryCount > 0;
  const difference = (p: string | null, a: Decimal) =>
    p === null || !hasActual ? null : a.minus(p).toFixed(2);
  const rows = expenseCategories.map((category) => {
    const p = plan
      ? category === "overhead"
        ? plan.overhead
        : plan.lines[category]
      : null;
    const a = new D(actuals[category] || "0");
    const hasCategory = hasActual && actuals[category] !== undefined;
    return {
      category,
      plan: p,
      actual: hasCategory ? a.toFixed(2) : null,
      variance: hasCategory ? difference(p, a) : null,
    };
  });
  return {
    currency: "RUB" as const,
    entry_count: entryCount,
    has_actual: hasActual,
    plan_total: plan?.total ?? null,
    actual_total: hasActual ? total.toFixed(2) : null,
    variance: difference(plan?.total ?? null, total),
    variance_percent:
      plan && hasActual && !new D(plan.total).isZero()
        ? total.minus(plan.total).div(plan.total).mul(100).toFixed(2)
        : null,
    rows,
  };
}
export type Comparison = ReturnType<typeof compareCosts> & {
  plan_id: string | null;
  plan_mode: "latest" | "frozen";
  assignment_version: number | null;
  plan_created_at: string | null;
};
