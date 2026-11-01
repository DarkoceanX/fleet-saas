import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { PoolClient } from "pg";
import { z } from "zod";
import {
  calculateCost,
  costInputSchema,
  tripSchema,
  tripUpdateSchema,
  UserContext,
  vehicleSchema,
  vehicleUpdateSchema,
} from "@fleet/shared";
import { Database } from "./db";
import { requireRole } from "./auth";
const paging = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).max(1000000).default(0),
  })
  .strict();
function id(value: string) {
  return z.uuid().parse(value);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(canonical));
  if (value && typeof value === "object")
    return JSON.stringify(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  return JSON.stringify(value);
}
const vehicleColumns = "id,name,plate,version,created_at";
const tripColumns =
  "t.id,t.vehicle_id,v.name AS vehicle_name,v.plate,t.driver_id,d.name AS driver_name,t.origin,t.destination,t.departure_date,t.status,t.version,t.assignment_version,t.started_at,t.completed_at,t.created_at";
const tripJoin =
  "FROM trips t JOIN vehicles v ON v.tenant_id=t.tenant_id AND v.id=t.vehicle_id LEFT JOIN drivers d ON d.tenant_id=t.tenant_id AND d.id=t.driver_id";
@Injectable()
export class FleetService {
  constructor(private readonly db: Database) {}
  async audit(
    client: PoolClient,
    user: UserContext,
    entity: string,
    action: string,
    details: Record<string, unknown> = {},
  ) {
    await client.query(
      "INSERT INTO audit_events(id,tenant_id,actor_id,entity_id,action,details) VALUES($1,$2,$3,$4,$5,$6)",
      [
        randomUUID(),
        user.tenant_id,
        user.user_id,
        entity,
        action,
        JSON.stringify(details),
      ],
    );
  }
  async create(
    user: UserContext,
    operation: string,
    key: unknown,
    payload: unknown,
    fn: (client: PoolClient) => Promise<Record<string, unknown>>,
  ) {
    const validKey = z.uuid().parse(key);
    const hash = createHash("sha256").update(canonical(payload)).digest("hex");
    return this.db.transaction(async (client) => {
      // Advisory lock serializes identical keys; the primary key remains the durable constraint.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`${user.tenant_id}:${user.user_id}:${operation}:${validKey}`],
      );
      const prior = await client.query(
        "SELECT request_hash,response FROM idempotency_keys WHERE tenant_id=$1 AND actor_id=$2 AND operation=$3 AND key=$4",
        [user.tenant_id, user.user_id, operation, validKey],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].request_hash !== hash)
          throw new ConflictException(
            "Ключ повтора уже использован с другими данными",
          );
        return prior.rows[0].response;
      }
      const response = await fn(client);
      await client.query(
        "INSERT INTO idempotency_keys(tenant_id,actor_id,operation,key,request_hash,response) VALUES($1,$2,$3,$4,$5,$6)",
        [
          user.tenant_id,
          user.user_id,
          operation,
          validKey,
          hash,
          JSON.stringify(response),
        ],
      );
      return response;
    });
  }
  async vehicles(user: UserContext, query: unknown) {
    const p = paging.parse(query);
    const result = await this.db.pool.query(
      `SELECT ${vehicleColumns} FROM vehicles WHERE tenant_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`,
      [user.tenant_id, p.limit + 1, p.offset],
    );
    return {
      items: result.rows.slice(0, p.limit),
      has_more: result.rows.length > p.limit,
    };
  }
  async vehicle(user: UserContext, vehicleId: string) {
    const result = await this.db.pool.query(
      `SELECT ${vehicleColumns} FROM vehicles WHERE tenant_id=$1 AND id=$2`,
      [user.tenant_id, id(vehicleId)],
    );
    if (!result.rows[0]) throw new NotFoundException("Машина не найдена");
    return result.rows[0];
  }
  async createVehicle(user: UserContext, body: unknown, key: unknown) {
    requireRole(user, ["owner", "dispatcher"]);
    const data = vehicleSchema.parse(body);
    return this.create(user, "vehicles", key, data, async (c) => {
      const r = await c.query(
        `INSERT INTO vehicles(id,tenant_id,name,plate) VALUES($1,$2,$3,$4) RETURNING ${vehicleColumns}`,
        [randomUUID(), user.tenant_id, data.name, data.plate],
      );
      await this.audit(c, user, r.rows[0].id, "vehicle.created");
      return r.rows[0];
    });
  }
  async updateVehicle(user: UserContext, vehicleId: string, body: unknown) {
    requireRole(user, ["owner", "dispatcher"]);
    const data = vehicleUpdateSchema.parse(body);
    return this.db.transaction(async (c) => {
      const found = await c.query(
        "SELECT version FROM vehicles WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [user.tenant_id, id(vehicleId)],
      );
      if (!found.rows[0]) throw new NotFoundException("Машина не найдена");
      if (found.rows[0].version !== data.version)
        throw new ConflictException("Машина уже изменена. Обновите данные");
      const r = await c.query(
        `UPDATE vehicles SET name=$3,plate=$4,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING ${vehicleColumns}`,
        [user.tenant_id, vehicleId, data.name, data.plate],
      );
      await this.audit(c, user, vehicleId, "vehicle.updated");
      return r.rows[0];
    });
  }
  async dispatchLock(c: PoolClient, user: UserContext) {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `dispatch:${user.tenant_id}`,
    ]);
  }
  async lockedTrip(c: PoolClient, user: UserContext, tripId: string) {
    const r = await c.query(
      "SELECT * FROM trips WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
      [user.tenant_id, id(tripId)],
    );
    if (!r.rows[0]) throw new NotFoundException("Рейс не найден");
    return r.rows[0];
  }
  async resources(
    c: PoolClient,
    user: UserContext,
    vehicleId: string,
    driverId: string | null,
    reserve = false,
    tripId?: string,
  ) {
    const v = await c.query(
      "SELECT id FROM vehicles WHERE tenant_id=$1 AND id=$2 FOR KEY SHARE",
      [user.tenant_id, vehicleId],
    );
    if (!v.rows[0]) throw new NotFoundException("Машина не найдена");
    if (driverId) {
      const d = await c.query(
        "SELECT active FROM drivers WHERE tenant_id=$1 AND id=$2 FOR KEY SHARE",
        [user.tenant_id, driverId],
      );
      if (!d.rows[0]) throw new NotFoundException("Водитель не найден");
      if (!d.rows[0].active) throw new ConflictException("Водитель неактивен");
    }
    if (reserve) {
      if (!driverId)
        throw new ConflictException("Для планирования назначьте водителя");
      const r = await c.query(
        "SELECT id FROM trips WHERE tenant_id=$1 AND status IN ('planned','in_progress') AND (vehicle_id=$2 OR driver_id=$3) AND id<>$4 LIMIT 1",
        [user.tenant_id, vehicleId, driverId, tripId],
      );
      if (r.rows[0])
        throw new ConflictException(
          "Машина или водитель уже назначены на активный рейс. Завершите или отмените его",
        );
    }
  }
  async trips(user: UserContext, query: unknown) {
    const p = paging.parse(query);
    const r = await this.db.pool.query(
      `SELECT ${tripColumns} ${tripJoin} WHERE t.tenant_id=$1 ORDER BY t.created_at DESC,t.id DESC LIMIT $2 OFFSET $3`,
      [user.tenant_id, p.limit + 1, p.offset],
    );
    return {
      items: r.rows.slice(0, p.limit),
      has_more: r.rows.length > p.limit,
    };
  }
  async trip(user: UserContext, tripId: string, c?: PoolClient) {
    const r = await (c || this.db.pool).query(
      `SELECT ${tripColumns} ${tripJoin} WHERE t.tenant_id=$1 AND t.id=$2`,
      [user.tenant_id, id(tripId)],
    );
    if (!r.rows[0]) throw new NotFoundException("Рейс не найден");
    return r.rows[0];
  }
  async createTrip(user: UserContext, body: unknown, key: unknown) {
    requireRole(user, ["owner", "dispatcher"]);
    const data = tripSchema.parse(body);
    return this.create(user, "trips", key, data, async (c) => {
      await this.dispatchLock(c, user);
      await this.resources(c, user, data.vehicle_id, data.driver_id ?? null);
      const tripId = randomUUID();
      await c.query(
        "INSERT INTO trips(id,tenant_id,vehicle_id,driver_id,origin,destination,departure_date) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          tripId,
          user.tenant_id,
          data.vehicle_id,
          data.driver_id ?? null,
          data.origin,
          data.destination,
          data.departure_date,
        ],
      );
      await this.audit(c, user, tripId, "trip.created");
      return this.trip(user, tripId, c);
    });
  }
  async updateTrip(user: UserContext, tripId: string, body: unknown) {
    requireRole(user, ["owner", "dispatcher"]);
    const data = tripUpdateSchema.parse(body);
    return this.db.transaction(async (c) => {
      await this.dispatchLock(c, user);
      const old = await this.lockedTrip(c, user, tripId);
      if (old.version !== data.version)
        throw new ConflictException("Рейс уже изменён. Обновите данные");
      if (!["draft", "planned"].includes(old.status))
        throw new ConflictException(
          "Назначение и маршрут можно менять только до выезда",
        );
      const driverId =
        data.driver_id === undefined ? old.driver_id : data.driver_id;
      await this.resources(
        c,
        user,
        data.vehicle_id,
        driverId,
        old.status === "planned",
        tripId,
      );
      await c.query(
        "UPDATE trips SET vehicle_id=$3,driver_id=$4,origin=$5,destination=$6,departure_date=$7,version=version+1,assignment_version=assignment_version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
        [
          user.tenant_id,
          tripId,
          data.vehicle_id,
          driverId,
          data.origin,
          data.destination,
          data.departure_date,
        ],
      );
      await this.audit(c, user, tripId, "trip.updated", {
        previous_vehicle_id: old.vehicle_id,
        vehicle_id: data.vehicle_id,
        previous_driver_id: old.driver_id,
        driver_id: driverId,
      });
      return this.trip(user, tripId, c);
    });
  }
  async estimates(user: UserContext, tripId: string, query: unknown) {
    requireRole(user, ["owner", "accountant"]);
    await this.trip(user, tripId);
    const p = paging.parse(query);
    const r = await this.db.pool.query(
      "SELECT id,trip_id,currency,calculation_version,tariff_version,input_snapshot,result,total,assignment_version,assignment_snapshot,created_at FROM cost_estimates WHERE tenant_id=$1 AND trip_id=$2 ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4",
      [user.tenant_id, tripId, p.limit + 1, p.offset],
    );
    return {
      items: r.rows.slice(0, p.limit),
      has_more: r.rows.length > p.limit,
    };
  }
  async estimate(
    user: UserContext,
    tripId: string,
    body: unknown,
    key: unknown,
  ) {
    requireRole(user, ["owner", "accountant"]);
    const input = costInputSchema.parse(body);
    const result = calculateCost(input);
    await this.trip(user, tripId);
    return this.create(user, `estimates:${tripId}`, key, input, async (c) => {
      const current = await this.lockedTrip(c, user, tripId);
      if (!["draft", "planned"].includes(current.status))
        throw new ConflictException(
          "План фиксируется до выезда. После выезда добавляйте фактические расходы",
        );
      const t = await this.trip(user, tripId, c);
      const snapshot = {
        vehicle_id: t.vehicle_id,
        vehicle_name: t.vehicle_name,
        plate: t.plate,
        driver_id: t.driver_id,
        driver_name: t.driver_name,
        origin: t.origin,
        destination: t.destination,
        departure_date: t.departure_date,
      };
      const r = await c.query(
        `INSERT INTO cost_estimates(id,tenant_id,trip_id,currency,calculation_version,tariff_version,input_snapshot,result,total,created_by,assignment_version,assignment_snapshot) VALUES($1,$2,$3,'RUB','1','manual-v1',$4,$5,$6,$7,$8,$9) RETURNING id,trip_id,currency,calculation_version,tariff_version,input_snapshot,result,total,assignment_version,assignment_snapshot,created_at`,
        [
          randomUUID(),
          user.tenant_id,
          tripId,
          JSON.stringify(input),
          JSON.stringify(result),
          result.total,
          user.user_id,
          current.assignment_version,
          JSON.stringify(snapshot),
        ],
      );
      await this.audit(c, user, r.rows[0].id, "estimate.created");
      return r.rows[0];
    });
  }
}
