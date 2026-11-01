import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(__dirname, "../../../.env"), quiet: true });
export function settings() {
  const databaseUrl = process.env.DATABASE_URL;
  const secret = process.env.SESSION_SECRET;
  const appUrl = process.env.APP_BASE_URL || "http://localhost:3000";
  if (!databaseUrl || !secret || secret.length < 32)
    throw new Error(
      "DATABASE_URL и SESSION_SECRET (не менее 32 символов) обязательны",
    );
  return {
    databaseUrl,
    secret,
    appUrl,
    port: Number(process.env.API_PORT || 4000),
  };
}
