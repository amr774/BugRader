import "reflect-metadata";
import { it, expect, vi } from "vitest";
import { Logger } from "@nestjs/common";
import { BugRadarExceptionFilter } from "../dist/index";
it("reports unexpected thrown objects when Nest will return 500 despite a statusCode field", () => {
  const captureException = vi.fn(),
    reply = vi.fn();
  const adapter = { reply, isHeadersSent: () => false };
  const host = {
    getType: () => "http",
    getArgByIndex: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ method: "GET", route: { path: "/test" } }),
    }),
  };
  const quiet = vi
    .spyOn(Logger.prototype, "error")
    .mockImplementation(() => {});
  try {
    new BugRadarExceptionFilter(
      { captureException } as any,
      { httpAdapter: adapter } as any,
    ).catch({ statusCode: 404 }, host as any);
    expect(reply.mock.calls[0][2]).toBe(500);
    expect(captureException).toHaveBeenCalledOnce();
  } finally {
    quiet.mockRestore();
  }
});
