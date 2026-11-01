import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import {
  incomeSchema,
  incomeUpdateSchema,
  incomeVoidSchema,
  incomeReviewSchema,
  periodRangeSchema,
  summarizeIncome,
  type IncomeEntry,
  type IncomeReview,
  type UserContext,
} from "@fleet/shared";
import { Database } from "./db";
import { FleetService } from "./fleet";
import { requireRole } from "./auth";
const columns =
  "i.id,i.vehicle_id,i.trip_id,i.recognized_on,i.amount::text,i.currency,i.source_ref,i.note,i.version,i.voided_at,COALESCE(t.vehicle_id<>i.source_vehicle_id,false) AS source_warning";
const joins =
  "FROM recognized_income i LEFT JOIN trips t ON t.tenant_id=i.tenant_id AND t.id=i.trip_id";
@Injectable()
export class IncomeService {
  constructor(
    private readonly db: Database,
    private readonly fleet: FleetService,
  ) {}
  private async lock(c: PoolClient, user: UserContext) {
    requireRole(user, ["owner", "accountant"]);
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `vehicle-period:${user.tenant_id}`,
    ]);
  }
  private async vehicle(c: PoolClient, user: UserContext, id: string) {
    z.uuid().parse(id);
    if (
      !(
        await c.query("SELECT id FROM vehicles WHERE tenant_id=$1 AND id=$2", [
          user.tenant_id,
          id,
        ])
      ).rowCount
    )
      throw new NotFoundException("Машина не найдена");
  }
  private async trip(c: PoolClient, user: UserContext, id: string) {
    z.uuid().parse(id);
    // Do not lock the trip row after the tenant lock: operational writers lock in the reverse order.
    const r = await c.query(
      "SELECT vehicle_id FROM trips WHERE tenant_id=$1 AND id=$2",
      [user.tenant_id, id],
    );
    if (!r.rows[0]) throw new NotFoundException("Рейс не найден");
    return r.rows[0].vehicle_id as string;
  }
  private async revision(c: PoolClient, user: UserContext) {
    return (
      (
        await c.query(
          "SELECT revision FROM vehicle_period_revisions WHERE tenant_id=$1",
          [user.tenant_id],
        )
      ).rows[0]?.revision ?? 0
    );
  }
  private async existing(
    c: PoolClient,
    user: UserContext,
    id: string,
    version: number,
  ) {
    z.uuid().parse(id);
    const old = (
      await c.query(
        "SELECT * FROM recognized_income WHERE tenant_id=$1 AND id=$2",
        [user.tenant_id, id],
      )
    ).rows[0];
    if (!old) throw new NotFoundException("Доход не найден");
    if (old.version !== version || old.voided_at)
      throw new ConflictException(
        "Доход изменён или аннулирован; обновите данные",
      );
    return old;
  }
  async save(
    user: UserContext,
    id: string | null,
    body: unknown,
    key: unknown,
  ) {
    requireRole(user, ["owner", "accountant"]);
    const data = id ? incomeUpdateSchema.parse(body) : incomeSchema.parse(body);
    return this.fleet.create(
      user,
      `income:${id ?? "new"}`,
      key,
      data,
      async (c) => {
        await this.lock(c, user);
        await this.vehicle(c, user, data.vehicle_id);
        const sourceVehicle = data.trip_id
          ? await this.trip(c, user, data.trip_id)
          : null;
        const old = id
          ? await this.existing(
              c,
              user,
              id,
              "version" in data && typeof data.version === "number"
                ? data.version
                : 0,
            )
          : null;
        const entryId = id ?? randomUUID();
        const values = [
          user.tenant_id,
          entryId,
          data.vehicle_id,
          data.trip_id,
          sourceVehicle,
          data.recognized_on,
          data.amount,
          data.currency,
          data.source_ref,
          data.note,
        ];
        const r = id
          ? await c.query(
              "UPDATE recognized_income SET vehicle_id=$3,trip_id=$4,source_vehicle_id=$5,recognized_on=$6,amount=$7,currency=$8,source_ref=$9,note=$10,version=version+1 WHERE tenant_id=$1 AND id=$2 RETURNING id,version",
              values,
            )
          : await c.query(
              "INSERT INTO recognized_income(tenant_id,id,vehicle_id,trip_id,source_vehicle_id,recognized_on,amount,currency,source_ref,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,version",
              [...values, user.user_id],
            );
        await this.fleet.audit(
          c,
          user,
          entryId,
          id ? "income.updated" : "income.created",
          { before: old, after: data },
        );
        return r.rows[0];
      },
    );
  }
  async void(user: UserContext, id: string, body: unknown, key: unknown) {
    requireRole(user, ["owner", "accountant"]);
    const data = incomeVoidSchema.parse(body);
    return this.fleet.create(
      user,
      `income-void:${id}`,
      key,
      data,
      async (c) => {
        await this.lock(c, user);
        const old = await this.existing(c, user, id, data.version);
        const r = await c.query(
          "UPDATE recognized_income SET voided_at=now(),voided_by=$3,void_reason=$4,version=version+1 WHERE tenant_id=$1 AND id=$2 RETURNING id,version",
          [user.tenant_id, id, user.user_id, data.reason],
        );
        await this.fleet.audit(c, user, id, "income.voided", {
          before: old,
          reason: data.reason,
        });
        return r.rows[0];
      },
    );
  }
  async periodData(
    c: PoolClient,
    user: UserContext,
    vehicleId: string,
    range: { start_date: string; end_date: string },
    cost: string | null = null,
    costsReviewed = false,
  ) {
    const args = [user.tenant_id, vehicleId, range.start_date, range.end_date];
    const entries = (
      await c.query<IncomeEntry>(
        `SELECT ${columns} ${joins} WHERE i.tenant_id=$1 AND i.vehicle_id=$2 AND i.recognized_on>=$3 AND i.recognized_on<=$4 ORDER BY i.recognized_on,i.id`,
        args,
      )
    ).rows;
    const elsewhere = (
      await c.query(
        `SELECT i.id,i.vehicle_id,i.source_ref,i.amount::text ${joins} WHERE i.tenant_id=$1 AND t.vehicle_id=$2 AND i.vehicle_id<>$2 AND i.recognized_on>=$3 AND i.recognized_on<=$4 AND i.voided_at IS NULL`,
        args,
      )
    ).rows;
    const revision = await this.revision(c, user);
    const review = (
      await c.query<IncomeReview>(
        "SELECT revision,status,reason FROM income_period_reviews WHERE tenant_id=$1 AND vehicle_id=$2 AND start_date=$3 AND end_date=$4",
        args,
      )
    ).rows[0];
    return {
      entries,
      recognized_elsewhere: elsewhere,
      summary: summarizeIncome(entries, revision, review, cost, costsReviewed),
    };
  }
  async review(
    user: UserContext,
    vehicleId: string,
    body: unknown,
    key: unknown,
  ) {
    requireRole(user, ["owner", "accountant"]);
    const data = incomeReviewSchema.parse(body);
    const range = periodRangeSchema.parse({
      start_date: data.start_date,
      end_date: data.end_date,
    });
    return this.fleet.create(
      user,
      `income-review:${vehicleId}`,
      key,
      data,
      async (c) => {
        await this.lock(c, user);
        await this.vehicle(c, user, vehicleId);
        const state = await this.periodData(c, user, vehicleId, range);
        if (state.summary.revision !== data.expected_revision)
          throw new ConflictException(
            "Данные изменились; обновите период и перепроверьте доходы",
          );
        if (data.status !== "unreviewed" && state.summary.source_warning)
          throw new ConflictException(
            "Перепроверьте привязки доходов после смены машины рейса",
          );
        if (
          data.status === "zero" &&
          /[1-9]/.test(state.summary.recorded_total)
        )
          throw new ConflictException(
            "Есть положительные доходы; подтвердить отсутствие нельзя",
          );
        await c.query(
          "INSERT INTO income_period_reviews(tenant_id,vehicle_id,start_date,end_date,revision,status,reason,reviewed_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(tenant_id,vehicle_id,start_date,end_date) DO UPDATE SET revision=$5,status=$6,reason=$7,reviewed_by=$8,reviewed_at=now()",
          [
            user.tenant_id,
            vehicleId,
            range.start_date,
            range.end_date,
            data.expected_revision,
            data.status,
            data.reason,
            user.user_id,
          ],
        );
        await this.fleet.audit(c, user, vehicleId, "income.review", data);
        return { reviewed: true };
      },
    );
  }
  async tripReport(user: UserContext, tripId: string) {
    requireRole(user, ["owner", "accountant"]);
    return this.db.transaction(async (c) => {
      await this.lock(c, user);
      await this.trip(c, user, tripId);
      const entries = (
        await c.query<IncomeEntry>(
          `SELECT ${columns} ${joins} WHERE i.tenant_id=$1 AND i.trip_id=$2 ORDER BY i.recognized_on,i.id`,
          [user.tenant_id, tripId],
        )
      ).rows;
      const cost = (
        await c.query(
          "SELECT sum(amount)::text AS total FROM expenses WHERE tenant_id=$1 AND trip_id=$2 AND voided_at IS NULL",
          [user.tenant_id, tripId],
        )
      ).rows[0].total;
      return {
        entries,
        recognized_elsewhere: [],
        summary: summarizeIncome(
          entries,
          await this.revision(c, user),
          null,
          cost,
          false,
        ),
      };
    });
  }
}
