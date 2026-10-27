import { describe, it, expect } from "vitest";
import { redact as apiRedact } from "./privacy";
import { redact as browserRedact } from "../../../packages/browser-sdk/src/index";
import { redact as serverRedact } from "../../../packages/nestjs-sdk/src/privacy";
describe.each([
  ["API", apiRedact],
  ["browser SDK", browserRedact],
  ["Nest SDK", serverRedact],
] as const)("%s redaction regressions", (_name, redact) => {
  it("removes Basic auth and all cookie pairs from diagnostic header lines", () => {
    const text =
      "Authorization: Basic dXNlcjpzZWNyZXQ=\nCookie: session=FIRST_SECRET; analytics=SECOND_SECRET\nSet-Cookie: session=THIRD_SECRET; HttpOnly\nError: checkout failed";
    const result = redact(text);
    expect(result).not.toContain("dXNlcjpzZWNyZXQ=");
    expect(result).not.toContain("FIRST_SECRET");
    expect(result).not.toContain("SECOND_SECRET");
    expect(result).not.toContain("THIRD_SECRET");
    expect(result).toContain("checkout failed");
  });
  it("redacts private BugRadar credentials even without a field label", () => {
    const key = "brs_" + "a".repeat(64);
    expect(redact("Failed with " + key)).not.toContain(key);
  });
});
