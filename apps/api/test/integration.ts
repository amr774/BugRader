import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
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
    console.log(`\n${checks} PostgreSQL integration scenarios passed.`);
  } finally {
    await db.user.deleteMany({ where: { email: { in: emails } } });
    await db.$disconnect();
    child.kill();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
