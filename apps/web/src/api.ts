export const API =
  (import.meta as unknown as { env: Record<string, string> }).env
    .VITE_API_URL ?? "http://localhost:3001";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export const SESSION_EXPIRED = "bugradar:session-expired";
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API + path, {
      signal: AbortSignal.timeout(15000),
      method,
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new ApiError(
      (e as Error).name === "TimeoutError"
        ? "REQUEST_TIMEOUT"
        : "NETWORK_ERROR",
      0,
    );
  }
  const data = await res.json().catch(() => ({ code: "INVALID_RESPONSE" }));
  if (
    res.status === 401 &&
    !path.startsWith("/auth/") &&
    typeof window !== "undefined"
  )
    window.dispatchEvent(new Event(SESSION_EXPIRED));
  if (data === null || typeof data !== "object")
    throw new ApiError("INVALID_RESPONSE", res.status);
  if (!res.ok || data.code === "INVALID_RESPONSE")
    throw new ApiError(data.code ?? "INTERNAL_ERROR", res.status);
  return data;
}
export type Project = {
  id: string;
  name: string;
  origins: string[];
  keyPrefix: string;
  serverKeyPrefix?: string;
  key?: string;
  _count?: { issues: number; events: number };
};
export type Issue = {
  source: "BROWSER" | "SERVER";
  id: string;
  name: string;
  message: string;
  status: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  projectId: string;
  projectName?: string;
  project?: { name: string };
  environments?: string[];
  reopenedAt?: string;
};
export type Occurrence = {
  source: "BROWSER" | "SERVER";
  requestMethod?: string;
  routeTemplate?: string;
  id: string;
  message: string;
  stack?: string;
  environment: string;
  release?: string;
  receivedAt: string;
  clientTimestamp?: string;
  url?: string;
  userAgent?: string;
  sdkVersion: string;
  breadcrumbs: { category: string; message: string; timestamp?: string }[];
};
export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
  firstSeen?: string;
  lastSeen?: string;
};
