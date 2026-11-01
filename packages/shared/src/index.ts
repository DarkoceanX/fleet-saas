import Decimal from "decimal.js";
import { z } from "zod";
import {
  dateOnly,
  type TripStatus,
  type AssignmentSnapshot,
} from "./operations";
export * from "./operations";
export * from "./period";
export * from "./income";

const D = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_UP });
export const costFields = [
  "loaded_km",
  "empty_km",
  "fuel_l_per_100km",
  "fuel_price_per_l",
  "driver_hours",
  "driver_rate_per_hour",
  "maintenance_per_km",
  "depreciation_per_km",
  "tolls",
  "other_direct",
  "overhead_rate",
  "target_margin",
] as const;
export const fieldLabels: Record<
  (typeof costFields)[number] | "revenue",
  string
> = {
  loaded_km: "Пробег с грузом, км",
  empty_km: "Порожний пробег, км",
  fuel_l_per_100km: "Расход топлива, л / 100 км",
  fuel_price_per_l: "Цена топлива, ₽ / л",
  driver_hours: "Работа водителя, ч",
  driver_rate_per_hour: "Ставка водителя, ₽ / ч",
  maintenance_per_km: "Обслуживание, ₽ / км",
  depreciation_per_km: "Амортизация, ₽ / км",
  tolls: "Платные дороги, ₽",
  other_direct: "Прочие прямые расходы, ₽",
  overhead_rate: "Накладные, доля (0.10 = 10%)",
  target_margin: "Целевая маржа, доля (0.20 = 20%)",
  revenue: "Плановая выручка, ₽ (необязательно)",
};
const decimal = z
  .string()
  .regex(
    /^\d{1,12}(?:\.\d{1,6})?$(?![\s\S])/,
    "Введите неотрицательное число с точкой, до 6 знаков после точки",
  )
  .pipe(
    z
      .string()
      .refine((v) => new D(v).lt("1000000000000"), "Значение слишком велико"),
  );
export const costInputSchema = z
  .object({
    currency: z.literal("RUB"),
    loaded_km: decimal,
    empty_km: decimal,
    fuel_l_per_100km: decimal,
    fuel_price_per_l: decimal,
    driver_hours: decimal,
    driver_rate_per_hour: decimal,
    maintenance_per_km: decimal,
    depreciation_per_km: decimal,
    tolls: decimal,
    other_direct: decimal,
    overhead_rate: decimal.pipe(
      z.string().refine((v) => new D(v).lte(1), "Доля должна быть от 0 до 1"),
    ),
    target_margin: decimal.pipe(
      z.string().refine((v) => new D(v).lt(1), "Маржа должна быть меньше 1"),
    ),
    revenue: decimal.optional(),
  })
  .strict();
export type CostInput = z.infer<typeof costInputSchema>;
export function calculateCost(input: unknown) {
  const data = costInputSchema.parse(input);
  const x = Object.fromEntries(
    costFields.map((k) => [k, new D(data[k])]),
  ) as Record<(typeof costFields)[number], Decimal>;
  const money = (n: Decimal) => n.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const distance = x.loaded_km.plus(x.empty_km);
  const liters = distance.mul(x.fuel_l_per_100km).div(100);
  const lines = {
    fuel: money(liters.mul(x.fuel_price_per_l)),
    driver: money(x.driver_hours.mul(x.driver_rate_per_hour)),
    maintenance: money(distance.mul(x.maintenance_per_km)),
    depreciation: money(distance.mul(x.depreciation_per_km)),
    tolls: money(x.tolls),
    other_direct: money(x.other_direct),
  };
  const direct = Object.values(lines).reduce((a, b) => a.plus(b), new D(0));
  const overhead = money(direct.mul(x.overhead_rate));
  const total = direct.plus(overhead);
  const revenue =
    data.revenue === undefined ? null : money(new D(data.revenue));
  const profit = revenue === null ? null : revenue.minus(total);
  return {
    calculation_version: "1",
    currency: "RUB",
    distance_km: distance.toFixed(),
    fuel_liters: liters.toFixed(),
    lines: Object.fromEntries(
      Object.entries(lines).map(([k, v]) => [k, v.toFixed(2)]),
    ),
    direct: direct.toFixed(2),
    overhead: overhead.toFixed(2),
    total: total.toFixed(2),
    target_price: total
      .div(new D(1).minus(x.target_margin))
      .toDecimalPlaces(2, Decimal.ROUND_CEIL)
      .toFixed(2),
    cost_per_km: distance.isZero()
      ? null
      : money(total.div(distance)).toFixed(2),
    revenue: revenue?.toFixed(2) ?? null,
    profit: profit?.toFixed(2) ?? null,
    actual_margin:
      revenue && !revenue.isZero()
        ? profit!
            .div(revenue)
            .toDecimalPlaces(6, Decimal.ROUND_HALF_UP)
            .toFixed(6)
        : null,
  };
}
export type CostResult = ReturnType<typeof calculateCost>;
export const vehicleSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    plate: z
      .string()
      .trim()
      .min(2)
      .max(20)
      .transform((v) => v.toUpperCase()),
  })
  .strict();
export const tripSchema = z
  .object({
    vehicle_id: z.uuid(),
    driver_id: z.uuid().nullable().optional(),
    origin: z.string().trim().min(2).max(120),
    destination: z.string().trim().min(2).max(120),
    departure_date: dateOnly,
  })
  .strict();
export const vehicleUpdateSchema = vehicleSchema.extend({
  version: z.number().int().positive(),
});
export const tripUpdateSchema = tripSchema.extend({
  version: z.number().int().positive(),
});
export type Role = "owner" | "dispatcher" | "accountant" | "viewer";
export type UserContext = {
  user_id: string;
  tenant_id: string;
  name: string;
  organization: string;
  role: Role;
};
export type Vehicle = {
  id: string;
  name: string;
  plate: string;
  version: number;
  created_at: string;
};
export type Trip = {
  id: string;
  vehicle_id: string;
  vehicle_name: string;
  plate: string;
  origin: string;
  destination: string;
  departure_date: string;
  status: TripStatus;
  driver_id: string | null;
  driver_name: string | null;
  assignment_version: number;
  started_at: string | null;
  completed_at: string | null;
  version: number;
  created_at: string;
};
export type Estimate = {
  assignment_version: number | null;
  assignment_snapshot: AssignmentSnapshot | null;
  id: string;
  trip_id: string;
  currency: string;
  calculation_version: string;
  tariff_version: string;
  input_snapshot: CostInput;
  result: CostResult;
  total: string;
  created_at: string;
};
