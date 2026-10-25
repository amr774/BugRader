export const API =
  (import.meta as unknown as { env: Record<string, string> }).env
    .VITE_API_URL ?? "http://localhost:3001";
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const res = await fetch(API + path, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res
    .json()
    .catch(() => ({ message: "The server returned an invalid response" }));
  if (!res.ok) throw new Error(data.message ?? "Request failed");
  return data;
}
export type Project = {
  id: string;
  name: string;
  origins: string[];
  keyPrefix: string;
  key?: string;
  _count?: { issues: number; events: number };
};
export type Issue = {
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
