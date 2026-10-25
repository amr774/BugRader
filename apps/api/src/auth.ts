import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { UnauthorizedException, HttpException } from "@nestjs/common";
import type { Request, Response } from "express";
import { db } from "./db";
import { hash } from "./privacy";
const scrypt = promisify(scryptCallback);
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}
export async function passwordMatches(password: string, stored: string) {
  const [salt, hex] = stored.split(":");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return timingSafeEqual(key, Buffer.from(hex, "hex"));
}
export const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
});
export async function startSession(userId: string, res: Response) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 86400000);
  await db.session.create({ data: { hash: hash(token), userId, expiresAt } });
  res.cookie("br_session", token, { ...cookieOptions(), expires: expiresAt });
}
export async function userId(req: Request) {
  const token = req.cookies?.br_session;
  if (typeof token !== "string") throw new UnauthorizedException();
  const session = await db.session.findUnique({ where: { hash: hash(token) } });
  if (!session || session.expiresAt <= new Date())
    throw new UnauthorizedException();
  return session.userId;
}
// Single-process fixed windows; bounded memory. Do not trust forwarded IP headers.
const buckets = new Map<string, { count: number; until: number }>();
export function rateLimit(key: string, max: number, ms = 60000) {
  const now = Date.now();
  if (buckets.size > 10000)
    for (const [k, v] of buckets) if (v.until <= now) buckets.delete(k);
  const v = buckets.get(key);
  if (v && v.until > now) {
    if (v.count >= max)
      throw new HttpException("Rate limit exceeded; retry later", 429);
    v.count++;
  } else {
    if (buckets.size >= 20000)
      throw new HttpException("Server busy; retry later", 429);
    buckets.set(key, { count: 1, until: now + ms });
  }
}
