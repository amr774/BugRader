import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import { JSDOM } from "jsdom";
// Use a dedicated test port; creates only uniquely named test users, then deletes them.
const port = 3099;
const base = `http://127.0.0.1:${port}`;
const origin = "http://localhost:5173";
const child = spawn(process.execPath, ["apps/api/dist/main.js"], {
  env: { ...process.env, PORT: String(port), FRONTEND_ORIGIN: origin },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let output = "";
child.stdout?.on("data", (b) => (output += b));
child.stderr?.on("data", (b) => (output += b));
const db = new PrismaClient();
const emails: string[] = [];
let checks = 0;
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  cookie?: string,
  requestOrigin = origin,
) {
  return fetch(base + path, {
    method,
    headers: {
      Origin: requestOrigin,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
async function ok(name: string, run: () => Promise<void>) {
  await run();
  checks++;
  console.log(`PASS ${name}`);
}
async function send(key: string, payload: unknown, requestOrigin = origin) {
  return fetch(base + "/ingest", {
    method: "POST",
    headers: {
      Origin: requestOrigin,
      "Content-Type": "application/json",
      "X-BugRadar-Key": key,
    },
    body: JSON.stringify(payload),
  });
}
async function main() {
  try {
    let ready = false;
    for (let n = 0; n < 60; n++) {
      try {
        if ((await fetch(base + "/health")).ok) {
          ready = true;
          break;
        }
      } catch {}
      await delay(250);
    }
    if (!ready) throw new Error("API failed to start: " + output);
    const register = async () => {
      const email = `integration-${randomUUID()}@example.test`;
      emails.push(email);
      const r = await request("/auth/register", "POST", {
        email,
        password: "Integration-only-password-92!",
      });
      assert.equal(r.status, 201);
      assert.match(r.headers.get("set-cookie") ?? "", /HttpOnly/i);
      return { cookie: r.headers.get("set-cookie")!.split(";")[0], email };
    };
    const a = await register(),
      b = await register();
    let project: any;
    let key: string;
    let issue: any;
    await ok(
      "registration, login, current user and strict mutation origin",
      async () => {
        assert.equal(
          (await request("/auth/me", "GET", undefined, a.cookie)).status,
          200,
        );
        assert.equal((await request("/auth/me")).status, 401);
        const login = await request("/auth/login", "POST", {
          email: a.email,
          password: "Integration-only-password-92!",
        });
        assert.equal(login.status, 200);
        assert.equal(
          (
            await request(
              "/projects",
              "POST",
              { name: "bad", origins: [origin] },
              a.cookie,
              "https://evil.test",
            )
          ).status,
          403,
        );
      },
    );
    await ok(
      "create project and prevent cross-user read/edit/delete/key rotation",
      async () => {
        const r = await request(
          "/projects",
          "POST",
          { name: "Integration", origins: [origin] },
          a.cookie,
        );
        assert.equal(r.status, 201);
        project = await r.json();
        key = project.key;
        for (const [path, method, body] of [
          [`/projects/${project.id}`, "GET", undefined],
          [
            `/projects/${project.id}`,
            "PATCH",
            { name: "attack", origins: [origin] },
          ],
          [`/projects/${project.id}`, "DELETE", undefined],
          [`/projects/${project.id}/rotate-key`, "POST", {}],
        ] as const) {
          assert.equal(
            (await request(path, method, body, b.cookie)).status,
            404,
          );
        }
        const list = await (
          await request("/projects", "GET", undefined, a.cookie)
        ).json();
        assert.equal(list[0].key, undefined);
        assert.equal(list[0].keyHash, undefined);
      },
    );
    const payload = (extra: Record<string, unknown> = {}) => ({
      eventId: randomUUID(),
      name: "CheckoutError",
      message: "Inventory unavailable",
      stack:
        "CheckoutError: Inventory unavailable\n    at checkout (https://store.test/cart.js:42:9)",
      environment: "production",
      release: "1.2.0",
      sdkVersion: "test",
      clientTimestamp: "2099-01-01T00:00:00Z",
      breadcrumbs: [],
      ...extra,
    });
    await ok(
      "reject invalid keys, missing/disallowed origins, and oversized payloads",
      async () => {
        assert.equal(
          (await send("br_" + "0".repeat(64), payload())).status,
          401,
        );
        assert.equal(
          (await send(key!, payload(), "https://evil.test")).status,
          403,
        );
        assert.equal((await send(key!, payload(), "")).status, 403);
        assert.equal(
          (await send(key!, payload({ message: "x".repeat(2001) }))).status,
          400,
        );
        assert.equal(
          (await send(key!, payload({ stack: "x".repeat(40000) }))).status,
          413,
        );
      },
    );
    await ok(
      "concurrent ingestion groups exactly and retries are idempotent",
      async () => {
        const event = payload();
        const replies = await Promise.all([
          ...Array.from({ length: 18 }, () => send(key!, payload())),
          ...Array.from({ length: 7 }, () => send(key!, event)),
        ]);
        for (const r of replies) assert.equal(r.status, 202);
        const rows = await (
          await request(
            `/issues?projectId=${project.id}`,
            "GET",
            undefined,
            a.cookie,
          )
        ).json();
        assert.equal(rows.total, 1);
        issue = rows.items[0];
        assert.equal(issue.count, 19);
        assert.ok(new Date(issue.lastSeen).getFullYear() < 2099);
      },
    );
    await ok(
      "separates distinct errors and enforces issue/event/activity ownership",
      async () => {
        assert.equal(
          (await send(key!, payload({ message: "Payment declined" }))).status,
          202,
        );
        for (const path of [
          `/issues/${issue.id}`,
          `/issues/${issue.id}/events`,
          `/issues/${issue.id}/activity`,
          `/issues?projectId=${project.id}`,
        ])
          assert.equal(
            (await request(path, "GET", undefined, b.cookie)).status,
            404,
          );
        assert.equal(
          (
            await request(
              `/issues/${issue.id}/status`,
              "PATCH",
              { status: "RESOLVED" },
              b.cookie,
            )
          ).status,
          404,
        );
      },
    );
    await ok(
      "resolved reopens, ignored remains ignored, activity is recorded",
      async () => {
        await request(
          `/issues/${issue.id}/status`,
          "PATCH",
          { status: "RESOLVED" },
          a.cookie,
        );
        await send(key!, payload());
        let data = await (
          await request(`/issues/${issue.id}`, "GET", undefined, a.cookie)
        ).json();
        assert.equal(data.status, "OPEN");
        assert.ok(data.reopenedAt);
        await request(
          `/issues/${issue.id}/status`,
          "PATCH",
          { status: "IGNORED" },
          a.cookie,
        );
        await send(key!, payload());
        data = await (
          await request(`/issues/${issue.id}`, "GET", undefined, a.cookie)
        ).json();
        assert.equal(data.status, "IGNORED");
        assert.equal(data.count, 21);
        const activity = await (
          await request(
            `/issues/${issue.id}/activity`,
            "GET",
            undefined,
            a.cookie,
          )
        ).json();
        assert.ok(
          activity.items.some((x: any) => x.reason.includes("automatically")),
        );
      },
    );
    await ok(
      "filter counts and timestamps match occurrences; pagination works",
      async () => {
        await send(key!, payload({ environment: "staging", release: "2" }));
        const r = await (
          await request(
            `/issues?projectId=${project.id}&environment=staging&limit=1`,
            "GET",
            undefined,
            a.cookie,
          )
        ).json();
        assert.equal(r.items[0].count, 1);
        assert.equal(r.items[0].firstSeen, r.items[0].lastSeen);
        const events = await (
          await request(
            `/issues/${issue.id}/events?environment=staging`,
            "GET",
            undefined,
            a.cookie,
          )
        ).json();
        assert.equal(events.total, 1);
        assert.equal(events.firstSeen, r.items[0].firstSeen);
        const page = await (
          await request(
            `/issues/${issue.id}/events?limit=3&page=2`,
            "GET",
            undefined,
            a.cookie,
          )
        ).json();
        assert.equal(page.items.length, 3);
        assert.equal(page.total, 22);
      },
    );
    await ok(
      "server redacts text and URL; ingestion response reveals no details",
      async () => {
        const r = await send(
          key!,
          payload({
            message: "password=hidden-secret Bearer super-secret-token",
            url: "https://store.test/cart?token=hidden-secret#private",
            breadcrumbs: [
              { category: "click", message: "api_key=hidden-secret" },
            ],
          }),
        );
        assert.deepEqual(await r.json(), { accepted: true });
        const row = await db.event.findFirstOrThrow({
          where: { projectId: project.id, message: { contains: "REDACTED" } },
        });
        assert.ok(!JSON.stringify(row).includes("hidden-secret"));
        assert.ok(!JSON.stringify(row).includes("super-secret-token"));
        assert.equal(row.url, "https://store.test/cart");
      },
    );
    await ok(
      "rotation revokes old key; public key grants no read access",
      async () => {
        const r = await request(
          `/projects/${project.id}/rotate-key`,
          "POST",
          {},
          a.cookie,
        );
        const rotated = await r.json();
        assert.equal((await send(key!, payload())).status, 401);
        assert.equal((await send(rotated.key, payload())).status, 202);
        assert.equal(
          (
            await fetch(base + "/projects", {
              headers: { "X-BugRadar-Key": rotated.key },
            })
          ).status,
          401,
        );
      },
    );
    await ok(
      "real SDK retries after a committed response is lost without inflating counts",
      async () => {
        const p = await (
          await request(
            "/projects",
            "POST",
            { name: "SDK retry verification", origins: [origin] },
            a.cookie,
          )
        ).json();
        const dom = new JSDOM("", {
          url: origin + "/demo?token=private#fragment",
        });
        const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
        Object.defineProperty(globalThis, "window", {
          value: dom.window,
          configurable: true,
        });
        const nativeFetch = globalThis.fetch;
        const ids: string[] = [];
        globalThis.fetch = async (url, init) => {
          ids.push(JSON.parse(String(init?.body)).eventId);
          const response = await nativeFetch(url, {
            ...init,
            headers: { ...init?.headers, Origin: origin },
          });
          assert.equal(response.status, 202);
          if (ids.length === 1) {
            await response.text();
            throw new Error("Simulated response loss AFTER real commit");
          }
          return response;
        };
        const { BugRadar } =
          await import("../../../packages/browser-sdk/dist/index.js");
        try {
          BugRadar.init({
            endpoint: base + "/ingest",
            projectKey: p.key,
            environment: "retry-test",
          });
          BugRadar.captureException(
            new Error("Lost-response SDK verification"),
          );
          for (let n = 0; n < 80 && ids.length < 2; n++) await delay(50);
          assert.equal(ids.length, 2);
          await delay(100);
          assert.equal(new Set(ids).size, 1);
          const events = await db.event.findMany({
            where: { projectId: p.id },
          });
          const issues = await db.issue.findMany({
            where: { projectId: p.id },
          });
          assert.equal(events.length, 1);
          assert.equal(issues.length, 1);
          assert.equal(issues[0].count, 1);
          assert.equal(events[0].url, origin + "/demo");
          globalThis.fetch = (url, init) =>
            nativeFetch(url, {
              ...init,
              headers: { ...init?.headers, Origin: origin },
            });
          BugRadar.init({
            endpoint: base + "/ingest",
            projectKey: p.key,
            environment: "demo-test",
            release: "verification-1",
          });
          BugRadar.addBreadcrumb({
            category: "verification",
            message: "Opened SDK demo",
          });
          dom.window.dispatchEvent(
            new dom.window.ErrorEvent("error", {
              error: new Error("Window listener verification"),
            }),
          );
          const rejection = new dom.window.Event("unhandledrejection");
          Object.defineProperty(rejection, "reason", {
            value: {
              message: "Rejection listener verification",
              password: "should-not-be-stored",
            },
          });
          dom.window.dispatchEvent(rejection);
          for (let n = 0; n < 5; n++) {
            const e = new Error("Repeated SDK verification");
            e.stack =
              "Error: Repeated SDK verification\n at checkout (https://demo.test/app.js:10:4)";
            BugRadar.captureException(e);
          }
          for (let n = 0; n < 100; n++) {
            if ((await db.event.count({ where: { projectId: p.id } })) === 8)
              break;
            await delay(50);
          }
          const rows = await db.issue.findMany({ where: { projectId: p.id } });
          assert.equal(rows.length, 4);
          assert.equal(
            rows.find((i) => i.message === "Repeated SDK verification")?.count,
            5,
          );
          const details = await db.event.findMany({
            where: { projectId: p.id, environment: "demo-test" },
          });
          assert.equal(details.length, 7);
          assert.ok(
            details.every(
              (e) =>
                e.release === "verification-1" &&
                Array.isArray(e.breadcrumbs) &&
                e.breadcrumbs.length === 1,
            ),
          );
          assert.ok(!JSON.stringify(details).includes("should-not-be-stored"));
          assert.ok(details.some((e) => e.name === "UnhandledRejection"));
          assert.ok(
            details.some(
              (e) => e.message === "Window listener verification" && e.stack,
            ),
          );
        } finally {
          BugRadar.destroy();
          globalThis.fetch = nativeFetch;
          if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
          else Reflect.deleteProperty(globalThis, "window");
          dom.window.close();
        }
      },
    );
    await ok(
      "owner-scoped lists, cache headers, CORS and malformed JSON",
      async () => {
        for (const path of ["/projects", "/issues", "/overview"]) {
          const r = await request(path, "GET", undefined, b.cookie);
          assert.equal(r.status, 200);
          assert.equal(r.headers.get("cache-control"), "no-store");
          const value = await r.json();
          if (path === "/projects") assert.equal(value.length, 0);
          else if (path === "/issues") assert.equal(value.total, 0);
          else assert.equal(value.events, 0);
        }
        const cors = await request(
          "/auth/me",
          "GET",
          undefined,
          a.cookie,
          "https://evil.test",
        );
        assert.equal(cors.headers.get("access-control-allow-origin"), null);
        const r = await fetch(base + "/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: origin },
          body: "{bad json",
        });
        assert.equal(r.status, 400);
      },
    );
    await ok(
      "editing the origin allowlist takes effect immediately",
      async () => {
        const p = await (
          await request(
            "/projects",
            "POST",
            { name: "Origin edit verification", origins: [origin] },
            a.cookie,
          )
        ).json();
        assert.equal(
          (
            await request(
              `/projects/${p.id}`,
              "PATCH",
              { name: p.name, origins: ["https://allowed.example.test"] },
              a.cookie,
            )
          ).status,
          200,
        );
        assert.equal((await send(p.key, payload(), origin)).status, 403);
        assert.equal(
          (await send(p.key, payload(), "https://allowed.example.test")).status,
          202,
        );
      },
    );
    await ok(
      "concurrent replay does not reopen; fresh concurrent occurrences reopen exactly once",
      async () => {
        const p = await (
          await request(
            "/projects",
            "POST",
            { name: "Concurrent reopen verification", origins: [origin] },
            a.cookie,
          )
        ).json();
        const first = payload();
        assert.equal((await send(p.key, first)).status, 202);
        const i = await db.issue.findFirstOrThrow({
          where: { projectId: p.id },
        });
        assert.equal(
          (
            await request(
              `/issues/${i.id}/status`,
              "PATCH",
              { status: "RESOLVED" },
              a.cookie,
            )
          ).status,
          200,
        );
        const duplicates = await Promise.all(
          Array.from({ length: 20 }, () => send(p.key, first)),
        );
        for (const r of duplicates) assert.equal(r.status, 202);
        let stored = await db.issue.findUniqueOrThrow({ where: { id: i.id } });
        assert.equal(stored.status, "RESOLVED");
        assert.equal(stored.count, 1);
        const fresh = await Promise.all(
          Array.from({ length: 20 }, () => send(p.key, payload())),
        );
        for (const r of fresh) assert.equal(r.status, 202);
        stored = await db.issue.findUniqueOrThrow({ where: { id: i.id } });
        assert.equal(stored.status, "OPEN");
        assert.equal(stored.count, 21);
        assert.equal(await db.event.count({ where: { issueId: i.id } }), 21);
        assert.equal(await db.issue.count({ where: { projectId: p.id } }), 1);
        assert.equal(
          await db.activity.count({
            where: { issueId: i.id, from: "RESOLVED", to: "OPEN" },
          }),
          1,
        );
      },
    );
    await ok(
      "per-project admission limits aggregate different client identities",
      async () => {
        const p = await (
          await request(
            "/projects",
            "POST",
            { name: "Project quota verification", origins: [origin] },
            a.cookie,
          )
        ).json();
        const { ingest } = await import("../src/ingest");
        const { db: serviceDb } = await import("../src/db");
        const duplicate = payload();
        try {
          // Exercise real ingestion/database transactions at the service boundary.
          // Distinct client identities avoid the separately HTTP-tested IP ceiling.
          for (let start = 0; start < 600; start += 20)
            await Promise.all(
              Array.from({ length: 20 }, (_, n) =>
                ingest(
                  p.key,
                  origin,
                  duplicate,
                  `quota-${p.id}-${(start + n) % 3}`,
                ),
              ),
            );
          await assert.rejects(
            () => ingest(p.key, origin, duplicate, `quota-${p.id}-fresh`),
            (error: any) => error.getStatus() === 429,
          );
          assert.equal(await db.event.count({ where: { projectId: p.id } }), 1);
          assert.equal(
            (await db.issue.findFirstOrThrow({ where: { projectId: p.id } }))
              .count,
            1,
          );
        } finally {
          await serviceDb.$disconnect();
        }
      },
    );
    await ok("logout invalidates the stored session", async () => {
      assert.equal(
        (await request("/auth/logout", "POST", {}, a.cookie)).status,
        200,
      );
      assert.equal(
        (await request("/auth/me", "GET", undefined, a.cookie)).status,
        401,
      );
    });
    await ok(
      "HTTP authentication and ingestion IP limits cannot be bypassed with forwarded headers",
      async () => {
        let authLimited = false;
        for (let n = 0; n < 11; n++) {
          const r = await request("/auth/login", "POST", {
            email: a.email,
            password: "incorrect-password",
          });
          if (r.status === 429) {
            authLimited = true;
            break;
          }
          assert.equal(r.status, 401);
        }
        assert.ok(authLimited);
        let limited = false;
        for (let n = 0; n < 301; n++) {
          const r = await fetch(base + "/ingest", {
            method: "POST",
            headers: {
              Origin: origin,
              "Content-Type": "application/json",
              "X-BugRadar-Key": "br_" + "0".repeat(64),
              "X-Forwarded-For": `192.0.2.${n % 255}`,
            },
            body: n % 2 === 0 ? "{bad json" : JSON.stringify(payload()),
          });
          if (r.status === 429) {
            limited = true;
            break;
          }
          assert.equal(r.status, n % 2 === 0 ? 400 : 401);
        }
        assert.ok(limited);
      },
    );
    console.log(`\n${checks} PostgreSQL integration scenarios passed.`);
  } finally {
    if (process.env.KEEP_TEST_DATA === "1")
      console.log("Retained test accounts:", emails.join(", "));
    else await db.user.deleteMany({ where: { email: { in: emails } } });
    await db.$disconnect();
    child.kill();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
