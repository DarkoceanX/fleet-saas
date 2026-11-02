import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthedRequest, SessionGuard } from "./auth";
import { PeriodService } from "./period";
@Controller("api/v1/vehicles/:vehicleId/period")
@UseGuards(SessionGuard)
export class PeriodController {
  constructor(private readonly period: PeriodService) {}
  @Get() report(
    @Req() r: AuthedRequest,
    @Param("vehicleId") v: string,
    @Query() q: unknown,
  ) {
    return this.period.report(r.user, v, q);
  }
  @Get("entries") entries(
    @Req() r: AuthedRequest,
    @Param("vehicleId") v: string,
    @Query() q: unknown,
  ) {
    return this.period.entries(r.user, v, q);
  }
  @Post("ownership") ownership(
    @Req() r: AuthedRequest,
    @Param("vehicleId") v: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: unknown,
  ) {
    return this.period.setOwnership(r.user, v, b, k);
  }
  @Post("readings") reading(
    @Req() r: AuthedRequest,
    @Param("vehicleId") v: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: unknown,
  ) {
    return this.period.saveReading(r.user, v, null, b, k);
  }
  @Post("readings/:id") updateReading(
    @Req() r: AuthedRequest,
    @Param("vehicleId") v: string,
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: unknown,
  ) {
    return this.period.saveReading(r.user, v, id, b, k);
  }
  @Post("readings/:id/delete") deleteReading(
    @Req() r: AuthedRequest,
    @Param("vehicleId") v: string,
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: unknown,
  ) {
    return this.period.deleteReading(r.user, v, id, b, k);
  }
  @Post("costs") cost(
    @Req() r: AuthedRequest,
    @Param("vehicleId") v: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: unknown,
  ) {
    return this.period.saveCost(r.user, v, null, b, k);
  }
  @Post("costs/:id") updateCost(
    @Req() r: AuthedRequest,
    @Param("vehicleId") v: string,
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: unknown,
  ) {
    return this.period.saveCost(r.user, v, id, b, k);
  }
  @Post("costs/:id/delete") deleteCost(
    @Req() r: AuthedRequest,
    @Param("vehicleId") v: string,
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: unknown,
  ) {
    return this.period.deleteCost(r.user, v, id, b, k);
  }
  @Post("recognize") recognize(
    @Req() r: AuthedRequest,
    @Param("vehicleId") v: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: unknown,
  ) {
    return this.period.recognize(r.user, v, b, k);
  }
  @Post("review") review(
    @Req() r: AuthedRequest,
    @Param("vehicleId") v: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: unknown,
  ) {
    return this.period.review(r.user, v, b, k);
  }
}
