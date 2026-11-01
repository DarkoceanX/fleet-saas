import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthedRequest, SessionGuard } from "./auth";
import { OperationsService } from "./operations";
@Controller("api/v1")
@UseGuards(SessionGuard)
export class OperationsController {
  constructor(private readonly ops: OperationsService) {}
  @Get("drivers") drivers(@Req() r: AuthedRequest, @Query() q: unknown) {
    return this.ops.drivers(r.user, q);
  }
  @Get("drivers/:id") driver(@Req() r: AuthedRequest, @Param("id") id: string) {
    return this.ops.driver(r.user, id);
  }
  @Post("drivers") createDriver(
    @Req() r: AuthedRequest,
    @Body() b: unknown,
    @Headers("idempotency-key") k: unknown,
  ) {
    return this.ops.createDriver(r.user, b, k);
  }
  @Patch("drivers/:id") updateDriver(
    @Req() r: AuthedRequest,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.ops.updateDriver(r.user, id, b);
  }
  @Patch("trips/:id/assignment") assign(
    @Req() r: AuthedRequest,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.ops.assign(r.user, id, b);
  }
  @Post("trips/:id/status") transition(
    @Req() r: AuthedRequest,
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: unknown,
  ) {
    return this.ops.transition(r.user, id, b, k);
  }
  @Get("trips/:id/status-history") history(
    @Req() r: AuthedRequest,
    @Param("id") id: string,
    @Query() q: unknown,
  ) {
    return this.ops.history(r.user, id, q);
  }
  @Get("trips/:id/expenses") expenses(
    @Req() r: AuthedRequest,
    @Param("id") id: string,
    @Query() q: unknown,
  ) {
    return this.ops.expenses(r.user, id, q);
  }
  @Post("trips/:id/expenses") addExpense(
    @Req() r: AuthedRequest,
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: unknown,
  ) {
    return this.ops.addExpense(r.user, id, b, k);
  }
  @Get("expenses/:id") expense(
    @Req() r: AuthedRequest,
    @Param("id") id: string,
  ) {
    return this.ops.expense(r.user, id);
  }
  @Post("expenses/:id/void") voidExpense(
    @Req() r: AuthedRequest,
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: unknown,
  ) {
    return this.ops.voidExpense(r.user, id, b, k);
  }
  @Get("trips/:id/comparison") comparison(
    @Req() r: AuthedRequest,
    @Param("id") id: string,
  ) {
    return this.ops.comparison(r.user, id);
  }
}
