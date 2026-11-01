import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  assignmentSchema,
  compareCosts,
  driverSchema,
  driverUpdateSchema,
  expenseSchema,
  statusSchema,
  transitions,
  voidExpenseSchema,
  type ExpenseCategory,
  type TripStatus,
  type UserContext,
} from "@fleet/shared";
import { Database } from "./db";
import { FleetService } from "./fleet";
import { requireRole } from "./auth";
const paging = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).max(1000000).default(0),
  })
  .strict();
const driverColumns = "id,name,staff_code,active,version,created_at";
const expenseColumns =
  "id,trip_id,category,amount,currency,incurred_on,note,created_at,version,voided_at,void_reason";
@Injectable()
export class OperationsService {
  constructor(
    private readonly db: Database,
    private readonly fleet: FleetService,
  ) {}
  async drivers(user: UserContext, query: unknown) {
    const p = paging.parse(query);
    const r = await this.db.pool.query(
      `SELECT ${driverColumns} FROM drivers WHERE tenant_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`,
      [user.tenant_id, p.limit + 1, p.offset],
    );
    return {
      items: r.rows.slice(0, p.limit),
      has_more: r.rows.length > p.limit,
    };
  }
  async driver(user: UserContext, driverId: string) {
    const r = await this.db.pool.query(
      `SELECT ${driverColumns} FROM drivers WHERE tenant_id=$1 AND id=$2`,
      [user.tenant_id, z.uuid().parse(driverId)],
    );
    if (!r.rows[0]) throw new NotFoundException("Водитель не найден");
    return r.rows[0];
  }
  async createDriver(user: UserContext, body: unknown, key: unknown) {
    requireRole(user, ["owner", "dispatcher"]);
    const data = driverSchema.parse(body);
    return this.fleet.create(user, "drivers", key, data, async (c) => {
      const r = await c.query(
        `INSERT INTO drivers(id,tenant_id,name,staff_code) VALUES($1,$2,$3,$4) RETURNING ${driverColumns}`,
        [randomUUID(), user.tenant_id, data.name, data.staff_code],
      );
      await this.fleet.audit(c, user, r.rows[0].id, "driver.created");
      return r.rows[0];
    });
  }
  async updateDriver(user: UserContext, driverId: string, body: unknown) {
    requireRole(user, ["owner", "dispatcher"]);
    const data = driverUpdateSchema.parse(body);
    return this.db.transaction(async (c) => {
      await this.fleet.dispatchLock(c, user);
      const r = await c.query(
        "SELECT version FROM drivers WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [user.tenant_id, z.uuid().parse(driverId)],
      );
      if (!r.rows[0]) throw new NotFoundException("Водитель не найден");
      if (r.rows[0].version !== data.version)
        throw new ConflictException("Водитель уже изменён. Обновите список");
      if (!data.active) {
        const assigned = await c.query(
          "SELECT id FROM trips WHERE tenant_id=$1 AND driver_id=$2 AND status IN ('planned','in_progress') LIMIT 1",
          [user.tenant_id, driverId],
        );
        if (assigned.rows[0])
          throw new ConflictException("Водитель назначен на активный рейс");
      }
      const result = await c.query(
        `UPDATE drivers SET name=$3,staff_code=$4,active=$5,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING ${driverColumns}`,
        [user.tenant_id, driverId, data.name, data.staff_code, data.active],
      );
      await this.fleet.audit(c, user, driverId, "driver.updated");
      return result.rows[0];
    });
  }
  async assign(user: UserContext, tripId: string, body: unknown) {
    requireRole(user, ["owner", "dispatcher"]);
    const data = assignmentSchema.parse(body);
    const t = await this.fleet.trip(user, tripId);
    return this.fleet.updateTrip(user, tripId, {
      ...data,
      origin: t.origin,
      destination: t.destination,
      departure_date: t.departure_date,
    });
  }
  async transition(
    user: UserContext,
    tripId: string,
    body: unknown,
    key: unknown,
  ) {
    requireRole(user, ["owner", "dispatcher"]);
    const data = statusSchema.parse(body);
    await this.fleet.trip(user, tripId);
    return this.fleet.create(user, `status:${tripId}`, key, data, async (c) => {
      await this.fleet.dispatchLock(c, user);
      const old = await this.fleet.lockedTrip(c, user, tripId);
      if (old.version !== data.version)
        throw new ConflictException("Рейс уже изменён. Обновите данные");
      if (!transitions[old.status as TripStatus].includes(data.status))
        throw new ConflictException("Такой переход статуса недоступен");
      if (data.status === "cancelled" && !data.reason)
        throw new BadRequestException("Укажите причину отмены");
      if (["planned", "in_progress"].includes(data.status))
        await this.fleet.resources(
          c,
          user,
          old.vehicle_id,
          old.driver_id,
          true,
          tripId,
        );
      let baseline = old.baseline_estimate_id;
      if (data.status === "in_progress") {
        const p = await c.query(
          "SELECT id FROM cost_estimates WHERE tenant_id=$1 AND trip_id=$2 AND assignment_version=$3 ORDER BY created_at DESC,id DESC LIMIT 1",
          [user.tenant_id, tripId, old.assignment_version],
        );
        baseline = p.rows[0]?.id ?? null;
      }
      await c.query(
        `UPDATE trips SET status=$3,version=version+1,updated_at=now(),baseline_estimate_id=$4,started_at=CASE WHEN $3='in_progress' THEN now() ELSE started_at END,completed_at=CASE WHEN $3='completed' THEN now() ELSE completed_at END,cancelled_at=CASE WHEN $3='cancelled' THEN now() ELSE cancelled_at END WHERE tenant_id=$1 AND id=$2`,
        [user.tenant_id, tripId, data.status, baseline],
      );
      await c.query(
        "INSERT INTO trip_status_events(id,tenant_id,trip_id,actor_id,from_status,to_status,reason,trip_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          randomUUID(),
          user.tenant_id,
          tripId,
          user.user_id,
          old.status,
          data.status,
          data.reason ?? null,
          old.version + 1,
        ],
      );
      await this.fleet.audit(c, user, tripId, "trip.status_changed", {
        from: old.status,
        to: data.status,
        reason: data.reason ?? null,
      });
      return this.fleet.trip(user, tripId, c);
    });
  }
  async history(user: UserContext, tripId: string, query: unknown) {
    await this.fleet.trip(user, tripId);
    const p = paging.parse(query);
    const r = await this.db.pool.query(
      "SELECT id,from_status,to_status,reason,trip_version,created_at FROM trip_status_events WHERE tenant_id=$1 AND trip_id=$2 ORDER BY trip_version DESC LIMIT $3 OFFSET $4",
      [user.tenant_id, tripId, p.limit + 1, p.offset],
    );
    return {
      items: r.rows.slice(0, p.limit),
      has_more: r.rows.length > p.limit,
    };
  }
  async expenses(user: UserContext, tripId: string, query: unknown) {
    requireRole(user, ["owner", "accountant"]);
    await this.fleet.trip(user, tripId);
    const p = paging.parse(query);
    const r = await this.db.pool.query(
      `SELECT ${expenseColumns} FROM expenses WHERE tenant_id=$1 AND trip_id=$2 ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4`,
      [user.tenant_id, tripId, p.limit + 1, p.offset],
    );
    return {
      items: r.rows.slice(0, p.limit),
      has_more: r.rows.length > p.limit,
    };
  }
  async expense(user: UserContext, expenseId: string) {
    requireRole(user, ["owner", "accountant"]);
    const r = await this.db.pool.query(
      `SELECT ${expenseColumns} FROM expenses WHERE tenant_id=$1 AND id=$2`,
      [user.tenant_id, z.uuid().parse(expenseId)],
    );
    if (!r.rows[0]) throw new NotFoundException("Расход не найден");
    return r.rows[0];
  }
  async addExpense(
    user: UserContext,
    tripId: string,
    body: unknown,
    key: unknown,
  ) {
    requireRole(user, ["owner", "accountant"]);
    const data = expenseSchema.parse(body);
    await this.fleet.trip(user, tripId);
    return this.fleet.create(
      user,
      `expenses:${tripId}`,
      key,
      data,
      async (c) => {
        await this.fleet.lockedTrip(c, user, tripId);
        const r = await c.query(
          `INSERT INTO expenses(id,tenant_id,trip_id,category,amount,currency,incurred_on,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${expenseColumns}`,
          [
            randomUUID(),
            user.tenant_id,
            tripId,
            data.category,
            data.amount,
            data.currency,
            data.incurred_on,
            data.note,
            user.user_id,
          ],
        );
        await this.fleet.audit(c, user, r.rows[0].id, "expense.created", {
          trip_id: tripId,
        });
        return r.rows[0];
      },
    );
  }
  async voidExpense(
    user: UserContext,
    expenseId: string,
    body: unknown,
    key: unknown,
  ) {
    requireRole(user, ["owner", "accountant"]);
    const data = voidExpenseSchema.parse(body);
    const existing = await this.expense(user, expenseId);
    return this.fleet.create(
      user,
      `void-expense:${expenseId}`,
      key,
      data,
      async (c) => {
        await this.fleet.lockedTrip(c, user, existing.trip_id);
        const r = await c.query(
          "SELECT version,voided_at FROM expenses WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [user.tenant_id, expenseId],
        );
        if (!r.rows[0]) throw new NotFoundException("Расход не найден");
        if (r.rows[0].version !== data.version || r.rows[0].voided_at)
          throw new ConflictException("Расход уже изменён или аннулирован");
        const result = await c.query(
          `UPDATE expenses SET voided_at=now(),voided_by=$3,void_reason=$4,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING ${expenseColumns}`,
          [user.tenant_id, expenseId, user.user_id, data.reason],
        );
        await this.fleet.audit(c, user, expenseId, "expense.voided", {
          reason: data.reason,
          trip_id: existing.trip_id,
        });
        return result.rows[0];
      },
    );
  }
  async comparison(user: UserContext, tripId: string) {
    requireRole(user, ["owner", "accountant"]);
    return this.db.transaction(async (c) => {
      // All financial writers and transitions lock this trip: one consistent plan/fact view.
      const t = await this.fleet.lockedTrip(c, user, tripId);
      const frozen = ["in_progress", "completed"].includes(t.status);
      const p = frozen
        ? await c.query(
            "SELECT id,result,assignment_version,created_at FROM cost_estimates WHERE tenant_id=$1 AND trip_id=$2 AND id=$3",
            [user.tenant_id, tripId, t.baseline_estimate_id],
          )
        : await c.query(
            "SELECT id,result,assignment_version,created_at FROM cost_estimates WHERE tenant_id=$1 AND trip_id=$2 AND assignment_version=$3 ORDER BY created_at DESC,id DESC LIMIT 1",
            [user.tenant_id, tripId, t.assignment_version],
          );
      const actual = await c.query(
        "SELECT category,sum(amount)::text AS amount,count(*)::integer AS count FROM expenses WHERE tenant_id=$1 AND trip_id=$2 AND voided_at IS NULL GROUP BY category",
        [user.tenant_id, tripId],
      );
      const amounts = Object.fromEntries(
        actual.rows.map((r) => [r.category, r.amount]),
      ) as Partial<Record<ExpenseCategory, string>>;
      const count = actual.rows.reduce((n, r) => n + r.count, 0);
      const plan = p.rows[0];
      return {
        ...compareCosts(plan?.result ?? null, amounts, count),
        plan_id: plan?.id ?? null,
        plan_mode: frozen ? "frozen" : "latest",
        assignment_version: plan?.assignment_version ?? null,
        plan_created_at: plan?.created_at ?? null,
      };
    });
  }
}
