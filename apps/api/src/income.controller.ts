import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthedRequest, SessionGuard } from "./auth";
import { IncomeService } from "./income";
@Controller("api/v1")
@UseGuards(SessionGuard)
export class IncomeController {
  constructor(private readonly income: IncomeService) {}
  @Get("trips/:id/income") trip(
    @Req() r: AuthedRequest,
    @Param("id") id: string,
  ) {
    return this.income.tripReport(r.user, id);
  }
  @Post("income") add(
    @Req() r: AuthedRequest,
    @Body() b: unknown,
    @Headers("idempotency-key") k: unknown,
  ) {
    return this.income.save(r.user, null, b, k);
  }
  @Post("income/:id") edit(
    @Req() r: AuthedRequest,
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: unknown,
  ) {
    return this.income.save(r.user, id, b, k);
  }
  @Post("income/:id/void") void(
    @Req() r: AuthedRequest,
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: unknown,
  ) {
    return this.income.void(r.user, id, b, k);
  }
  @Post("vehicles/:id/period/income-review") review(
    @Req() r: AuthedRequest,
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: unknown,
  ) {
    return this.income.review(r.user, id, b, k);
  }
}
