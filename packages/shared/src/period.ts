import Decimal from "decimal.js";
import { z } from "zod";
import { dateOnly } from "./operations";

const D = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_UP });
export const periodCategories = {
  fuel: "Топливо и электроэнергия / зарядка",
  lubricants: "Масла и смазки",
  technical_fluids: "Технические жидкости",
  consumables: "Расходные материалы",
  driver_pay: "Зарплата водителя / оператора",
  payroll_charges: "Начисления на оплату труда",
  operator_related: "Командировки, медосмотры, обучение и СИЗ",
  tires: "Износ шин, гусениц и ходовой",
  repairs_maintenance: "Ремонт и ТО: работы и услуги",
  technical_inspection: "Техосмотр, освидетельствование и поверки",
  diagnostics: "Диагностика и испытания",
  spare_parts: "Запчасти вне уже учтённого ремонта",
  insurance_tax: "Страхование и транспортный налог",
  permits_fees: "Регистрация, разрешения и сборы",
  attachment_rental: "Аренда навесного оборудования",
  parking_storage: "Парковка, гараж, хранение и охрана",
  washing: "Мойка и очистка",
  tolls: "Платные дороги и маршрутные сборы",
  evacuation: "Перебазировка, доставка и эвакуация",
  communications: "Связь, GPS и ИТ",
  overhead: "Распределённые расходы базы и управления",
  financing_interest: "Проценты и комиссии — расширенный состав",
  incidents: "Аварийные и внеплановые потери",
  depreciation: "Амортизация собственной техники",
  rental: "Аренда самой техники",
  other: "Другие затраты — конкретное основание",
} as const;
export type PeriodCategory = keyof typeof periodCategories;
export const periodCategoryIds = Object.keys(
  periodCategories,
) as PeriodCategory[];
export const meterNames = {
  km: "Пробег, км",
  work_hours: "Фактические рабочие часы",
  engine_hours: "Моточасы двигателя (справочно)",
} as const;
export type Meter = keyof typeof meterNames;
export type Ownership = "owned" | "rented";
export const categorySchema = z.enum(
  periodCategoryIds as [PeriodCategory, ...PeriodCategory[]],
);
const amount = z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$(?![\s\S])/);
const meter = z
  .string()
  .regex(/^\d{1,9}(?:\.\d{1,3})?$(?![\s\S])/)
  .nullable();
export const periodRangeSchema = z
  .object({ start_date: dateOnly, end_date: dateOnly })
  .strict()
  .refine(
    (v) => v.start_date <= v.end_date && v.end_date < "9999-12-31",
    "Проверьте границы периода; нужен следующий день после конца",
  );
export const versionSchema = z
  .object({ version: z.number().int().positive() })
  .strict();
export const ownershipSchema = z
  .object({
    ownership: z.enum(["owned", "rented"]),
    version: z.number().int().nonnegative(),
  })
  .strict();
export const readingSchema = z
  .object({
    date: dateOnly,
    km: meter,
    work_hours: meter,
    engine_hours: meter,
    note: z.string().trim().max(2000),
  })
  .strict()
  .refine(
    (v) => Object.keys(meterNames).some((k) => v[k as Meter] !== null),
    "Укажите хотя бы один счётчик",
  );
export const readingUpdateSchema = z
  .object({ ...readingSchema.shape, version: z.number().int().positive() })
  .strict()
  .refine(
    (v) => Object.keys(meterNames).some((k) => v[k as Meter] !== null),
    "Укажите хотя бы один счётчик",
  );
export const manualCostSchema = z
  .object({
    date: dateOnly,
    category: categorySchema,
    amount,
    currency: z.literal("RUB"),
    note: z.string().trim().min(3).max(2000),
  })
  .strict();
export const manualCostUpdateSchema = manualCostSchema.extend({
  version: z.number().int().positive(),
});
export const recognizeSchema = z
  .object({
    expense_id: z.uuid(),
    expense_version: z.number().int().positive(),
    category: categorySchema,
    note: z.string().trim().min(3).max(2000),
    replace_entry_id: z.uuid().nullable(),
    replace_version: z.number().int().positive().nullable(),
  })
  .strict()
  .refine(
    (v) => (v.replace_entry_id === null) === (v.replace_version === null),
    "Укажите запись и её версию вместе",
  );
export const reviewStates = [
  "unreviewed",
  "reviewed",
  "zero",
  "not_applicable",
] as const;
export const reviewSchema = z
  .object({
    ...periodRangeSchema.shape,
    expected_revision: z.number().int().nonnegative(),
    states: z
      .array(
        z
          .object({
            category: categorySchema,
            status: z.enum(reviewStates),
            reason: z.string().trim().max(500),
          })
          .strict(),
      )
      .max(26),
  })
  .strict();
export type ReviewState = z.infer<typeof reviewSchema>["states"][number];
export type PeriodReading = {
  id: string;
  date: string;
  km: string | null;
  work_hours: string | null;
  engine_hours: string | null;
  note: string;
  version: number;
};
export type PeriodEntry = {
  id: string;
  source: "manual" | "trip";
  source_id: string;
  vehicle_id: string;
  date: string;
  category: PeriodCategory;
  amount: string;
  note: string;
  version: number;
  source_version: number | null;
  voided: boolean;
  source_warning: boolean;
};
export function nextDay(value: string) {
  const d = new Date(`${value}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
export function applicableCategories(ownership: Ownership) {
  return periodCategoryIds.filter(
    (c) => c !== (ownership === "owned" ? "rental" : "depreciation"),
  );
}
export function validCategory(ownership: Ownership, category: PeriodCategory) {
  return applicableCategories(ownership).includes(category);
}
export function calculatePeriod(input: {
  ownership: Ownership | null;
  start_date: string;
  end_date: string;
  readings: PeriodReading[];
  entries: PeriodEntry[];
  revision: number;
  review?: { revision: number; states: ReviewState[] } | null;
  unresolved_sources?: number;
}) {
  const { start_date, end_date } = periodRangeSchema.parse({
    start_date: input.start_date,
    end_date: input.end_date,
  });
  return calculateValidatedPeriod(input, start_date, end_date);
}
function calculateValidatedPeriod(
  input: Parameters<typeof calculatePeriod>[0],
  start_date: string,
  end_date: string,
) {
  const end = nextDay(end_date);
  const expected = input.ownership
    ? applicableCategories(input.ownership)
    : periodCategoryIds;
  const entries = input.entries.filter(
    (e) => !e.voided && e.date >= start_date && e.date <= end_date,
  );
  const total = entries.reduce((s, e) => s.plus(e.amount), new D(0));
  const current = input.review?.revision === input.revision;
  const states = current ? input.review!.states : [];
  const sourceWarnings = entries.filter((e) => e.source_warning).length;
  const unresolved = input.unresolved_sources ?? 0;
  const breakdown = expected.map((category) => {
    const rows = entries.filter((e) => e.category === category);
    const sum = rows.reduce((s, e) => s.plus(e.amount), new D(0));
    const state = states.find((s) => s.category === category);
    return {
      category,
      label: periodCategories[category],
      amount: sum.toFixed(2),
      entry_count: rows.length,
      status: state?.status ?? "unreviewed",
      reason: state?.reason ?? "",
    };
  });
  const reviewed =
    !!input.ownership &&
    !unresolved &&
    !sourceWarnings &&
    breakdown.every((b) => b.status !== "unreviewed");
  const metrics = Object.fromEntries(
    (Object.keys(meterNames) as Meter[]).map((m) => {
      const a = input.readings.find((r) => r.date === start_date)?.[m] ?? null;
      const b = input.readings.find((r) => r.date === end)?.[m] ?? null;
      const diff = a === null || b === null ? null : new D(b).minus(a);
      const status =
        diff === null
          ? "missing_boundary"
          : diff.isNegative()
            ? "invalid_order"
            : diff.isZero()
              ? "no_activity"
              : "complete";
      const cost =
        m !== "engine_hours" &&
        status === "complete" &&
        (total.gt(0) || reviewed)
          ? total.div(diff!).toDecimalPlaces(4).toFixed(4)
          : null;
      return [
        m,
        {
          start: a,
          end: b,
          value: diff?.toFixed(3) ?? null,
          status,
          unit_cost: cost,
          unit_cost_below_precision: cost === "0.0000" && total.gt(0),
        },
      ];
    }),
  ) as Record<
    Meter,
    {
      start: string | null;
      end: string | null;
      value: string | null;
      status: string;
      unit_cost: string | null;
      unit_cost_below_precision: boolean;
    }
  >;
  const warnings: string[] = [];
  if (!input.ownership)
    warnings.push("Укажите тип владения техникой; полнота не подтверждена.");
  if (!reviewed)
    warnings.push(
      "Себестоимость предварительная: пользовательская проверка затрат не завершена или устарела.",
    );
  if (unresolved)
    warnings.push(
      `Не признаны ${unresolved} расходов рейсов за период. Свяжите источник с категорией и машиной; не дублируйте сумму вручную.`,
    );
  if (sourceWarnings)
    warnings.push(
      "Назначение машины или категория источника изменились. Проверьте привязку рейсовых расходов.",
    );
  if (Object.values(metrics).some((m) => m.status === "missing_boundary"))
    warnings.push(
      `Нужны точные показания на начало ${start_date} и ${end}; интерполяции нет.`,
    );
  if ([metrics.km, metrics.work_hours].some((m) => m.status === "no_activity"))
    warnings.push(
      "Нулевая выработка: расходы простоя сохранены, удельная стоимость не рассчитана.",
    );
  if (total.isZero() && !reviewed)
    warnings.push(
      "Отсутствие введённых затрат не означает бесплатную эксплуатацию.",
    );
  if (
    metrics.work_hours.value !== null &&
    metrics.engine_hours.value !== null &&
    new D(metrics.work_hours.value).gt(metrics.engine_hours.value)
  )
    warnings.push("Рабочие часы превышают моточасы: проверьте методику.");
  if (
    entries.some(
      (e) => e.category === "financing_interest" && new D(e.amount).gt(0),
    )
  )
    warnings.push(
      "Включён расширенный состав: проценты и комиссии финансирования, не тело кредита.",
    );
  if (entries.some((e) => e.category === "incidents" && new D(e.amount).gt(0)))
    warnings.push("Включены разовые аварийные и внеплановые затраты.");
  return {
    currency: "RUB",
    start_date,
    end_date,
    boundary_end: end,
    revision: input.revision,
    total_cost: total.toFixed(2),
    metrics,
    breakdown,
    costs_reviewed: reviewed,
    review_current: current,
    warnings,
    entries,
    attestation: "user_review_not_accounting_guarantee",
  };
}
export type PeriodReport = ReturnType<typeof calculatePeriod>;
