// @vitest-environment jsdom
import { afterEach, it, expect, vi } from "vitest";
import { api, SESSION_EXPIRED } from "../src/api";
afterEach(() => vi.unstubAllGlobals());
it("signals session expiry on protected requests so the app can recover to login", async () => {
  const expired = vi.fn();
  window.addEventListener(SESSION_EXPIRED, expired);
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ code: "UNAUTHENTICATED" }), {
          status: 401,
        }),
      ),
  );
  try {
    await expect(api("/projects")).rejects.toMatchObject({
      message: "UNAUTHENTICATED",
      status: 401,
    });
    expect(expired).toHaveBeenCalledOnce();
  } finally {
    window.removeEventListener(SESSION_EXPIRED, expired);
  }
});
it("keeps invalid login feedback on the authentication form", async () => {
  const expired = vi.fn();
  window.addEventListener(SESSION_EXPIRED, expired);
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ code: "UNAUTHENTICATED" }), {
          status: 401,
        }),
      ),
  );
  try {
    await expect(api("/auth/login", "POST", {})).rejects.toMatchObject({
      message: "UNAUTHENTICATED",
    });
    expect(expired).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener(SESSION_EXPIRED, expired);
  }
});
it.each(["null", '"unexpected"', "{bad"])(
  "turns malformed API output %s into a localizable error",
  async (body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(body, { status: 200 })),
    );
    await expect(api("/projects")).rejects.toMatchObject({
      message: "INVALID_RESPONSE",
    });
  },
);
