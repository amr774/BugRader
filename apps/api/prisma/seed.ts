import { randomBytes, randomUUID } from "node:crypto";
import { db } from "../src/db";
import { passwordHash } from "../src/auth";
import { hash } from "../src/privacy";
import { ingest } from "../src/ingest";
async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Demo seed is disabled in production");
  const email = process.env.DEMO_EMAIL;
  const password = process.env.DEMO_PASSWORD;
  if (
    !email ||
    !password ||
    password.length < 12 ||
    password.startsWith("CHANGE_ME")
  )
    throw new Error(
      "Set DEMO_EMAIL and a unique DEMO_PASSWORD (12+ characters) in apps/api/.env",
    );
  if (await db.user.findUnique({ where: { email } }))
    throw new Error(
      "Demo email already exists; refusing to modify an existing account",
    );
  const user = await db.user.create({
    data: { email, password: await passwordHash(password) },
  });
  const origin = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
  const key = "br_" + randomBytes(32).toString("hex");
  const project = await db.project.create({
    data: {
      name: "Storefront · demo",
      userId: user.id,
      origins: [origin],
      keyHash: hash(key),
      keyPrefix: key.slice(0, 11),
    },
  });
  const examples = [
    [
      "TypeError",
      "Cannot read properties of undefined (reading 'cart')",
      "checkout",
      8,
    ],
    ["NetworkError", "Catalog request timed out", "catalog", 5],
    ["ReferenceError", "paymentProvider is not defined", "payment", 3],
    ["ValidationError", "Shipping address is incomplete", "shipping", 2],
  ] as const;
  for (const [name, message, frame, count] of examples)
    for (let n = 0; n < count; n++)
      await ingest(
        key,
        origin,
        {
          eventId: randomUUID(),
          name,
          message,
          stack: `${name}: ${message}\n    at ${frame} (https://demo.bugradar.test/assets/app.js:214:18)`,
          url: `https://demo.bugradar.test/${frame}`,
          environment: n % 3 === 0 ? "staging" : "production",
          release: "storefront-2.4.1",
          sdkVersion: "demo-seed",
          clientTimestamp: new Date().toISOString(),
          userAgent: "BugRadar explicit development seed",
          breadcrumbs: [
            { category: "navigation", message: `Opened /${frame}` },
            { category: "action", message: "Submitted demo order" },
          ],
        },
        "seed",
      );
  const issue = await db.issue.findFirstOrThrow({
    where: { projectId: project.id, name: "ValidationError" },
  });
  await db.$transaction([
    db.issue.update({ where: { id: issue.id }, data: { status: "RESOLVED" } }),
    db.activity.create({
      data: {
        issueId: issue.id,
        from: "OPEN",
        to: "RESOLVED",
        reason: "Resolved in explicit demo seed",
      },
    }),
  ]);
  console.log(
    `Demo created for ${email}. Sign in with the password you configured. Rotate the project's key to use the playground.`,
  );
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
