export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: "ADMIN" | "USER" | "VIEWER" | "SALE" | "IT";
  enabled?: boolean;
}

const ACCESS = "auditor.access";
const REFRESH = "auditor.refresh";

export function currentToken(): string {
  return sessionStorage.getItem(ACCESS) ?? "";
}

export function saveSession(accessToken: string, refreshToken: string): void {
  sessionStorage.setItem(ACCESS, accessToken);
  sessionStorage.setItem(REFRESH, refreshToken);
}

export function clearSession(): void {
  sessionStorage.removeItem(ACCESS);
  sessionStorage.removeItem(REFRESH);
}

async function refresh(): Promise<boolean> {
  const refreshToken = sessionStorage.getItem(REFRESH);
  if (!refreshToken) return false;
  const response = await fetch("/api/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!response.ok) return false;
  const data = await response.json() as { accessToken?: string; refreshToken?: string };
  if (!data.accessToken || !data.refreshToken) return false;
  saveSession(data.accessToken, data.refreshToken);
  return true;
}

export async function api<T = Record<string, unknown>>(path: string, init?: RequestInit, retry = true): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const token = currentToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(path, { ...init, headers });
  if (response.status === 401 && retry && !path.startsWith("/api/auth/login")) {
    if (await refresh()) return api<T>(path, init, false);
  }
  const text = await response.text();
  const data = text ? JSON.parse(text) as T & { error?: string } : {} as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "Yêu cầu thất bại");
  return data;
}

export async function download(path: string, filename: string): Promise<void> {
  const headers = new Headers();
  const token = currentToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(path, { headers });
  if (!response.ok) throw new Error("Không xuất được file");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
