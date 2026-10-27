import "reflect-metadata";
import { afterEach, describe, it, expect, vi } from "vitest";
import { BugRadarService } from "../dist/index";
const services: BugRadarService[] = [];
function sdk() {
  const s = new BugRadarService({
    endpoint: "http://localhost:3001/ingest/server",
    serverKey: "private",
    environment: "test",
    release: "1.2",
  });
  services.push(s);
  return s;
}
afterEach(() => {
  services.splice(0).forEach((s) => s.onModuleDestroy());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("NestJS SDK transport", () => {
  it("redacts before sending, bounds serialization and ignores extra context", async () => {
    vi.useFakeTimers();
    const transport = vi.fn().mockResolvedValue({ status: 202 });
    vi.stubGlobal("fetch", transport);
    const s = sdk();
    const e = new Error(
      'password="quoted\\"secret" Bearer super-secret https://site.test/a?token=hidden',
    );
    s.captureException(e, {
      method: "GET",
      routeTemplate: "/users/:id?token=private",
      body: "private",
      headers: { authorization: "private" },
    } as any);
    s.captureException(e);
    await vi.advanceTimersByTimeAsync(1);
    expect(transport).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(transport.mock.calls[0][1].body);
    expect(JSON.stringify(sent)).not.toMatch(
      /super-secret|quoted|hidden|private/,
    );
    expect(sent.routeTemplate).toBe("/users/:id");
    expect(sent.requestMethod).toBe("GET");
    expect(sent.body).toBeUndefined();
    expect(sent.headers).toBeUndefined();
    expect(sent.eventId).toMatch(/^[a-f0-9-]{36}$/);
    expect(sent.clientTimestamp).toBeTruthy();
    const cyclic: any = { password: "private", values: [] };
    cyclic.self = cyclic;
    cyclic.values = Array(500).fill("x".repeat(10000));
    s.captureException(cyclic);
    await vi.advanceTimersByTimeAsync(1);
    expect(Buffer.byteLength(transport.mock.calls[1][1].body)).toBeLessThan(
      30000,
    );
  });
  it("bounds retries with exponential delay and keeps event identity", async () => {
    vi.useFakeTimers();
    const transport = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", transport);
    sdk().captureException(new Error("failure"));
    await vi.advanceTimersByTimeAsync(1);
    expect(transport).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(transport).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(transport).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(2000);
    expect(transport).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(100000);
    expect(transport).toHaveBeenCalledTimes(4);
    expect(
      new Set(transport.mock.calls.map((c) => JSON.parse(c[1].body).eventId))
        .size,
    ).toBe(1);
  });
  it("does not retry permanent rejection or throw hostile serialization failures", async () => {
    vi.useFakeTimers();
    const transport = vi.fn().mockResolvedValue({ status: 401 });
    vi.stubGlobal("fetch", transport);
    const s = sdk();
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw Error("hostile");
        },
      },
    );
    expect(() => s.captureException(hostile)).not.toThrow();
    await vi.advanceTimersByTimeAsync(10000);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("aborts timed out requests and cleanup cancels retries and future reports", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            signal = init.signal;
            signal!.addEventListener("abort", () => reject(Error("aborted")));
          }),
      ),
    );
    const s = sdk();
    s.captureException(new Error("failure"));
    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(signal?.aborted).toBe(true);
    s.onModuleDestroy();
    s.captureException(new Error("after cleanup"));
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("limits pending events to 50 and does not register process handlers", async () => {
    vi.useFakeTimers();
    const before = process.listenerCount("uncaughtException");
    const transport = vi.fn().mockResolvedValue({ status: 202 });
    vi.stubGlobal("fetch", transport);
    const s = sdk();
    for (let n = 0; n < 100; n++) s.captureException(new Error(String(n)));
    await vi.runAllTimersAsync();
    expect(transport).toHaveBeenCalledTimes(50);
    expect(process.listenerCount("uncaughtException")).toBe(before);
  });
});
