import "reflect-metadata";
import {
  Catch,
  ExceptionFilter,
  ArgumentsHost,
  HttpException,
  Module,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json, Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { ZodError } from "zod";
import { ApiController } from "./controller";
import { db } from "./db";
import { rateLimit } from "./auth";
@Catch()
class Errors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (error instanceof ZodError)
      return res.status(400).json({
        code: "INVALID_INPUT",
        fields: error.issues.map((i) => ({
          path: i.path.join("."),
          code: i.code,
        })),
        message: error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
    if (error instanceof HttpException)
      return res
        .status(error.getStatus())
        .json({ code: errorCode(error.getStatus()), message: error.message });
    const status = (error as { status?: number })?.status;
    if (status === 413)
      return res
        .status(413)
        .json({ code: "PAYLOAD_TOO_LARGE", message: "Request exceeds 32 KB" });
    if (status === 400 || status === 415)
      return res
        .status(status)
        .json({ code: "INVALID_JSON", message: "Invalid JSON request" });
    console.error(
      "API request failed",
      error instanceof Error ? error.name : "Unknown error",
    );
    return res
      .status(500)
      .json({
        code: "INTERNAL_ERROR",
        message: "Something went wrong. Please retry.",
      });
  }
}
@Module({ controllers: [ApiController] })
class AppModule {}
function errorCode(status: number) {
  return (
    (
      {
        400: "INVALID_INPUT",
        401: "UNAUTHENTICATED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        409: "CONFLICT",
        429: "RATE_LIMITED",
      } as Record<number, string>
    )[status] ?? "INTERNAL_ERROR"
  );
}
export async function bootstrap() {
  const frontend = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
  if (new URL(frontend).origin !== frontend)
    throw new Error("FRONTEND_ORIGIN must be an exact origin");
  if (process.env.NODE_ENV === "production" && !frontend.startsWith("https://"))
    throw new Error("Production requires an HTTPS frontend");
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(helmet());
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cache-Control", "no-store");
    const origin = req.headers.origin;
    const ingestion = req.path === "/ingest";
    const serverIngestion = /^\/ingest\/server\/?$/i.test(req.path);
    if (serverIngestion && origin) {
      res
        .status(403)
        .json({
          code: "SERVER_ONLY",
          message: "Server ingestion does not accept browser origins",
        });
      return;
    }
    if (origin && (ingestion || origin === frontend)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type,X-BugRadar-Key",
      );
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET,POST,PATCH,DELETE,OPTIONS",
      );
      if (!ingestion) res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    if (
      !ingestion &&
      !serverIngestion &&
      !["GET", "HEAD"].includes(req.method) &&
      origin !== frontend
    ) {
      res
        .status(403)
        .json({ code: "FORBIDDEN", message: "Origin not allowed" });
      return;
    }
    // Admit requests before JSON parsing as well as at the ingestion service
    // boundary, so malformed/oversized bodies cannot bypass IP throttling.
    try {
      if (req.method === "POST" && /^\/ingest(?:\/server)?\/?$/.test(req.path))
        rateLimit(`http-ingest:${req.ip}`, 300);
      if (
        req.method === "POST" &&
        /^\/auth\/(login|register)\/?$/.test(req.path)
      )
        rateLimit(`http-auth:${req.ip}`, 10, 15 * 60000);
    } catch (error) {
      if (error instanceof HttpException) {
        res
          .status(error.getStatus())
          .json({ code: errorCode(error.getStatus()), message: error.message });
        return;
      }
      next(error);
      return;
    }
    next();
  });
  app.use(json({ limit: "32kb", strict: true }));
  app.use(cookieParser());
  app.useGlobalFilters(new Errors());
  app.enableShutdownHooks();
  await db.$connect();
  await app.listen(Number(process.env.PORT ?? 3001), "127.0.0.1");
  return app;
}
if (require.main === module)
  bootstrap().catch((e) => {
    console.error(e);
    process.exit(1);
  });
