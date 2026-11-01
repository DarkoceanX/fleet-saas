import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Request, Response } from "express";
import { z } from "zod";
import { AuthService, AuthedRequest, SessionGuard } from "./auth";
import { FleetService } from "./fleet";
import { Database } from "./db";
import { settings } from "./config";
const cookie = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: settings().appUrl.startsWith("https:"),
  path: "/",
});
@Controller("api/v1")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly db: Database,
  ) {}
  @Get("health") async health() {
    await this.db.pool.query("SELECT 1");
    return { status: "ok" };
  }
  @Post("auth/login") @HttpCode(200) async login(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = z
      .object({
        email: z.email().max(254),
        password: z.string().min(1).max(200),
      })
      .strict()
      .parse(body);
    const token = await this.auth.login(
      data.email,
      data.password,
      req.ip || "local",
    );
    res.cookie("fleet_session", token, {
      ...cookie(),
      maxAge: 12 * 60 * 60 * 1000,
    });
    return this.auth.context(token);
  }
  @Get("auth/me") @UseGuards(SessionGuard) me(@Req() req: AuthedRequest) {
    return req.user;
  }
  @Post("auth/logout") @HttpCode(200) @UseGuards(SessionGuard) async logout(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(req.cookies.fleet_session);
    res.clearCookie("fleet_session", cookie());
    return { ok: true };
  }
}
@Controller("api/v1")
@UseGuards(SessionGuard)
export class FleetController {
  constructor(private readonly fleet: FleetService) {}
  @Get("vehicles") vehicles(@Req() r: AuthedRequest, @Query() q: unknown) {
    return this.fleet.vehicles(r.user, q);
  }
  @Get("vehicles/:id") vehicle(
    @Req() r: AuthedRequest,
    @Param("id") id: string,
  ) {
    return this.fleet.vehicle(r.user, id);
  }
  @Post("vehicles") vehicleCreate(
    @Req() r: AuthedRequest,
    @Body() b: unknown,
    @Headers("idempotency-key") k: unknown,
  ) {
    return this.fleet.createVehicle(r.user, b, k);
  }
  @Patch("vehicles/:id") vehicleUpdate(
    @Req() r: AuthedRequest,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.fleet.updateVehicle(r.user, id, b);
  }
  @Get("trips") trips(@Req() r: AuthedRequest, @Query() q: unknown) {
    return this.fleet.trips(r.user, q);
  }
  @Get("trips/:id") trip(@Req() r: AuthedRequest, @Param("id") id: string) {
    return this.fleet.trip(r.user, id);
  }
  @Post("trips") tripCreate(
    @Req() r: AuthedRequest,
    @Body() b: unknown,
    @Headers("idempotency-key") k: unknown,
  ) {
    return this.fleet.createTrip(r.user, b, k);
  }
  @Patch("trips/:id") tripUpdate(
    @Req() r: AuthedRequest,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.fleet.updateTrip(r.user, id, b);
  }
  @Get("trips/:id/estimates") estimates(
    @Req() r: AuthedRequest,
    @Param("id") id: string,
    @Query() q: unknown,
  ) {
    return this.fleet.estimates(r.user, id, q);
  }
  @Post("trips/:id/estimates") estimate(
    @Req() r: AuthedRequest,
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: unknown,
  ) {
    return this.fleet.estimate(r.user, id, b, k);
  }
}
