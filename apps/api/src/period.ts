import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PoolClient } from "pg";
import { z } from "zod";
import {
  applicableCategories,
  calculatePeriod,
  manualCostSchema,
  manualCostUpdateSchema,
  nextDay,
  ownershipSchema,
  periodRangeSchema,
  periodReportQuerySchema,
  periodEntriesQuerySchema,
  periodPage,
  readingSchema,
  readingUpdateSchema,
  recognizeSchema,
  reviewSchema,
  validCategory,
  versionSchema,
  type Ownership,
  type PeriodCategory,
  type PeriodEntry,
  type PeriodReading,
  type ReviewState,
  type UserContext,
} from "@fleet/shared";
import { Database } from "./db";
import { FleetService } from "./fleet";
import { requireRole } from "./auth";
import { IncomeService } from "./income";

@Injectable()
export class PeriodService {
  constructor(
    private readonly db: Database,
    private readonly fleet: FleetService,
    private readonly income: IncomeService,
  ) {}
  private async lock(c: PoolClient, user: UserContext, vehicleId: string) {
    requireRole(user, ["owner", "accountant"]);
    z.uuid().parse(vehicleId);
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `vehicle-period:${user.tenant_id}`,
    ]);
    const v = await c.query(
      "SELECT id,name,plate FROM vehicles WHERE tenant_id=$1 AND id=$2",
      [user.tenant_id, vehicleId],
    );
    if (!v.rows[0]) throw new NotFoundException("Техника не найдена");
    return v.rows[0];
  }
  private async ownership(c: PoolClient, user: UserContext, vehicleId: string) {
    const p = await c.query(
      "SELECT ownership,version FROM vehicle_cost_profiles WHERE tenant_id=$1 AND vehicle_id=$2",
      [user.tenant_id, vehicleId],
    );
    return p.rows[0] as { ownership: Ownership; version: number } | undefined;
  }
  private async category(
    c: PoolClient,
    user: UserContext,
    vehicleId: string,
    category: PeriodCategory,
  ) {
    const p = await this.ownership(c, user, vehicleId);
    if (!p)
      throw new ConflictException("Сначала укажите тип владения техникой");
    if (!validCategory(p.ownership, category))
      throw new ConflictException(
        "Статья не соответствует владению: аренда и амортизация взаимоисключаются",
      );
  }
  private mutate(
    user: UserContext,
    vehicleId: string,
    op: string,
    key: unknown,
    data: unknown,
    fn: (c: PoolClient) => Promise<Record<string, unknown>>,
  ) {
    requireRole(user, ["owner", "accountant"]);
    return this.fleet.create(
      user,
      `period:${vehicleId}:${op}`,
      key,
      data,
      async (c) => {
        await this.lock(c, user, vehicleId);
        return fn(c);
      },
    );
  }
  async setOwnership(
    user: UserContext,
    vehicleId: string,
    body: unknown,
    key: unknown,
  ) {
    const data = ownershipSchema.parse(body);
    return this.mutate(user, vehicleId, "ownership", key, data, async (c) => {
      const old = await this.ownership(c, user, vehicleId);
      if ((old?.version ?? 0) !== data.version)
        throw new ConflictException(
          "Тип владения уже изменён. Обновите данные",
        );
      const forbidden = data.ownership === "owned" ? "rental" : "depreciation";
      const history = await c.query(
        "SELECT id FROM vehicle_cost_entries WHERE tenant_id=$1 AND vehicle_id=$2 AND category=$3 LIMIT 1",
        [user.tenant_id, vehicleId, forbidden],
      );
      if (history.rows.length)
        throw new ConflictException(
          "Есть несовместимая история затрат. Для другого периода владения нужна отдельная карточка",
        );
      const r = await c.query(
        "INSERT INTO vehicle_cost_profiles(tenant_id,vehicle_id,ownership) VALUES($1,$2,$3) ON CONFLICT(tenant_id,vehicle_id) DO UPDATE SET ownership=$3,version=vehicle_cost_profiles.version+1 RETURNING ownership,version",
        [user.tenant_id, vehicleId, data.ownership],
      );
      await this.fleet.audit(c, user, vehicleId, "period.ownership", data);
      return r.rows[0];
    });
  }
  async saveReading(
    user: UserContext,
    vehicleId: string,
    readingId: string | null,
    body: unknown,
    key: unknown,
  ) {
    const data = readingId
      ? readingUpdateSchema.parse(body)
      : readingSchema.parse(body);
    return this.mutate(
      user,
      vehicleId,
      `reading:${readingId ?? "new"}`,
      key,
      data,
      async (c) => {
        if (readingId)
          await this.version(
            c,
            user,
            vehicleId,
            "vehicle_readings",
            readingId,
            "version" in data && typeof data.version === "number"
              ? data.version
              : 0,
          );
        const id = readingId ?? randomUUID();
        const values = [
          user.tenant_id,
          vehicleId,
          id,
          data.date,
          data.km,
          data.work_hours,
          data.engine_hours,
          data.note,
        ];
        const r = readingId
          ? await c.query(
              "UPDATE vehicle_readings SET date=$4,km=$5,work_hours=$6,engine_hours=$7,note=$8,version=version+1 WHERE tenant_id=$1 AND vehicle_id=$2 AND id=$3 RETURNING *",
              values,
            )
          : await c.query(
              "INSERT INTO vehicle_readings(tenant_id,vehicle_id,id,date,km,work_hours,engine_hours,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
              values,
            );
        for (const meter of ["km", "work_hours", "engine_hours"]) {
          const bad = await c.query(
            `SELECT 1 FROM (SELECT ${meter} AS value,lag(${meter}) OVER(ORDER BY date) AS prior FROM vehicle_readings WHERE tenant_id=$1 AND vehicle_id=$2 AND ${meter} IS NOT NULL) r WHERE value<prior LIMIT 1`,
            [user.tenant_id, vehicleId],
          );
          if (bad.rows.length)
            throw new ConflictException(
              `Счётчик ${meter} уменьшается. Правка отменена`,
            );
        }
        await this.fleet.audit(c, user, id, "period.reading_saved", data);
        return r.rows[0];
      },
    );
  }
  private async version(
    c: PoolClient,
    user: UserContext,
    vehicleId: string,
    table: "vehicle_readings" | "vehicle_cost_entries",
    id: string,
    version: number,
  ) {
    z.uuid().parse(id);
    const r = await c.query(
      `SELECT * FROM ${table} WHERE tenant_id=$1 AND vehicle_id=$2 AND id=$3`,
      [user.tenant_id, vehicleId, id],
    );
    if (!r.rows[0]) throw new NotFoundException("Запись не найдена");
    if (r.rows[0].version !== version || r.rows[0].deleted_at)
      throw new ConflictException(
        "Запись изменена или удалена. Обновите данные",
      );
    return r.rows[0];
  }
  async deleteReading(
    user: UserContext,
    vehicleId: string,
    id: string,
    body: unknown,
    key: unknown,
  ) {
    const data = versionSchema.parse(body);
    return this.mutate(
      user,
      vehicleId,
      `reading-delete:${id}`,
      key,
      data,
      async (c) => {
        const old = await this.version(
          c,
          user,
          vehicleId,
          "vehicle_readings",
          id,
          data.version,
        );
        await c.query(
          "DELETE FROM vehicle_readings WHERE tenant_id=$1 AND vehicle_id=$2 AND id=$3",
          [user.tenant_id, vehicleId, id],
        );
        await this.fleet.audit(c, user, id, "period.reading_deleted", old);
        return { deleted: true };
      },
    );
  }
  async saveCost(
    user: UserContext,
    vehicleId: string,
    entryId: string | null,
    body: unknown,
    key: unknown,
  ) {
    const data = entryId
      ? manualCostUpdateSchema.parse(body)
      : manualCostSchema.parse(body);
    return this.mutate(
      user,
      vehicleId,
      `cost:${entryId ?? "new"}`,
      key,
      data,
      async (c) => {
        await this.category(c, user, vehicleId, data.category);
        if (entryId) {
          const old = await this.version(
            c,
            user,
            vehicleId,
            "vehicle_cost_entries",
            entryId,
            "version" in data && typeof data.version === "number"
              ? data.version
              : 0,
          );
          if (old.source !== "manual")
            throw new ConflictException(
              "Исправляйте рейсовый расход в исходном рейсе; связь не является второй суммой",
            );
        }
        const id = entryId ?? randomUUID();
        const values = [
          user.tenant_id,
          vehicleId,
          id,
          data.date,
          data.category,
          data.amount,
          data.note,
        ];
        const r = entryId
          ? await c.query(
              "UPDATE vehicle_cost_entries SET date=$4,category=$5,amount=$6,note=$7,version=version+1 WHERE tenant_id=$1 AND vehicle_id=$2 AND id=$3 RETURNING *",
              values,
            )
          : await c.query(
              "INSERT INTO vehicle_cost_entries(tenant_id,vehicle_id,id,date,category,amount,note,source,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,'manual',$8) RETURNING *",
              [...values, user.user_id],
            );
        await this.fleet.audit(c, user, id, "period.cost_saved", data);
        return r.rows[0];
      },
    );
  }
  async deleteCost(
    user: UserContext,
    vehicleId: string,
    id: string,
    body: unknown,
    key: unknown,
  ) {
    const data = versionSchema.parse(body);
    return this.mutate(
      user,
      vehicleId,
      `cost-delete:${id}`,
      key,
      data,
      async (c) => {
        const old = await this.version(
          c,
          user,
          vehicleId,
          "vehicle_cost_entries",
          id,
          data.version,
        );
        if (old.source !== "manual")
          throw new ConflictException(
            "Аннулируйте исходный расход рейса: удаление связи скрыло бы затраты",
          );
        await c.query(
          "UPDATE vehicle_cost_entries SET deleted_at=now(),version=version+1 WHERE tenant_id=$1 AND vehicle_id=$2 AND id=$3",
          [user.tenant_id, vehicleId, id],
        );
        await this.fleet.audit(c, user, id, "period.cost_deleted", old);
        return { deleted: true };
      },
    );
  }
  async recognize(
    user: UserContext,
    vehicleId: string,
    body: unknown,
    key: unknown,
  ) {
    const data = recognizeSchema.parse(body);
    return this.mutate(user, vehicleId, "recognize", key, data, async (c) => {
      await this.category(c, user, vehicleId, data.category);
      const r = await c.query(
        "SELECT e.*,t.vehicle_id AS current_vehicle_id FROM expenses e JOIN trips t ON t.tenant_id=e.tenant_id AND t.id=e.trip_id WHERE e.tenant_id=$1 AND e.id=$2",
        [user.tenant_id, data.expense_id],
      );
      const e = r.rows[0];
      if (!e) throw new NotFoundException("Источник не найден");
      if (e.voided_at || e.version !== data.expense_version)
        throw new ConflictException(
          "Источник изменён или аннулирован. Обновите данные",
        );
      const existing = await c.query(
        "SELECT id,vehicle_id FROM vehicle_cost_entries WHERE tenant_id=$1 AND trip_expense_id=$2",
        [user.tenant_id, e.id],
      );
      if (existing.rows.length && existing.rows[0].id !== data.replace_entry_id)
        throw new ConflictException(
          "Источник уже признан ровно один раз. Изменяйте существующую связь",
        );
      // The route vehicle is explicitly selected by the accountant, never inferred from dates.
      const id = data.replace_entry_id ?? randomUUID();
      if (data.replace_entry_id) {
        const old = await this.version(
          c,
          user,
          vehicleId,
          "vehicle_cost_entries",
          id,
          data.replace_version!,
        );
        if (old.source === "trip" && old.trip_expense_id !== e.id)
          throw new ConflictException(
            "Нельзя заменить один рейсовый источник другим",
          );
        await this.fleet.audit(c, user, id, "period.source_replaced", old);
        await c.query(
          "UPDATE vehicle_cost_entries SET source='trip',trip_expense_id=$4,source_category=$5,category=$6,date=NULL,amount=NULL,note=$7,source_vehicle_id=$8,version=version+1 WHERE tenant_id=$1 AND vehicle_id=$2 AND id=$3",
          [
            user.tenant_id,
            vehicleId,
            id,
            e.id,
            e.category,
            data.category,
            data.note,
            e.current_vehicle_id,
          ],
        );
      } else {
        await c.query(
          "INSERT INTO vehicle_cost_entries(id,tenant_id,vehicle_id,source,trip_expense_id,source_category,category,note,created_by,source_vehicle_id) VALUES($1,$2,$3,'trip',$4,$5,$6,$7,$8,$9)",
          [
            id,
            user.tenant_id,
            vehicleId,
            e.id,
            e.category,
            data.category,
            data.note,
            user.user_id,
            e.current_vehicle_id,
          ],
        );
      }
      await this.fleet.audit(c, user, id, "period.source_recognized", {
        ...data,
        current_vehicle_id: e.current_vehicle_id,
        recognized_vehicle_id: vehicleId,
      });
      return { id, source_id: e.id };
    });
  }
  private async data(
    c: PoolClient,
    user: UserContext,
    vehicleId: string,
    range: { start_date: string; end_date: string },
  ) {
    const args = [user.tenant_id, vehicleId, range.start_date, range.end_date];
    const profile = await this.ownership(c, user, vehicleId);
    const readings = await c.query<PeriodReading>(
      "SELECT id,date,km::text,work_hours::text,engine_hours::text,note,version FROM vehicle_readings WHERE tenant_id=$1 AND vehicle_id=$2 AND date>=$3 AND date<=$4 ORDER BY date",
      [user.tenant_id, vehicleId, range.start_date, nextDay(range.end_date)],
    );
    const entries = await c.query<PeriodEntry>(
      `SELECT l.id,l.source,COALESCE(l.trip_expense_id,l.id) AS source_id,l.vehicle_id,COALESCE(e.incurred_on,l.date) AS date,l.category,COALESCE(e.amount,l.amount)::text AS amount,l.note,l.version,e.version AS source_version,(l.deleted_at IS NOT NULL OR e.voided_at IS NOT NULL) AS voided,COALESCE(t.vehicle_id<>l.source_vehicle_id OR e.category<>l.source_category,false) AS source_warning FROM vehicle_cost_entries l LEFT JOIN expenses e ON e.tenant_id=l.tenant_id AND e.id=l.trip_expense_id LEFT JOIN trips t ON t.tenant_id=e.tenant_id AND t.id=e.trip_id WHERE l.tenant_id=$1 AND l.vehicle_id=$2 AND COALESCE(e.incurred_on,l.date)>=$3 AND COALESCE(e.incurred_on,l.date)<=$4 ORDER BY COALESCE(e.incurred_on,l.date),l.id`,
      args,
    );
    const pending = await c.query(
      "SELECT e.id,e.trip_id,e.category,e.amount::text,e.incurred_on,e.note,e.version,t.vehicle_id FROM expenses e JOIN trips t ON t.tenant_id=e.tenant_id AND t.id=e.trip_id LEFT JOIN vehicle_cost_entries l ON l.tenant_id=e.tenant_id AND l.trip_expense_id=e.id WHERE e.tenant_id=$1 AND t.vehicle_id=$2 AND e.incurred_on>=$3 AND e.incurred_on<=$4 AND e.voided_at IS NULL AND l.id IS NULL ORDER BY e.incurred_on,e.id",
      args,
    );
    const elsewhere = await c.query(
      "SELECT e.id,e.trip_id,l.vehicle_id AS recognized_vehicle_id,e.amount::text,e.incurred_on FROM expenses e JOIN trips t ON t.tenant_id=e.tenant_id AND t.id=e.trip_id JOIN vehicle_cost_entries l ON l.tenant_id=e.tenant_id AND l.trip_expense_id=e.id WHERE e.tenant_id=$1 AND t.vehicle_id=$2 AND l.vehicle_id<>$2 AND e.incurred_on>=$3 AND e.incurred_on<=$4 AND e.voided_at IS NULL ORDER BY e.incurred_on,e.id",
      args,
    );
    const revision =
      (
        await c.query(
          "SELECT revision FROM vehicle_period_revisions WHERE tenant_id=$1",
          [user.tenant_id],
        )
      ).rows[0]?.revision ?? 0;
    const review = (
      await c.query(
        "SELECT revision,states FROM vehicle_period_reviews WHERE tenant_id=$1 AND vehicle_id=$2 AND start_date=$3 AND end_date=$4",
        args,
      )
    ).rows[0] as { revision: number; states: ReviewState[] } | undefined;
    const report = calculatePeriod({
      ...range,
      ownership: profile?.ownership ?? null,
      revision,
      review,
      readings: readings.rows,
      entries: entries.rows,
      unresolved_sources: pending.rows.length,
    });
    if (elsewhere.rows.length)
      report.warnings.push(
        `Расходы текущих рейсов (${elsewhere.rows.length}) признаны за другой машиной. Их суммы здесь не включены; проверьте исходные привязки, не создавайте дубликаты.`,
      );
    return {
      profile: profile ?? null,
      readings: readings.rows,
      pending_sources: pending.rows,
      recognized_elsewhere: elsewhere.rows,
      report,
      income: await this.income.periodData(
        c,
        user,
        vehicleId,
        range,
        report.total_cost,
        report.costs_reviewed,
      ),
    };
  }
  async report(user: UserContext, vehicleId: string, query: unknown) {
    requireRole(user, ["owner", "accountant"]);
    const { page_size, ...range } = periodReportQuerySchema.parse(query);
    return this.db.transaction(async (c) => {
      const vehicle = await this.lock(c, user, vehicleId);
      const data = await this.data(c, user, vehicleId, range);
      if (page_size === undefined) return { vehicle, ...data };
      const { items: costs, ...costPage } = periodPage(
        data.report.entries,
        page_size,
        0,
        data.report.revision,
      );
      const { items: income, ...incomePage } = periodPage(
        data.income.entries,
        page_size,
        0,
        data.report.revision,
      );
      return {
        vehicle,
        ...data,
        report: { ...data.report, entries: costs },
        income: { ...data.income, entries: income },
        pages: { costs: costPage, income: incomePage },
      };
    });
  }
  async entries(user: UserContext, vehicleId: string, query: unknown) {
    requireRole(user, ["owner", "accountant"]);
    const { kind, limit, offset, expected_revision, ...range } =
      periodEntriesQuerySchema.parse(query);
    return this.db.transaction(async (c) => {
      await this.lock(c, user, vehicleId);
      const revision =
        (
          await c.query(
            "SELECT revision FROM vehicle_period_revisions WHERE tenant_id=$1",
            [user.tenant_id],
          )
        ).rows[0]?.revision ?? 0;
      if (revision !== expected_revision)
        throw new ConflictException(
          "Данные периода изменились. Обновите отчёт перед загрузкой страниц",
        );
      const data = await this.data(c, user, vehicleId, range);
      return kind === "costs"
        ? periodPage(data.report.entries, limit, offset, revision)
        : periodPage(data.income.entries, limit, offset, revision);
    });
  }
  async review(
    user: UserContext,
    vehicleId: string,
    body: unknown,
    key: unknown,
  ) {
    const data = reviewSchema.parse(body);
    const range = periodRangeSchema.parse({
      start_date: data.start_date,
      end_date: data.end_date,
    });
    return this.mutate(user, vehicleId, "review", key, data, async (c) => {
      const state = await this.data(c, user, vehicleId, range);
      if (!state.profile)
        throw new ConflictException("Сначала укажите тип владения");
      if (data.expected_revision !== state.report.revision)
        throw new ConflictException(
          "Данные изменились. Обновите отчёт и перепроверьте затраты",
        );
      if (
        state.pending_sources.length ||
        state.report.entries.some((e) => e.source_warning)
      )
        throw new ConflictException(
          "Сначала разрешите предупреждения рейсовых источников",
        );
      const expected = applicableCategories(state.profile.ownership);
      if (
        new Set(data.states.map((s) => s.category)).size !==
          data.states.length ||
        data.states.some((s) => !expected.includes(s.category))
      )
        throw new BadRequestException(
          "Повторяющиеся или неприменимые группы проверки",
        );
      for (const s of data.states) {
        if (s.status === "not_applicable" && s.reason.length < 3)
          throw new BadRequestException("Для неприменимости нужна причина");
        if (
          ["zero", "not_applicable"].includes(s.status) &&
          state.report.entries.some(
            (e) => e.category === s.category && /[1-9]/.test(e.amount),
          )
        )
          throw new ConflictException(
            "Положительные затраты нельзя подтвердить как отсутствующие или неприменимые",
          );
      }
      await c.query(
        "INSERT INTO vehicle_period_reviews(tenant_id,vehicle_id,start_date,end_date,revision,states,reviewed_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id,vehicle_id,start_date,end_date) DO UPDATE SET revision=$5,states=$6,reviewed_by=$7,reviewed_at=now()",
        [
          user.tenant_id,
          vehicleId,
          range.start_date,
          range.end_date,
          state.report.revision,
          JSON.stringify(data.states),
          user.user_id,
        ],
      );
      await this.fleet.audit(c, user, vehicleId, "period.review", data);
      return this.data(c, user, vehicleId, range);
    });
  }
}
