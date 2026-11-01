import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import { Response } from "express";
import { ZodError } from "zod";
@Catch()
export class ApiErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    let status = 500,
      message = "Не удалось выполнить запрос. Попробуйте ещё раз.";
    let fields: Record<string, string> = {};
    if (error instanceof ZodError) {
      status = 400;
      message = "Проверьте поля формы";
      fields = Object.fromEntries(
        error.issues.map((i) => [i.path.join("."), i.message]),
      );
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      message = error.message;
    } else if (
      typeof error === "object" &&
      error &&
      "type" in error &&
      (error.type === "entity.parse.failed" ||
        error.type === "entity.too.large")
    ) {
      status = error.type === "entity.too.large" ? 413 : 400;
      message = status === 413 ? "Запрос слишком большой" : "Некорректный JSON";
    } else if (typeof error === "object" && error && "code" in error) {
      if (error.code === "23505") {
        status = 409;
        message = "Запись с такими данными уже существует";
      }
      if (error.code === "23503") {
        status = 400;
        message = "Связанная запись недоступна";
      }
    }
    if (status === 500)
      console.error(
        "API request failed",
        error instanceof Error ? error.name : "unknown",
      );
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(status)
      .json({ error: { message, fields } });
  }
}
