import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { cleanUrl, fingerprint, hash, redact } from "./privacy";
import { eventInput, serverEventInput } from "./validation";
import { rateLimit } from "./auth";
export async function ingest(
  key: string,
  origin: string | undefined,
  body: unknown,
  ip: string,
  source: "BROWSER" | "SERVER" = "BROWSER",
) {
  rateLimit(`ip:${ip}`, 300);
  const serverRaw =
    source === "SERVER" ? serverEventInput.parse(body) : undefined;
  const raw = serverRaw
    ? { ...serverRaw, breadcrumbs: [], url: undefined, userAgent: undefined }
    : eventInput.parse(body);
  if (
    !(source === "SERVER" ? /^brs_[a-f0-9]{64}$/ : /^br_[a-f0-9]{64}$/).test(
      key,
    )
  )
    throw new UnauthorizedException("Invalid ingestion key");
  const keyHash = hash(key);
  const project = await db.project.findUnique({
    where: source === "SERVER" ? { serverKeyHash: keyHash } : { keyHash },
  });
  if (!project) throw new UnauthorizedException("Invalid ingestion key");
  if (source === "BROWSER" && (!origin || !project.origins.includes(origin)))
    throw new ForbiddenException("Origin not allowed");
  rateLimit(`project:${project.id}`, 600);
  const data = {
    ...raw,
    source,
    ...(serverRaw
      ? {
          requestMethod: serverRaw.requestMethod,
          routeTemplate: serverRaw.routeTemplate
            ? redact(serverRaw.routeTemplate.split(/[?#]/)[0])
            : undefined,
        }
      : {}),
    name: redact(raw.name),
    message: redact(raw.message),
    stack: raw.stack ? redact(raw.stack) : undefined,
    url: raw.url ? cleanUrl(raw.url) : undefined,
    environment: redact(raw.environment),
    release: raw.release ? redact(raw.release) : undefined,
    sdkVersion: redact(raw.sdkVersion),
    clientTimestamp: raw.clientTimestamp
      ? redact(raw.clientTimestamp)
      : undefined,
    userAgent: raw.userAgent ? redact(raw.userAgent) : undefined,
    breadcrumbs: raw.breadcrumbs.map((b) => ({
      category: redact(b.category),
      message: redact(b.message),
      ...(b.timestamp ? { timestamp: redact(b.timestamp) } : {}),
    })),
  };
  const baseFingerprint = fingerprint(data.name, data.message, data.stack);
  const fp =
    source === "SERVER" ? hash("SERVER:" + baseFingerprint) : baseFingerprint;
  await db.$transaction(
    async (tx) => {
      // Serializes ingestion per project, including key rotation and allowlist edits.
      const locked = await tx.$queryRaw<
        { keyHash: string; serverKeyHash: string | null; origins: string[] }[]
      >(
        Prisma.sql`SELECT "keyHash", "serverKeyHash", origins FROM "Project" WHERE id=${project.id} FOR UPDATE`,
      );
      if (
        !locked[0] ||
        (source === "SERVER" ? locked[0].serverKeyHash : locked[0].keyHash) !==
          keyHash
      )
        throw new UnauthorizedException("Invalid ingestion key");
      if (
        source === "BROWSER" &&
        (!origin || !locked[0].origins.includes(origin))
      )
        throw new ForbiddenException("Origin not allowed");
      if (
        await tx.event.findUnique({
          where: {
            projectId_eventId: { projectId: project.id, eventId: data.eventId },
          },
        })
      )
        return;
      const now = new Date();
      let issue = await tx.issue.findUnique({
        where: {
          projectId_fingerprint: { projectId: project.id, fingerprint: fp },
        },
      });
      if (issue) {
        // Lock against simultaneous status updates before deciding whether to reopen.
        const rows = await tx.$queryRaw<{ status: string }[]>(
          Prisma.sql`SELECT status FROM "Issue" WHERE id=${issue.id} FOR UPDATE`,
        );
        const reopen = rows[0].status === "RESOLVED";
        issue = await tx.issue.update({
          where: { id: issue.id },
          data: {
            count: { increment: 1 },
            lastSeen: now,
            ...(reopen ? { status: "OPEN", reopenedAt: now } : {}),
          },
        });
        if (reopen)
          await tx.activity.create({
            data: {
              issueId: issue.id,
              from: "RESOLVED",
              to: "OPEN",
              reason: "New occurrence automatically reopened this issue",
            },
          });
      } else {
        issue = await tx.issue.create({
          data: {
            id: randomUUID(),
            projectId: project.id,
            fingerprint: fp,
            source,
            name: data.name,
            message: data.message,
            firstSeen: now,
            lastSeen: now,
          },
        });
        await tx.activity.create({
          data: {
            issueId: issue.id,
            to: "OPEN",
            reason: "First occurrence received",
          },
        });
      }
      await tx.event.create({
        data: {
          ...data,
          projectId: project.id,
          issueId: issue.id,
          receivedAt: now,
        },
      });
    },
    { maxWait: 10000, timeout: 15000 },
  );
  // Deliberately identical for new events and retries. No project/event details.
  return { accepted: true };
}
