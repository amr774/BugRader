import { z } from "zod";
export const origin = z
  .string()
  .max(300)
  .refine((s) => {
    try {
      const u = new URL(s);
      return (
        ["http:", "https:"].includes(u.protocol) &&
        u.origin === s &&
        !s.includes("*")
      );
    } catch {
      return false;
    }
  }, "Use an exact HTTP(S) origin without a trailing slash or wildcard");
export const projectInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    origins: z.array(origin).min(1).max(20),
  })
  .strict();
export const credentials = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    password: z.string().min(12).max(128),
  })
  .strict();
export const eventInput = z
  .object({
    eventId: z.string().uuid(),
    name: z.string().min(1).max(160),
    message: z.string().min(1).max(2000),
    stack: z.string().max(12000).optional(),
    url: z.string().max(2000).optional(),
    environment: z.string().min(1).max(64).default("production"),
    release: z.string().max(100).optional(),
    sdkVersion: z.string().max(40),
    clientTimestamp: z.string().max(64).optional(),
    userAgent: z.string().max(1000).optional(),
    breadcrumbs: z
      .array(
        z
          .object({
            category: z.string().max(80),
            message: z.string().max(500),
            timestamp: z.string().max(64).optional(),
          })
          .strict(),
      )
      .max(30)
      .default([]),
  })
  .strict();
export const statusInput = z
  .object({ status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "IGNORED"]) })
  .strict();
export const listInput = z
  .object({
    projectId: z.string().uuid().optional(),
    status: statusInput.shape.status.optional(),
    environment: z.string().max(64).optional(),
    search: z.string().max(200).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    sort: z.enum(["lastSeen", "count"]).default("lastSeen"),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()
  .refine(
    (v) => !v.from || !v.to || v.from <= v.to,
    "Start date must precede end date",
  );
