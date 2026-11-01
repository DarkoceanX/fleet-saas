import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool, PoolClient, types } from "pg";
import { settings } from "./config";
types.setTypeParser(1082, (value) => value); // Date-only values must never pass through a timezone.
@Injectable()
export class Database implements OnModuleDestroy {
  readonly pool = new Pool({
    connectionString: settings().databaseUrl,
    max: 10,
  });
  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async onModuleDestroy() {
    await this.pool.end();
  }
}
