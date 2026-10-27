import { describe, it, expect } from "vitest";
import { cleanUrl, redact, fingerprint } from "./privacy";
import { eventInput, projectInput, listInput } from "./validation";
describe("privacy and limits", () => {
  it("compares timestamp instants with different fractional precision", () => {
    expect(
      listInput.safeParse({
        from: "2026-10-26T00:00:00Z",
        to: "2026-10-26T00:00:00.500Z",
      }).success,
    ).toBe(true);
    expect(
      listInput.safeParse({
        from: "2026-10-26T00:00:00.500Z",
        to: "2026-10-26T00:00:00Z",
      }).success,
    ).toBe(false);
  });
  it("redacts complete JSON secrets containing escaped quotes", () => {
    expect(
      redact(
        JSON.stringify({
          password: 'prefix"SECRET_SUFFIX',
          token: 'other\\"SECRET_SUFFIX',
        }),
      ),
    ).not.toContain("SECRET_SUFFIX");
  });
  it("strips URL credentials, query and fragment", () => {
    expect(cleanUrl("https://user:pass@example.com/a?token=abc#secret")).toBe(
      "https://example.com/a",
    );
    expect(cleanUrl("javascript:alert(1)")).toBe("[invalid URL]");
  });
  it("redacts secret fields and bearer tokens", () => {
    const result = redact(
      "password=hunter2 token=abcd Authorization: Bearer abc.def.ghi https://site.test/a?secret=x#z",
    );
    expect(result).not.toContain("hunter2");
    expect(result).not.toContain("abc.def");
    expect(result).not.toContain("?secret");
    expect(result).not.toContain("abcd");
  });
  it("groups line and query changes without collapsing distinct messages", () => {
    const a = fingerprint(
      "Error",
      "Checkout failed",
      "Error: Checkout failed\n at cart (https://site.test/app.js?v=1:22:3)",
    );
    const b = fingerprint(
      "Error",
      "Checkout failed",
      "Error: Checkout failed\n at cart (https://site.test/app.js?v=2:44:9)",
    );
    expect(a).toBe(b);
    expect(fingerprint("Error", "Checkout failed for item 17")).not.toBe(
      fingerprint("Error", "Checkout failed for item 18"),
    );
    expect(
      fingerprint("Error", "x", " at a (https://a.test/a.js:1:2)"),
    ).not.toBe(fingerprint("Error", "x", " at b (https://a.test/b.js:1:2)"));
  });
  it("rejects oversized fields, breadcrumbs, unknown properties, and wildcard origins", () => {
    const base = {
      eventId: crypto.randomUUID(),
      name: "Error",
      message: "x",
      sdkVersion: "1",
    };
    expect(
      eventInput.safeParse({ ...base, message: "x".repeat(2001) }).success,
    ).toBe(false);
    expect(
      eventInput.safeParse({
        ...base,
        breadcrumbs: Array(31).fill({ category: "x", message: "x" }),
      }).success,
    ).toBe(false);
    expect(eventInput.safeParse({ ...base, secret: "x" }).success).toBe(false);
    expect(
      projectInput.safeParse({ name: "x", origins: ["https://*.test"] })
        .success,
    ).toBe(false);
  });
});
