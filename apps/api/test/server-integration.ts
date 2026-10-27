import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import { BugRadarService } from "@bugradar/nestjs-sdk";
const base = "http://127.0.0.1:3098",
  demo = "http://127.0.0.1:3012",
  origin = "http://localhost:5173";
const db = new PrismaClient();
const children: ReturnType<typeof spawn>[] = [];
const createdUserIds: string[] = [];
let checks = 0;
function start(file: string, env: Record<string, string>) {
  const child = spawn(process.execPath, [file], {
    env: { ...process.env, ...env },
    stdio: "ignore",
    windowsHide: true,
  });
  children.push(child);
  return child;
}
async function ready(url: string) {
  for (let n = 0; n < 80; n++) {
    try {
      if ((await fetch(url + "/health")).ok) return;
    } catch {}
    await delay(200);
  }
  throw Error("Startup failed: " + url);
}
async function check(name: string, run: () => Promise<void>) {
  await run();
  checks++;
  console.log("PASS " + name);
}
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  cookie?: string,
) {
  return fetch(base + path, {
    method,
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const payload = () => ({
  eventId: randomUUID(),
  name: "ServerTestError",
  message: "Test service failure",
  stack:
    "ServerTestError: Test service failure\n at checkout (/srv/cart.js:42:9)",
  sdkVersion: "integration",
  environment: "test",
});
async function send(
  key: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return fetch(base + "/ingest/server", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BugRadar-Server-Key": key,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
async function until(run: () => Promise<boolean>) {
  for (let n = 0; n < 80; n++) {
    if (await run()) return;
    await delay(100);
  }
  throw Error("Expected database event not received");
}
async function main() {
  start("apps/api/dist/main.js", { PORT: "3098", FRONTEND_ORIGIN: origin });
  await ready(base);
  const email = `server-verification-${randomUUID()}@example.test`;
  const registration = await request("/auth/register", "POST", {
    email,
    password: "Integration-password-92!",
  });
  assert.equal(registration.status, 201);
  createdUserIds.push((await registration.json()).id);
  const cookie = registration.headers.get("set-cookie")!.split(";")[0];
  const project = await (
    await request(
      "/projects",
      "POST",
      { name: "NestJS verification", origins: [origin] },
      cookie,
    )
  ).json();
  const second = await request("/auth/register", "POST", {
    email: `server-other-${randomUUID()}@example.test`,
    password: "Integration-password-92!",
  });
  assert.equal(second.status, 201);
  createdUserIds.push((await second.json()).id);
  const other = second.headers.get("set-cookie")!.split(";")[0];
  let key: string = "";
  let issueId = "";
  await check(
    "owner-only credential creation; database stores hash; no read response reveals credential",
    async () => {
      assert.equal(
        (
          await request(
            `/projects/${project.id}/rotate-server-key`,
            "POST",
            {},
            other,
          )
        ).status,
        404,
      );
      const created = await request(
        `/projects/${project.id}/rotate-server-key`,
        "POST",
        {},
        cookie,
      );
      assert.equal(created.status, 201);
      key = (await created.json()).serverKey;
      assert.match(key, /^brs_[a-f0-9]{64}$/);
      const stored = await db.project.findUniqueOrThrow({
        where: { id: project.id },
      });
      assert.notEqual(stored.serverKeyHash, key);
      assert.equal(stored.serverKeyHash?.length, 64);
      const read = await (
        await request(`/projects/${project.id}`, "GET", undefined, cookie)
      ).json();
      assert.equal(read.serverKey, undefined);
      assert.equal(read.serverKeyHash, undefined);
      for (const path of [
        "/projects",
        `/projects/${project.id}`,
        "/issues",
        "/overview",
      ])
        assert.equal(
          (
            await fetch(base + path, {
              headers: { "X-BugRadar-Server-Key": key },
            })
          ).status,
          401,
        );
    },
  );
  await check(
    "valid/invalid credentials, dedicated header, browser origin security unchanged",
    async () => {
      assert.equal((await send("invalid", payload())).status, 401);
      assert.equal((await send(project.key, payload())).status, 401);
      assert.equal(
        (await send(key, payload(), { Origin: origin })).status,
        403,
      );
      assert.equal(
        (
          await fetch(base + "/ingest/server?key=" + key, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload()),
          })
        ).status,
        401,
      );
      for (const supplied of [undefined, "https://evil.test"])
        assert.equal(
          (
            await fetch(base + "/ingest", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-BugRadar-Key": project.key,
                ...(supplied ? { Origin: supplied } : {}),
              },
              body: JSON.stringify(payload()),
            })
          ).status,
          403,
        );
      assert.equal(
        (
          await fetch(base + "/ingest", {
            method: "POST",
            headers: {
              Origin: origin,
              "Content-Type": "application/json",
              "X-BugRadar-Key": key,
            },
            body: JSON.stringify(payload()),
          })
        ).status,
        401,
      );
    },
  );
  await check(
    "simultaneous server events group atomically and retries do not inflate counts",
    async () => {
      const same = payload();
      const responses = await Promise.all([
        ...Array.from({ length: 12 }, () => send(key, same)),
        ...Array.from({ length: 10 }, () => send(key, payload())),
      ]);
      responses.forEach((r) => assert.equal(r.status, 202));
      const issues = await db.issue.findMany({
        where: { projectId: project.id },
      });
      assert.equal(issues.length, 1);
      assert.equal(issues[0].count, 11);
      issueId = issues[0].id;
      assert.equal(
        await db.event.count({ where: { projectId: project.id } }),
        11,
      );
    },
  );
  await check(
    "browser and server fingerprints remain separate with identical error content",
    async () => {
      assert.equal(
        (
          await fetch(base + "/ingest", {
            method: "POST",
            headers: {
              Origin: origin,
              "Content-Type": "application/json",
              "X-BugRadar-Key": project.key,
            },
            body: JSON.stringify(payload()),
          })
        ).status,
        202,
      );
      const issues = await db.issue.findMany({
        where: { projectId: project.id },
      });
      assert.deepEqual(issues.map((i) => i.source).sort(), [
        "BROWSER",
        "SERVER",
      ]);
    },
  );
  await check(
    "resolved server issues reopen; ignored issues stay ignored",
    async () => {
      assert.equal(
        (
          await request(
            `/issues/${issueId}/status`,
            "PATCH",
            { status: "RESOLVED" },
            cookie,
          )
        ).status,
        200,
      );
      await send(key, payload());
      assert.equal(
        (await db.issue.findUniqueOrThrow({ where: { id: issueId } })).status,
        "OPEN",
      );
      await request(
        `/issues/${issueId}/status`,
        "PATCH",
        { status: "IGNORED" },
        cookie,
      );
      await send(key, payload());
      assert.equal(
        (await db.issue.findUniqueOrThrow({ where: { id: issueId } })).status,
        "IGNORED",
      );
    },
  );
  await check(
    "strict schema, payload limit, and server-side secret redaction",
    async () => {
      const invalid = await send(key, {
        ...payload(),
        body: { secret: "private" },
      });
      assert.equal(invalid.status, 400);
      assert.equal((await invalid.json()).code, "INVALID_INPUT");
      assert.equal(
        (await send(key, { ...payload(), message: "x".repeat(40000) })).status,
        413,
      );
      const p = {
        ...payload(),
        message: 'password="hidden-secret" Bearer private-token',
        routeTemplate: "/items/:id?token=hidden-query",
      };
      assert.equal((await send(key, p)).status, 202);
      const event = await db.event.findUniqueOrThrow({
        where: {
          projectId_eventId: { projectId: project.id, eventId: p.eventId },
        },
      });
      assert.ok(!JSON.stringify(event).includes("hidden-"));
      assert.ok(!event.message.includes("private-token"));
      assert.equal(event.routeTemplate, "/items/:id");
    },
  );
  await check(
    "real NestJS demo preserves HTTP responses; 4xx excluded, 5xx captured with minimal context",
    async () => {
      start("apps/nest-demo/dist/main.js", {
        PORT: "3012",
        BUGRADAR_ENDPOINT: base + "/ingest/server",
        BUGRADAR_SERVER_KEY: key,
        NODE_ENV: "development",
      });
      await ready(demo);
      const before = await db.event.count({ where: { projectId: project.id } });
      const bad = await fetch(demo + "/bad-request");
      assert.equal(bad.status, 400);
      assert.deepEqual(await bad.json(), {
        message: "Intentional 400",
        custom: "preserved",
      });
      await delay(350);
      assert.equal(
        await db.event.count({ where: { projectId: project.id } }),
        before,
      );
      const fail = await fetch(demo + "/error?token=do-not-store", {
        headers: {
          Authorization: "Bearer do-not-store",
          Cookie: "session=do-not-store",
        },
      });
      assert.equal(fail.status, 500);
      assert.deepEqual(await fail.json(), {
        statusCode: 500,
        message: "Internal server error",
      });
      const http = await fetch(demo + "/http-error");
      assert.equal(http.status, 503);
      assert.deepEqual(await http.json(), {
        message: "Intentional 503",
        custom: "preserved",
      });
      await until(
        async () =>
          (await db.event.count({ where: { projectId: project.id } })) ===
          before + 2,
      );
      const events = await db.event.findMany({
        where: { projectId: project.id, sdkVersion: "nestjs-0.1.0" },
      });
      assert.equal(events.length, 2);
      assert.ok(!JSON.stringify(events).includes("do-not-store"));
      for (const event of events) {
        assert.equal(event.requestMethod, "GET");
        assert.equal(event.source, "SERVER");
        assert.ok(event.clientTimestamp);
        assert.equal(event.url, null);
        assert.deepEqual(event.breadcrumbs, []);
      }
      assert.deepEqual(events.map((e) => e.routeTemplate).sort(), [
        "/error",
        "/http-error",
      ]);
      const event = events.find((e) => e.routeTemplate === "/error")!;
      await request(
        `/issues/${event.issueId}/status`,
        "PATCH",
        { status: "RESOLVED" },
        cookie,
      );
      await fetch(demo + "/error");
      await until(
        async () =>
          (await db.issue.findUniqueOrThrow({ where: { id: event.issueId } }))
            .count === 2,
      );
      assert.equal(
        (await db.issue.findUniqueOrThrow({ where: { id: event.issueId } }))
          .status,
        "OPEN",
      );
      const list = await (
        await request(
          `/issues?projectId=${project.id}`,
          "GET",
          undefined,
          cookie,
        )
      ).json();
      assert.ok(
        list.items.some(
          (i: any) => i.id === event.issueId && i.source === "SERVER",
        ),
      );
      const detail = await (
        await request(
          `/issues/${event.issueId}/events`,
          "GET",
          undefined,
          cookie,
        )
      ).json();
      assert.equal(detail.items[0].routeTemplate, "/error");
    },
  );
  await check(
    "actual server SDK retries a lost committed response with same event ID",
    async () => {
      const realFetch = globalThis.fetch;
      let attempts = 0;
      const ids: string[] = [];
      globalThis.fetch = async (input, init) => {
        ids.push(JSON.parse(String(init?.body)).eventId);
        const response = await realFetch(input, init);
        attempts++;
        if (attempts === 1)
          throw Error("Simulated response loss after real commit");
        return response;
      };
      const sdk = new BugRadarService({
        endpoint: base + "/ingest/server",
        serverKey: key,
      });
      try {
        const error = new Error("Lost response scenario");
        sdk.captureException(error);
        sdk.captureException(error);
        await until(async () => attempts === 2);
        assert.equal(new Set(ids).size, 1);
        assert.equal(
          await db.event.count({
            where: { projectId: project.id, eventId: ids[0] },
          }),
          1,
        );
        const row = await db.event.findFirstOrThrow({
          where: { projectId: project.id, eventId: ids[0] },
          include: { issue: true },
        });
        assert.equal(row.issue.count, 1);
      } finally {
        sdk.onModuleDestroy();
        globalThis.fetch = realFetch;
      }
    },
  );
  await check(
    "rotation rejects old credential, new credential works, browser credential unaffected",
    async () => {
      const old = key;
      key = (
        await (
          await request(
            `/projects/${project.id}/rotate-server-key`,
            "POST",
            {},
            cookie,
          )
        ).json()
      ).serverKey;
      assert.equal((await send(old, payload())).status, 401);
      assert.equal((await send(key, payload())).status, 202);
      assert.equal(
        (
          await fetch(base + "/ingest", {
            method: "POST",
            headers: {
              Origin: origin,
              "Content-Type": "application/json",
              "X-BugRadar-Key": project.key,
            },
            body: JSON.stringify(payload()),
          })
        ).status,
        202,
      );
    },
  );
  await check(
    "server ingestion is rate limited, including malformed payloads before parsing",
    async () => {
      let limited = false;
      for (let n = 0; n < 310; n++) {
        const r = await send(key, {});
        if (r.status === 429) {
          assert.equal((await r.json()).code, "RATE_LIMITED");
          limited = true;
          break;
        }
        assert.equal(r.status, 400);
      }
      assert.ok(limited);
    },
  );
  console.log(
    `${checks} real PostgreSQL/NestJS server scenarios passed. Verification accounts isolated; existing data untouched.`,
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    children.forEach((c) => c.kill());
    if (process.env.KEEP_TEST_DATA !== "1") {
      await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
      console.log("Cleaned up only accounts created by this run.");
    }
    await db.$disconnect();
  });
