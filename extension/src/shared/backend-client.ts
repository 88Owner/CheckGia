import type { ColumnMapping, Summary } from "../../../shared/types";

export const BACKEND_ORIGIN = "http://127.0.0.1:8787";

let backendOrigin = BACKEND_ORIGIN;
let accessToken = "";

export function setBackendOrigin(origin: string): void {
  backendOrigin = origin.replace(/\/$/, "");
}

export function setAccessToken(token: string): void {
  accessToken = token;
}

function authHeaders(json: boolean): Record<string, string> {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function request(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(`${backendOrigin}${path}`, {
      ...init,
      headers: {
        ...authHeaders(Boolean(init?.body)),
        ...(init?.headers ?? {}),
      },
    });
    const text = await response.text();
    const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!response.ok) {
      return { ok: false, error: String(data.error ?? "Local Backend gặp lỗi") };
    }
    return data.ok === undefined ? { ok: true, ...data } : data;
  } catch {
    return { ok: false, error: "Local Backend chưa chạy." };
  }
}

export function fetchHealth() {
  return request("/health");
}

export function importMaster(input: { fileName: string; contentBase64: string; mapping?: ColumnMapping }) {
  return request("/api/master-data/import", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function checkBatch(input: {
  items: unknown[];
  runId?: number;
  finalize?: boolean;
  newRun?: boolean;
  machineName?: string;
  scanTarget?: number;
}) {
  let result = await request("/api/check/batch", {
    method: "POST",
    body: JSON.stringify(input),
  });
  const started = Date.now();
  while (result.queued && result.runId && Date.now() - started < 120000) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const ticket = await request(`/api/runs/${String(result.runId)}/ticket`, { method: "POST", body: "{}" });
    if (ticket.queued) continue;
    result = await request("/api/check/batch", {
      method: "POST",
      body: JSON.stringify({ ...input, newRun: false, runId: result.runId }),
    });
  }
  return result;
}

export function login(username: string, password: string) {
  return request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function bootstrap() {
  return request("/api/bootstrap");
}

export function fetchRuns() {
  return request("/api/runs");
}

export function fetchResults(runId: number, options: { includeOk: boolean; includeNotFound: boolean }) {
  const params = new URLSearchParams({
    runId: String(runId),
    includeOk: options.includeOk ? "1" : "0",
    includeNotFound: options.includeNotFound ? "1" : "0",
  });
  return request(`/api/results?${params.toString()}`);
}

export async function exportErrors(runId: number, includeNotFound: boolean) {
  try {
    const params = new URLSearchParams({
      runId: String(runId),
      includeNotFound: includeNotFound ? "1" : "0",
    });
    const response = await fetch(`${backendOrigin}/api/export/errors?${params.toString()}`, {
      headers: authHeaders(false),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      return { ok: false as const, error: data.error ?? "Không xuất được file" };
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { ok: true as const, base64: bytesToBase64(bytes), filename: "shopee_price_errors.xlsx" };
  } catch {
    return { ok: false as const, error: "Local Backend chưa chạy." };
  }
}

export type ScanSnapshot = {
  status: "idle" | "running" | "paused" | "complete" | "error";
  scanned: number;
  total: number;
  wrong: number;
  summary?: Summary;
  runId?: number;
  message?: string;
  tabId?: number;
  stopped?: boolean;
  empty?: boolean;
};
