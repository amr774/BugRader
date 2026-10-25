import { createHash } from "node:crypto";
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function cleanUrl(value: string): string {
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
export function redact(value: string): string {
  return value
    .replace(/https?:\/\/[^\s<>"']+/gi, (u) => cleanUrl(u))
    .replace(/\bBearer\s+[\w.~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(
      /(["']?\b(?:password|passwd|secret|token|api[_-]?key|authorization|cookie|access_token|refresh_token)\b["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;&}]+)/gi,
      "$1[REDACTED]",
    );
}
export function fingerprint(name: string, message: string, stack = "") {
  // Preserve message values: IDs in messages may carry semantic meaning.
  const frames = stack
    .split("\n")
    .filter((l) => /^\s*at\s|@.*:\d/.test(l))
    .slice(0, 8)
    .map((l) =>
      redact(l)
        .replace(/:\d+(?::\d+)?(?=\)?\s*$)/g, "")
        .trim(),
    );
  return hash(
    JSON.stringify([name, message.trim().replace(/\s+/g, " "), frames]),
  );
}
