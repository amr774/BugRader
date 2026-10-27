import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { db } from "./db";
import {
  cookieOptions,
  passwordHash,
  passwordMatches,
  rateLimit,
  startSession,
  userId,
} from "./auth";
import { hash } from "./privacy";
import {
  credentials,
  listInput,
  projectInput,
  statusInput,
} from "./validation";
import { ingest } from "./ingest";
const publicProject = {
  id: true,
  name: true,
  origins: true,
  keyPrefix: true,
  serverKeyPrefix: true,
  createdAt: true,
} as const;
const newKey = () => "br_" + randomBytes(32).toString("hex");
async function ownedProject(id: string, owner: string) {
  const p = await db.project.findFirst({
    where: { id, userId: owner },
    select: publicProject,
  });
  if (!p) throw new NotFoundException();
  return p;
}
async function ownedIssue(id: string, owner: string) {
  const i = await db.issue.findFirst({
    where: { id, project: { userId: owner } },
    include: { project: { select: { id: true, name: true } } },
  });
  if (!i) throw new NotFoundException();
  return i;
}
@Controller()
export class ApiController {
  @Get("health") async health() {
    await db.$queryRaw`SELECT 1`;
    return { status: "ok" };
  }
  @Post("auth/register") async register(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    rateLimit(`auth:${req.ip}`, 10, 15 * 60000);
    const input = credentials.parse(body);
    try {
      const u = await db.user.create({
        data: {
          email: input.email,
          password: await passwordHash(input.password),
        },
      });
      await startSession(u.id, res);
      return { id: u.id, email: u.email };
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      )
        throw new ConflictException("Unable to register this email");
      throw e;
    }
  }
  @Post("auth/login") @HttpCode(200) async login(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    rateLimit(`auth:${req.ip}`, 10, 15 * 60000);
    const input = credentials.parse(body);
    const u = await db.user.findUnique({ where: { email: input.email } });
    const valid = await passwordMatches(
      input.password,
      u?.password ?? `${"0".repeat(32)}:${"0".repeat(128)}`,
    );
    if (!u || !valid)
      throw new UnauthorizedException("Invalid email or password");
    await startSession(u.id, res);
    return { id: u.id, email: u.email };
  }
  @Post("auth/logout") @HttpCode(200) async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (typeof req.cookies?.br_session === "string")
      await db.session.deleteMany({
        where: { hash: hash(req.cookies.br_session) },
      });
    res.clearCookie("br_session", cookieOptions());
    return { ok: true };
  }
  @Get("auth/me") async me(@Req() req: Request) {
    return db.user.findUniqueOrThrow({
      where: { id: await userId(req) },
      select: { id: true, email: true },
    });
  }
  @Get("projects") async projects(@Req() req: Request) {
    return db.project.findMany({
      where: { userId: await userId(req) },
      select: {
        ...publicProject,
        _count: { select: { issues: true, events: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }
  @Post("projects") async createProject(
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const owner = await userId(req);
    const input = projectInput.parse(body);
    const key = newKey();
    const project = await db.project.create({
      data: {
        ...input,
        userId: owner,
        keyHash: hash(key),
        keyPrefix: key.slice(0, 11),
      },
      select: publicProject,
    });
    return { ...project, key };
  }
  @Get("projects/:id") async project(
    @Param("id") id: string,
    @Req() req: Request,
  ) {
    return ownedProject(id, await userId(req));
  }
  @Patch("projects/:id") async editProject(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const owner = await userId(req);
    const input = projectInput.parse(body);
    await ownedProject(id, owner);
    return db.project.update({
      where: { id, userId: owner },
      data: input,
      select: publicProject,
    });
  }
  @Delete("projects/:id") async deleteProject(
    @Param("id") id: string,
    @Req() req: Request,
  ) {
    const owner = await userId(req);
    await ownedProject(id, owner);
    await db.project.delete({ where: { id, userId: owner } });
    return { ok: true };
  }
  @Post("projects/:id/rotate-key") async rotate(
    @Param("id") id: string,
    @Req() req: Request,
  ) {
    const owner = await userId(req);
    await ownedProject(id, owner);
    const key = newKey();
    const project = await db.project.update({
      where: { id, userId: owner },
      data: { keyHash: hash(key), keyPrefix: key.slice(0, 11) },
      select: publicProject,
    });
    return { ...project, key };
  }
  @Post("ingest") @HttpCode(202) async receive(
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return ingest(
      String(req.headers["x-bugradar-key"] ?? ""),
      req.headers.origin,
      body,
      req.ip ?? "unknown",
    );
  }
  @Post("projects/:id/rotate-server-key") async rotateServer(
    @Param("id") id: string,
    @Req() req: Request,
  ) {
    const owner = await userId(req);
    await ownedProject(id, owner);
    const serverKey = "brs_" + randomBytes(32).toString("hex");
    const project = await db.project.update({
      where: { id, userId: owner },
      data: {
        serverKeyHash: hash(serverKey),
        serverKeyPrefix: serverKey.slice(0, 12),
      },
      select: publicProject,
    });
    return { ...project, serverKey };
  }
  @Post("ingest/server") @HttpCode(202) async receiveServer(
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    if (req.headers.origin !== undefined)
      throw new ForbiddenException(
        "Server ingestion does not accept browser origins",
      );
    return ingest(
      String(req.headers["x-bugradar-server-key"] ?? ""),
      undefined,
      body,
      req.ip ?? "unknown",
      "SERVER",
    );
  }
  @Get("overview") async overview(@Req() req: Request) {
    const owner = await userId(req);
    const where = { project: { userId: owner } };
    const [projects, issues, events, open, recent] = await Promise.all([
      db.project.count({ where: { userId: owner } }),
      db.issue.count({ where }),
      db.event.count({ where }),
      db.issue.count({
        where: { ...where, status: { in: ["OPEN", "IN_PROGRESS"] } },
      }),
      db.event.count({
        where: {
          ...where,
          receivedAt: { gte: new Date(Date.now() - 86400000) },
        },
      }),
    ]);
    return { projects, issues, events, open, recent };
  }
  @Get("issues") async issues(@Query() query: unknown, @Req() req: Request) {
    const owner = await userId(req);
    const q = listInput.parse(query);
    if (q.projectId) await ownedProject(q.projectId, owner);
    const filters = [Prisma.sql`p."userId"=${owner}`];
    if (q.projectId) filters.push(Prisma.sql`i."projectId"=${q.projectId}`);
    if (q.status) filters.push(Prisma.sql`i.status::text=${q.status}`);
    if (q.search)
      filters.push(Prisma.sql`strpos(lower(i.message), lower(${q.search}))>0`);
    if (q.environment) filters.push(Prisma.sql`e.environment=${q.environment}`);
    if (q.from) filters.push(Prisma.sql`e."receivedAt">=${new Date(q.from)}`);
    if (q.to) filters.push(Prisma.sql`e."receivedAt"<=${new Date(q.to)}`);
    const base = Prisma.sql`SELECT i.id,i.name,i.message,i.status,i.source,i."projectId",p.name AS "projectName",count(e.id)::int AS count,min(e."receivedAt") AS "firstSeen",max(e."receivedAt") AS "lastSeen",array_agg(DISTINCT e.environment) AS environments FROM "Issue" i JOIN "Project" p ON p.id=i."projectId" JOIN "Event" e ON e."issueId"=i.id WHERE ${Prisma.join(filters, " AND ")} GROUP BY i.id,p.name`;
    const order =
      q.sort === "count"
        ? Prisma.sql`count DESC,"lastSeen" DESC,id`
        : Prisma.sql`"lastSeen" DESC,id`;
    const [items, total] = await db.$transaction(
      [
        db.$queryRaw(
          Prisma.sql`${base} ORDER BY ${order} LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`,
        ),
        db.$queryRaw<{ count: number }[]>(
          Prisma.sql`SELECT count(*)::int AS count FROM (${base}) results`,
        ),
      ],
      { isolationLevel: "RepeatableRead" },
    );
    return { items, total: total[0].count, page: q.page, limit: q.limit };
  }
  @Get("issues/:id") async issue(@Param("id") id: string, @Req() req: Request) {
    return ownedIssue(id, await userId(req));
  }
  @Get("issues/:id/events") async events(
    @Param("id") id: string,
    @Query() query: unknown,
    @Req() req: Request,
  ) {
    const owner = await userId(req);
    await ownedIssue(id, owner);
    const q = listInput.parse(query);
    const where = {
      issueId: id,
      project: { userId: owner },
      ...(q.environment ? { environment: q.environment } : {}),
      receivedAt: {
        ...(q.from ? { gte: new Date(q.from) } : {}),
        ...(q.to ? { lte: new Date(q.to) } : {}),
      },
    };
    const [items, total, summary] = await db.$transaction(
      [
        db.event.findMany({
          where,
          orderBy: [{ receivedAt: "desc" }, { id: "asc" }],
          skip: (q.page - 1) * q.limit,
          take: q.limit,
        }),
        db.event.count({ where }),
        db.event.aggregate({
          where,
          _min: { receivedAt: true },
          _max: { receivedAt: true },
        }),
      ],
      { isolationLevel: "RepeatableRead" },
    );
    return {
      items,
      total,
      page: q.page,
      limit: q.limit,
      firstSeen: summary._min.receivedAt,
      lastSeen: summary._max.receivedAt,
    };
  }
  @Get("issues/:id/activity") async activity(
    @Param("id") id: string,
    @Query() query: unknown,
    @Req() req: Request,
  ) {
    const owner = await userId(req);
    await ownedIssue(id, owner);
    const q = listInput.parse(query);
    const where = { issueId: id, issue: { project: { userId: owner } } };
    const [items, total] = await db.$transaction(
      [
        db.activity.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          skip: (q.page - 1) * q.limit,
          take: q.limit,
        }),
        db.activity.count({ where }),
      ],
      { isolationLevel: "RepeatableRead" },
    );
    return { items, total, page: q.page, limit: q.limit };
  }
  @Patch("issues/:id/status") async status(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const owner = await userId(req);
    const { status } = statusInput.parse(body);
    await ownedIssue(id, owner);
    return db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "IGNORED" }[]
      >(
        Prisma.sql`SELECT i.status FROM "Issue" i JOIN "Project" p ON p.id=i."projectId" WHERE i.id=${id} AND p."userId"=${owner} FOR UPDATE OF i`,
      );
      if (!rows[0]) throw new NotFoundException();
      if (rows[0].status !== status)
        await tx.activity.create({
          data: {
            issueId: id,
            from: rows[0].status,
            to: status,
            reason: "Status changed by project owner",
          },
        });
      return tx.issue.update({ where: { id }, data: { status } });
    });
  }
}
