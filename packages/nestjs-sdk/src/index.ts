import { randomUUID } from "node:crypto";
import {
  ArgumentsHost,
  Catch,
  DynamicModule,
  Global,
  HttpException,
  Inject,
  Injectable,
  Module,
  OnModuleDestroy,
} from "@nestjs/common";
import { APP_FILTER, BaseExceptionFilter, HttpAdapterHost } from "@nestjs/core";
import { redact, serialize } from "./privacy";
export type BugRadarOptions = {
  endpoint: string;
  serverKey: string;
  environment?: string;
  release?: string;
};
export type RequestContext = { method?: string; routeTemplate?: string };
const OPTIONS = Symbol("BUGRADAR_OPTIONS");
type Pending = { payload: Record<string, unknown>; attempt: number };
@Injectable()
export class BugRadarService implements OnModuleDestroy {
  private queue: Pending[] = [];
  private seen = new WeakSet<object>();
  private timer?: ReturnType<typeof setTimeout>;
  private controller?: AbortController;
  private running = false;
  private stopped = false;
  constructor(@Inject(OPTIONS) private readonly options: BugRadarOptions) {}
  captureException(error: unknown, context: RequestContext = {}) {
    try {
      if (this.stopped || this.queue.length >= 50) return;
      if (error && typeof error === "object") {
        if (this.seen.has(error)) return;
        this.seen.add(error);
      }
      const e = error instanceof Error ? error : undefined;
      const payload: Record<string, unknown> = {
        eventId: randomUUID(),
        name: redact(e?.name ?? "Error").slice(0, 160) || "Error",
        message:
          (e ? redact(e.message) : serialize(error)).slice(0, 2000) ||
          "Unknown error",
        stack: e?.stack ? redact(e.stack).slice(0, 12000) : undefined,
        environment:
          redact(this.options.environment ?? "production").slice(0, 64) ||
          "production",
        release: this.options.release
          ? redact(this.options.release).slice(0, 100)
          : undefined,
        sdkVersion: "nestjs-0.1.0",
        clientTimestamp: new Date().toISOString(),
      };
      if (
        context.method &&
        /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(context.method)
      )
        payload.requestMethod = context.method;
      // Never fall back to raw URL, params, headers, body, or user identity.
      if (context.routeTemplate)
        payload.routeTemplate = redact(
          context.routeTemplate.split(/[?#]/)[0],
        ).slice(0, 300);
      while (
        Buffer.byteLength(JSON.stringify(payload)) > 30000 &&
        payload.stack
      )
        payload.stack = String(payload.stack).slice(
          0,
          Math.floor(String(payload.stack).length / 2),
        );
      this.queue.push({ payload, attempt: 0 });
      this.schedule();
    } catch {
      /* Never throw monitoring failures into the host. */
    }
  }
  private schedule(delay = 0) {
    if (this.timer || this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.send().catch(() => {
        this.running = false;
        this.queue.shift();
        if (this.queue.length) this.schedule();
      });
    }, delay);
    this.timer.unref();
  }
  private async send() {
    if (this.running || this.stopped || !this.queue.length) return;
    this.running = true;
    const item = this.queue[0];
    let retry = false;
    const controller = new AbortController();
    this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 5000);
    timeout.unref();
    try {
      const endpoint = new URL(this.options.endpoint);
      if (
        !["https:", "http:"].includes(endpoint.protocol) ||
        endpoint.username ||
        endpoint.password ||
        endpoint.search ||
        endpoint.hash
      )
        return;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-BugRadar-Server-Key": this.options.serverKey,
        },
        body: JSON.stringify(item.payload),
        signal: controller.signal,
        redirect: "error",
      });
      retry = [408, 429].includes(response.status) || response.status >= 500;
      await response.body?.cancel();
    } catch {
      retry = true;
    } finally {
      clearTimeout(timeout);
      this.controller = undefined;
      this.running = false;
      if (!this.stopped) {
        if (retry && item.attempt < 3) {
          item.attempt++;
          this.schedule(500 * 2 ** (item.attempt - 1));
        } else {
          this.queue.shift();
          if (this.queue.length) this.schedule();
        }
      }
    }
  }
  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.controller?.abort();
    this.queue = [];
  }
}
@Catch()
@Injectable()
export class BugRadarExceptionFilter {
  constructor(
    @Inject(BugRadarService) private readonly radar: BugRadarService,
    @Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost,
  ) {}
  catch(exception: unknown, host: ArgumentsHost) {
    try {
      const httpError = exception as {
        statusCode?: number;
        message?: unknown;
      } | null;
      const status =
        exception instanceof HttpException
          ? exception.getStatus()
          : // Match Nest's http-errors detection, not just any statusCode property.
            httpError?.statusCode && httpError.message
            ? Number(httpError.statusCode)
            : 500;
      if (status >= 500 && host.getType() === "http") {
        const req = host.switchToHttp().getRequest();
        this.radar.captureException(exception, {
          method: req?.method,
          routeTemplate:
            typeof req?.route?.path === "string"
              ? req.route.path
              : typeof req?.routeOptions?.url === "string"
                ? req.routeOptions.url
                : undefined,
        });
      }
    } catch {
      /* Preserve the host response even if request inspection fails. */
    }
    // Delegate to Nest itself: preserves HttpException response objects,
    // status codes and the default response/logging for unexpected errors.
    new BaseExceptionFilter(this.adapterHost.httpAdapter).catch(
      exception,
      host,
    );
  }
}
@Global()
@Module({})
export class BugRadarModule {
  static forRoot(options: BugRadarOptions): DynamicModule {
    return {
      module: BugRadarModule,
      providers: [
        { provide: OPTIONS, useValue: { ...options } },
        BugRadarService,
        { provide: APP_FILTER, useClass: BugRadarExceptionFilter },
      ],
      exports: [BugRadarService],
    };
  }
}
