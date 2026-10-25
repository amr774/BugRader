// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BugRadar, serialize, redact } from "./index";
const config = {
  endpoint: "https://api.test/ingest",
  projectKey: "br_test",
  environment: "test",
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 202 }));
});
afterEach(() => {
  BugRadar.destroy();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("browser SDK", () => {
  it("keeps multibyte payloads within the request byte budget", async () => {
    BugRadar.init(config);
    for (let n = 0; n < 30; n++)
      BugRadar.addBreadcrumb({ category: "test", message: "界".repeat(500) });
    const error = new Error("界".repeat(2000));
    error.stack = "界".repeat(12000);
    BugRadar.captureException(error);
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      new TextEncoder().encode(String(vi.mocked(fetch).mock.calls[0][1]?.body))
        .length,
    ).toBeLessThanOrEqual(30000);
  });
  it("aborts in-flight work on destroy without restarting retries", async () => {
    vi.mocked(fetch).mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          ),
        ),
    );
    BugRadar.init(config);
    BugRadar.captureException(new Error("pending"));
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    BugRadar.destroy();
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("initializes once and removes listeners", async () => {
    BugRadar.init(config);
    BugRadar.init(config);
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("once") }));
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledTimes(1);
    BugRadar.destroy();
    const suppress = (e: Event) => e.preventDefault();
    window.addEventListener("error", suppress);
    window.dispatchEvent(
      new ErrorEvent("error", {
        error: new Error("removed"),
        cancelable: true,
      }),
    );
    window.removeEventListener("error", suppress);
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("retries transient failures with the same ID and stops after four attempts", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    BugRadar.init(config);
    expect(() => BugRadar.captureException(new Error("host"))).not.toThrow();
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledTimes(4);
    const bodies = vi
      .mocked(fetch)
      .mock.calls.map((c) => JSON.parse(String(c[1]?.body)));
    expect(new Set(bodies.map((b) => b.eventId)).size).toBe(1);
  });
  it("does not retry permanent rejection", async () => {
    vi.mocked(fetch).mockResolvedValue({ status: 403 } as Response);
    BugRadar.init(config);
    BugRadar.captureException("rejected");
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("bounds queue and breadcrumbs and redacts data", async () => {
    BugRadar.init(config);
    for (let n = 0; n < 50; n++)
      BugRadar.addBreadcrumb({ category: "click", message: "password=hidden" });
    for (let n = 0; n < 80; n++)
      BugRadar.captureException(new Error("token=hidden"));
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledTimes(50);
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(body.breadcrumbs).toHaveLength(30);
    expect(JSON.stringify(body)).not.toContain("hidden");
  });
  it("safely serializes cycles, hostile getters and non-Error values", () => {
    const cycle: any = { password: "hidden" };
    cycle.self = cycle;
    expect(serialize(cycle)).toContain("[Circular]");
    expect(serialize(cycle)).not.toContain("hidden");
    expect(
      serialize({
        get x() {
          throw new Error("bad getter");
        },
      }),
    ).toBe("[Unserializable value]");
    expect(redact("Bearer abc.def")).not.toContain("abc.def");
    expect(() =>
      BugRadar.init({ endpoint: "bad", projectKey: "x" }),
    ).not.toThrow();
  });
  it("deduplicates the same Error instance and handles rejection values", async () => {
    BugRadar.init(config);
    const e = new Error("once");
    BugRadar.captureException(e);
    BugRadar.captureException(e);
    const rejection = new Event("unhandledrejection");
    Object.defineProperty(rejection, "reason", {
      value: { message: "bad", token: "hidden" },
    });
    window.dispatchEvent(rejection);
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(vi.mocked(fetch).mock.calls[1][1]?.body)).not.toContain(
      "hidden",
    );
  });
});
