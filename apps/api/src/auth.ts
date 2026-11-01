import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  HttpException,
} from "@nestjs/common";
import { createHmac, randomBytes } from "node:crypto";
import { Request } from "express";
import { UserContext, Role } from "@fleet/shared";
import { Database } from "./db";
import { settings } from "./config";
import { matches } from "./password";
export type AuthedRequest = Request & { user: UserContext };
export function requireRole(user: UserContext, roles: Role[]) {
  if (!roles.includes(user.role))
    throw new ForbiddenException("Недостаточно прав для этого действия");
}
@Injectable()
export class AuthService {
  private attempts = new Map<string, { count: number; until: number }>();
  constructor(private readonly db: Database) {}
  digest(token: string) {
    return createHmac("sha256", settings().secret).update(token).digest("hex");
  }
  async login(email: string, password: string, ip: string) {
    const now = Date.now();
    for (const [key, value] of this.attempts)
      if (value.until < now) this.attempts.delete(key);
    const limit = this.attempts.get(ip) || { count: 0, until: now + 60000 };
    if (limit.count >= 20)
      throw new HttpException(
        "Слишком много попыток. Повторите через минуту.",
        429,
      );
    limit.count++;
    this.attempts.set(ip, limit);
    const { rows } = await this.db.pool.query(
      "SELECT u.id,u.password_hash,m.tenant_id FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.email=$1 ORDER BY m.tenant_id LIMIT 1",
      [email.toLowerCase()],
    );
    const row = rows[0];
    // Execute the same expensive derivation even for unknown accounts.
    const valid = await matches(
      password,
      row?.password_hash || `${"0".repeat(32)}:${"0".repeat(128)}`,
    );
    if (!row || !valid)
      throw new UnauthorizedException("Неверный email или пароль");
    const token = randomBytes(32).toString("hex");
    await this.db.pool.query(
      "INSERT INTO sessions(token_hash,tenant_id,user_id,expires_at) VALUES($1,$2,$3,now()+interval '12 hours')",
      [this.digest(token), row.tenant_id, row.id],
    );
    return token;
  }
  async context(token: unknown): Promise<UserContext> {
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
      throw new UnauthorizedException("Войдите в приложение");
    const { rows } = await this.db.pool.query(
      `SELECT u.id AS user_id,m.tenant_id,u.name,o.name AS organization,m.role FROM sessions s JOIN users u ON u.id=s.user_id JOIN memberships m ON m.tenant_id=s.tenant_id AND m.user_id=s.user_id JOIN organizations o ON o.id=m.tenant_id WHERE s.token_hash=$1 AND s.expires_at>now()`,
      [this.digest(token)],
    );
    if (!rows[0])
      throw new UnauthorizedException("Сессия истекла. Войдите снова");
    return rows[0];
  }
  async logout(token: string) {
    await this.db.pool.query("DELETE FROM sessions WHERE token_hash=$1", [
      this.digest(token),
    ]);
  }
}
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    req.user = await this.auth.context(req.cookies?.fleet_session);
    return true;
  }
}
