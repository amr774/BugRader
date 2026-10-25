import { describe, it, expect, vi } from "vitest";
import { rateLimit, passwordHash, passwordMatches } from "./auth";
describe("authentication and admission controls", () => {
  it("hashes with independent salts and verifies passwords", async () => {
    const a = await passwordHash("correct-long-password");
    const b = await passwordHash("correct-long-password");
    expect(a).not.toBe(b);
    expect(await passwordMatches("correct-long-password", a)).toBe(true);
    expect(await passwordMatches("incorrect-long-password", a)).toBe(false);
  });
  it("limits IPs and projects separately and resets expired windows", () => {
    vi.useFakeTimers();
    try {
      const prefix = crypto.randomUUID();
      rateLimit(`${prefix}:ip:a`, 2);
      rateLimit(`${prefix}:ip:a`, 2);
      expect(() => rateLimit(`${prefix}:ip:a`, 2)).toThrow("Rate limit");
      expect(() => rateLimit(`${prefix}:ip:b`, 2)).not.toThrow();
      rateLimit(`${prefix}:project:p`, 1);
      expect(() => rateLimit(`${prefix}:project:p`, 1)).toThrow("Rate limit");
      vi.advanceTimersByTime(60001);
      expect(() => rateLimit(`${prefix}:ip:a`, 2)).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});
