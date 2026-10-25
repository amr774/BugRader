export type Breadcrumb = {
  category: string;
  message: string;
  timestamp?: string;
};
export type Options = {
  endpoint: string;
  projectKey: string;
  environment?: string;
  release?: string;
};
export function sanitizeUrl(value: string) {
  try {
    const u = new URL(value);
    if (!["http:", "https:"].includes(u.protocol)) return "[invalid URL]";
    u.search = "";
    u.hash = "";
    u.username = "";
    u.password = "";
    return u.toString();
  } catch {
    return "[invalid URL]";
  }
}
export function redact(value: string) {
  return value
    .replace(/https?:\/\/[^\s<>"']+/gi, sanitizeUrl)
    .replace(/\bBearer\s+[\w.~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(
      /(["']?\b(?:password|passwd|secret|token|api[_-]?key|authorization|cookie|access_token|refresh_token)\b["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;&}]+)/gi,
      "$1[REDACTED]",
    );
}
export function serialize(value: unknown): string {
  try {
    const seen = new WeakSet<object>();
    const walk = (v: unknown, depth: number): unknown => {
      if (typeof v === "string") return redact(v).slice(0, 1000);
      if (v === null || typeof v === "boolean" || typeof v === "number")
        return v;
      if (typeof v !== "object") return String(v).slice(0, 200);
      if (seen.has(v)) return "[Circular]";
      if (depth >= 3) return "[Max depth]";
      seen.add(v);
      if (Array.isArray(v))
        return v.slice(0, 10).map((x) => walk(x, depth + 1));
      return Object.fromEntries(
        Object.keys(v)
          .slice(0, 20)
          .map((k) => [
            k,
            /password|passwd|secret|token|api.?key|authorization|cookie/i.test(
              k,
            )
              ? "[REDACTED]"
              : walk((v as Record<string, unknown>)[k], depth + 1),
          ]),
      );
    };
    return (
      typeof value === "string" ? redact(value) : JSON.stringify(walk(value, 0))
    ).slice(0, 2000);
  } catch {
    return "[Unserializable value]";
  }
}
type EventPayload = {
  eventId: string;
  name: string;
  message: string;
  stack?: string;
  url?: string;
  environment: string;
  release?: string;
  sdkVersion: string;
  clientTimestamp: string;
  userAgent?: string;
  breadcrumbs: Breadcrumb[];
};
type Pending = { payload: EventPayload; attempt: number };
let options: Options | undefined;
let crumbs: Breadcrumb[] = [];
let queue: Pending[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let controller: AbortController | undefined;
let running = false;
let generation = 0;
let seen = new WeakSet<object>();
const protect = (fn: () => void) => {
  try {
    fn();
  } catch {
    /* Monitoring must never affect the host. */
  }
};
function schedule(delay = 0) {
  if (!timer && options)
    timer = setTimeout(() => {
      timer = undefined;
      void send();
    }, delay);
}
async function send() {
  if (running || !options || !queue.length) return;
  running = true;
  const current = generation;
  const item = queue[0];
  const config = options;
  const abort = new AbortController();
  controller = abort;
  const timeout = setTimeout(() => abort.abort(), 8000);
  let retry = false;
  try {
    const result = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BugRadar-Key": config.projectKey,
      },
      body: JSON.stringify(item.payload),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: abort.signal,
    });
    retry =
      result.status === 408 || result.status === 429 || result.status >= 500;
  } catch {
    retry = true;
  } finally {
    clearTimeout(timeout);
    if (current === generation) {
      controller = undefined;
      running = false;
      if (retry && item.attempt < 3) {
        item.attempt++;
        schedule(500 * 2 ** (item.attempt - 1));
      } else {
        queue.shift();
        schedule();
      }
    }
  }
}
function capture(error: unknown) {
  protect(() => {
    if (!options || typeof window === "undefined" || queue.length >= 50) return;
    if (typeof error === "object" && error !== null) {
      if (seen.has(error)) return;
      seen.add(error);
    }
    const isError = error instanceof Error;
    const payload: EventPayload = {
      eventId: crypto.randomUUID(),
      name:
        redact(isError ? error.name : "UnhandledRejection").slice(0, 160) ||
        "Error",
      message:
        (isError ? redact(error.message) : serialize(error)).slice(0, 2000) ||
        "Unknown error",
      ...(isError && error.stack
        ? { stack: redact(error.stack).slice(0, 12000) }
        : {}),
      url: sanitizeUrl(window.location.href).slice(0, 2000),
      environment:
        redact(options.environment ?? "production").slice(0, 64) ||
        "production",
      ...(options.release
        ? { release: redact(options.release).slice(0, 100) }
        : {}),
      sdkVersion: "0.1.0",
      clientTimestamp: new Date().toISOString(),
      userAgent: redact(navigator.userAgent).slice(0, 1000),
      breadcrumbs: crumbs.map((b) => ({ ...b })),
    };
    // Keep UTF-8 encoded requests below the API's 32 KB ceiling, even for emoji/CJK.
    const bytes = () =>
      new TextEncoder().encode(JSON.stringify(payload)).length;
    while (bytes() > 30000 && payload.breadcrumbs.length)
      payload.breadcrumbs.shift();
    while (bytes() > 30000 && payload.stack)
      payload.stack = payload.stack.slice(
        0,
        Math.floor(payload.stack.length / 2),
      );
    queue.push({ payload, attempt: 0 });
    schedule();
  });
}
const onError = (event: ErrorEvent) =>
  capture(event.error ?? new Error(event.message || "Unknown browser error"));
const onRejection = (event: PromiseRejectionEvent) => capture(event.reason);
function destroy() {
  protect(() => {
    generation++;
    if (typeof window !== "undefined") {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    }
    if (timer) clearTimeout(timer);
    timer = undefined;
    controller?.abort();
    controller = undefined;
    running = false;
    queue = [];
    crumbs = [];
    seen = new WeakSet();
    options = undefined;
  });
}
export const BugRadar = {
  init(config: Options) {
    protect(() => {
      destroy();
      if (typeof window === "undefined") return;
      const endpoint = new URL(config.endpoint);
      if (
        !["http:", "https:"].includes(endpoint.protocol) ||
        !config.projectKey
      )
        return;
      options = { ...config, endpoint: endpoint.toString() };
      window.addEventListener("error", onError);
      window.addEventListener("unhandledrejection", onRejection);
    });
  },
  captureException: capture,
  addBreadcrumb(breadcrumb: Breadcrumb) {
    protect(() => {
      if (!options) return;
      crumbs.push({
        category: redact(breadcrumb.category).slice(0, 80),
        message: redact(breadcrumb.message).slice(0, 500),
        timestamp: new Date().toISOString(),
      });
      if (crumbs.length > 30) crumbs.shift();
    });
  },
  destroy,
};
