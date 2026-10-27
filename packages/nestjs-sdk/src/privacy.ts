export function sanitizeUrl(value: string) {
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
export function redact(value: string) {
  return (
    value
      .replace(/https?:\/\/[^\s<>"']+/gi, sanitizeUrl)
      .replace(/\b(Bearer|Basic)\s+[\w.~+\/-]+=*/gi, "$1 [REDACTED]")
      // Header lines can contain multiple cookie pairs; redact the whole value.
      .replace(
        /(^|\n)([ \t]*(?:authorization|proxy-authorization|cookie|set-cookie)[ \t]*:[ \t]*)[^\r\n]*/gi,
        "$1$2[REDACTED]",
      )
      .replace(/\bbrs_[a-f0-9]{64}\b/gi, "[REDACTED]")
      .replace(
        /(["']?\b(?:password|passwd|secret|token|api[_-]?key|authorization|cookie|access_token|refresh_token)\b["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|[^\s,;&}]+)/gi,
        "$1[REDACTED]",
      )
  );
}
export function serialize(value: unknown): string {
  try {
    const seen = new WeakSet<object>();
    const walk = (v: unknown, depth: number): unknown => {
      if (typeof v === "string") return redact(v).slice(0, 1000);
      if (v === null || typeof v === "boolean" || typeof v === "number")
        return v;
      if (typeof v !== "object") return String(v).slice(0, 200);
      if (seen.has(v)) return "[Circular]";
      if (depth >= 3) return "[Max depth]";
      seen.add(v);
      if (Array.isArray(v))
        return v.slice(0, 10).map((x) => walk(x, depth + 1));
      return Object.fromEntries(
        Object.keys(v)
          .slice(0, 20)
          .map((k) => [
            k,
            /password|passwd|secret|token|api.?key|authorization|cookie/i.test(
              k,
            )
              ? "[REDACTED]"
              : walk((v as Record<string, unknown>)[k], depth + 1),
          ]),
      );
    };
    return (
      typeof value === "string" ? redact(value) : JSON.stringify(walk(value, 0))
    ).slice(0, 2000);
  } catch {
    return "[Unserializable value]";
  }
}
