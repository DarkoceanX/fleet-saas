import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import express from "express";
import { AuthService, SessionGuard } from "./auth";
import { Database } from "./db";
import { FleetService } from "./fleet";
import { AuthController, FleetController } from "./controllers";
import { ApiErrors } from "./errors";
import { settings } from "./config";
import { OperationsService } from "./operations";
import { OperationsController } from "./operations.controller";
import { PeriodService } from "./period";
import { PeriodController } from "./period.controller";
import { IncomeService } from "./income";
import { IncomeController } from "./income.controller";
@Module({
  controllers: [
    AuthController,
    FleetController,
    OperationsController,
    PeriodController,
    IncomeController,
  ],
  providers: [
    Database,
    AuthService,
    SessionGuard,
    FleetService,
    OperationsService,
    PeriodService,
    IncomeService,
  ],
})
class AppModule {}
export async function createApp() {
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn"],
    bodyParser: false,
  });
  app.use(helmet());
  app.use(express.json({ limit: "32kb" }));
  app.use(cookieParser());
  app.use(
    (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      // Browser mutations must originate from the configured UI, including login/logout.
      if (
        !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
        req.headers.origin !== settings().appUrl
      ) {
        res.status(403).json({
          error: { message: "Недопустимый источник запроса", fields: {} },
        });
        return;
      }
      next();
    },
  );
  app.useGlobalFilters(new ApiErrors());
  app.enableShutdownHooks();
  return app;
}
