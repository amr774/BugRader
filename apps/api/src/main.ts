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
@Catch()
class Errors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (error instanceof ZodError)
      return res.status(400).json({
        message: error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
    if (error instanceof HttpException)
      return res.status(error.getStatus()).json({ message: error.message });
    const status = (error as { status?: number })?.status;
    if (status === 413)
      return res.status(413).json({ message: "Request exceeds 32 KB" });
    if (status === 400 || status === 415)
      return res.status(status).json({ message: "Invalid JSON request" });
    console.error(
      "API request failed",
      error instanceof Error ? error.name : "Unknown error",
    );
    return res
      .status(500)
      .json({ message: "Something went wrong. Please retry." });
  }
}
@Module({ controllers: [ApiController] })
class AppModule {}
export async function bootstrap() {
  const frontend = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
  if (new URL(frontend).origin !== frontend)
    throw new Error("FRONTEND_ORIGIN must be an exact origin");
  if (process.env.NODE_ENV === "production" && !frontend.startsWith("https://"))
    throw new Error("Production requires an HTTPS frontend");
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(helmet());
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    const ingestion = req.path === "/ingest";
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
      !["GET", "HEAD"].includes(req.method) &&
      origin !== frontend
    ) {
      res.status(403).json({ message: "Origin not allowed" });
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
