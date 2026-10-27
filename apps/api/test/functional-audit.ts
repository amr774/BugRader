import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient(),
  base = "http://127.0.0.1:3097",
  origin = "http://localhost:5173";
const ids: string[] = [];
let checks = 0;
const child = spawn(process.execPath, ["apps/api/dist/main.js"], {
  env: { ...process.env, PORT: "3097", FRONTEND_ORIGIN: origin },
  stdio: "ignore",
  windowsHide: true,
});
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
async function check(name: string, run: () => Promise<void>) {
  await run();
  checks++;
  console.log("PASS " + name);
}
async function main() {
  let ready = false;
  for (let n = 0; n < 80; n++) {
    try {
      if ((await fetch(base + "/health")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(200);
  }
  assert.ok(ready);
  const r = await request("/auth/register", "POST", {
    email: `audit-api-${randomUUID()}@example.test`,
    password: "Disposable-audit-password-92!",
  });
  assert.equal(r.status, 201);
  const user = await r.json();
  ids.push(user.id);
  const cookie = r.headers.get("set-cookie")!.split(";")[0];
  const project = await (
    await request(
      "/projects",
      "POST",
      { name: "Disposable audit", origins: [origin] },
      cookie,
    )
  ).json();
  const send = (message: string, extra: Record<string, unknown> = {}) =>
    fetch(base + "/ingest", {
      method: "POST",
      headers: {
        Origin: origin,
        "X-BugRadar-Key": project.key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        eventId: randomUUID(),
        name: "AuditError",
        message,
        environment: "production",
        sdkVersion: "audit",
        ...extra,
      }),
    });
  await check(
    "dashboard aggregates, literal/case-insensitive search, sort and distinct pagination",
    async () => {
      for (const message of [
        "Alpha checkout",
        "Alpha checkout",
        "Alpha checkout",
        "Beta inventory",
        "Gamma 100%",
      ])
        assert.equal((await send(message)).status, 202);
      const overview = await (
        await request("/overview", "GET", undefined, cookie)
      ).json();
      assert.deepEqual(overview, {
        projects: 1,
        issues: 3,
        events: 5,
        open: 3,
        recent: 5,
      });
      const page = await (
        await request("/issues?sort=count&limit=1", "GET", undefined, cookie)
      ).json();
      assert.equal(page.total, 3);
      assert.equal(page.items[0].message, "Alpha checkout");
      assert.equal(page.items[0].count, 3);
      const next = await (
        await request(
          "/issues?sort=count&limit=1&page=2",
          "GET",
          undefined,
          cookie,
        )
      ).json();
      assert.notEqual(next.items[0].id, page.items[0].id);
      for (const search of ["ALPHA", "100%"]) {
        const found = await (
          await request(
            "/issues?search=" + encodeURIComponent(search),
            "GET",
            undefined,
            cookie,
          )
        ).json();
        assert.equal(found.total, 1);
      }
      assert.equal(
        (
          await (
            await request(
              "/issues?search=does-not-exist",
              "GET",
              undefined,
              cookie,
            )
          ).json()
        ).total,
        0,
      );
      assert.equal(
        (
          await request(
            "/issues?from=2026-10-26T01:00:00Z&to=2026-10-26T00:00:00Z",
            "GET",
            undefined,
            cookie,
          )
        ).status,
        400,
      );
      const issue = page.items[0];
      await request(
        `/issues/${issue.id}/status`,
        "PATCH",
        { status: "IN_PROGRESS" },
        cookie,
      );
      assert.equal(
        (
          await (
            await request(
              "/issues?status=IN_PROGRESS",
              "GET",
              undefined,
              cookie,
            )
          ).json()
        ).total,
        1,
      );
    },
  );
  await check(
    "new redaction rules hold at the real ingestion/database boundary",
    async () => {
      const message =
        "Authorization: Basic dXNlcjpzZWNyZXQ=\nCookie: a=FIRST_SECRET; b=SECOND_SECRET\nFailed with brs_" +
        "a".repeat(64);
      await send(message);
      const events = await db.event.findMany({
        where: { projectId: project.id },
      });
      const stored = JSON.stringify(events);
      for (const secret of [
        "dXNlcjpzZWNyZXQ=",
        "FIRST_SECRET",
        "SECOND_SECRET",
        "brs_" + "a".repeat(64),
      ])
        assert.ok(!stored.includes(secret));
    },
  );
  await check(
    "activity pagination has deterministic ordering for equal timestamps",
    async () => {
      const issue = await db.issue.findFirstOrThrow({
        where: { projectId: project.id },
      });
      const activityIds = Array.from({ length: 6 }, () => randomUUID()).sort();
      await db.activity.createMany({
        data: [...activityIds]
          .reverse()
          .map((id) => ({
            id,
            issueId: issue.id,
            to: "OPEN",
            reason: "Audit ordering",
            createdAt: new Date(Date.now() + 10000),
          })),
      });
      const first = await (
        await request(
          `/issues/${issue.id}/activity?limit=3`,
          "GET",
          undefined,
          cookie,
        )
      ).json();
      const second = await (
        await request(
          `/issues/${issue.id}/activity?limit=3&page=2`,
          "GET",
          undefined,
          cookie,
        )
      ).json();
      assert.deepEqual(
        [...first.items, ...second.items].map((i: any) => i.id),
        activityIds,
      );
    },
  );
  await check(
    "project edit/delete cascades only its own records and revokes both credentials",
    async () => {
      const updated = await request(
        `/projects/${project.id}`,
        "PATCH",
        { name: "Audit edited", origins: [origin] },
        cookie,
      );
      assert.equal((await updated.json()).name, "Audit edited");
      const serverKey = (
        await (
          await request(
            `/projects/${project.id}/rotate-server-key`,
            "POST",
            {},
            cookie,
          )
        ).json()
      ).serverKey;
      const eventIds = (
        await db.event.findMany({
          where: { projectId: project.id },
          select: { id: true },
        })
      ).map((e) => e.id);
      const issueIds = (
        await db.issue.findMany({
          where: { projectId: project.id },
          select: { id: true },
        })
      ).map((i) => i.id);
      assert.equal(
        (await request(`/projects/${project.id}`, "DELETE", undefined, cookie))
          .status,
        200,
      );
      assert.equal(
        await db.event.count({ where: { id: { in: eventIds } } }),
        0,
      );
      assert.equal(
        await db.activity.count({ where: { issueId: { in: issueIds } } }),
        0,
      );
      assert.equal(
        await db.issue.count({ where: { id: { in: issueIds } } }),
        0,
      );
      assert.equal((await send("after deletion")).status, 401);
      assert.equal(
        (
          await fetch(base + "/ingest/server", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-BugRadar-Server-Key": serverKey,
            },
            body: JSON.stringify({
              eventId: randomUUID(),
              name: "Error",
              message: "x",
              sdkVersion: "audit",
            }),
          })
        ).status,
        401,
      );
    },
  );
  await check(
    "expired sessions reject every protected resource; logout clears the cookie",
    async () => {
      const hash = createHash("sha256")
        .update(cookie.slice(cookie.indexOf("=") + 1))
        .digest("hex");
      await db.session.update({
        where: { hash },
        data: { expiresAt: new Date(0) },
      });
      for (const path of ["/auth/me", "/projects", "/issues", "/overview"])
        assert.equal(
          (await request(path, "GET", undefined, cookie)).status,
          401,
        );
      const logout = await request("/auth/logout", "POST", {}, cookie);
      assert.equal(logout.status, 200);
      assert.match(logout.headers.get("set-cookie") ?? "", /1970/);
    },
  );
  console.log(`${checks} additional functional audit scenarios passed.`);
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    child.kill();
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
    console.log("Removed only this run’s disposable accounts.");
  });
