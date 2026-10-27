import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadEnvFile(): void {
  const candidates = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../.env")];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

export interface AppConfig {
  host: string;
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  allowedOrigins: string[];
  extensionId: string;
  maxItems: number;
  minDelayMs: number;
  maxDelayMs: number;
  maxConcurrentScans: number;
  adminUsername: string;
  adminPassword: string;
  adminDisplayName: string;
  accessTtlSec: number;
  refreshTtlSec: number;
  backupDir: string;
  sqliteImportPath: string;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) throw new Error(`${name} phải là số nguyên`);
  return parsed;
}

export function assertBindHost(host: string): string {
  const normalized = host.trim();
  if (normalized === "127.0.0.1" || normalized === "localhost") return "127.0.0.1";
  if (normalized === "0.0.0.0") return "0.0.0.0";
  throw new Error(`Refusing to bind ${host}. Dùng 0.0.0.0 cho LAN hoặc 127.0.0.1 cho máy lẻ.`);
}

export function readConfig(): AppConfig {
  const minDelayMs = integer("MIN_DELAY_MS", 3000);
  const maxDelayMs = integer("MAX_DELAY_MS", 7000);
  if (minDelayMs < 0 || maxDelayMs < minDelayMs) {
    throw new Error("MIN_DELAY_MS và MAX_DELAY_MS không hợp lệ");
  }
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "http://127.0.0.1,http://127.0.0.1:8388,http://127.0.0.1:3000,http://localhost:8388,http://localhost:3000,http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:5174,http://localhost:5174")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return {
    host: assertBindHost(process.env.HOST ?? "0.0.0.0"),
    port: integer("PORT", 8787),
    databaseUrl: process.env.DATABASE_URL ?? "postgres://auditor:auditor@127.0.0.1:5432/price_auditor",
    jwtSecret: process.env.JWT_SECRET ?? "dev-only-change-this-secret",
    allowedOrigins,
    extensionId: (process.env.EXTENSION_ID ?? "").trim(),
    maxItems: integer("MAX_ITEMS", 100),
    minDelayMs,
    maxDelayMs,
    maxConcurrentScans: integer("MAX_CONCURRENT_SCANS", 10),
    adminUsername: process.env.ADMIN_USERNAME ?? "admin",
    adminPassword: process.env.ADMIN_PASSWORD ?? "",
    adminDisplayName: process.env.ADMIN_DISPLAY_NAME ?? "Admin",
    accessTtlSec: integer("ACCESS_TTL_SEC", 60 * 15),
    refreshTtlSec: integer("REFRESH_TTL_SEC", 60 * 60 * 24 * 7),
    backupDir: process.env.BACKUP_DIR ?? "./backups",
    sqliteImportPath: process.env.SQLITE_IMPORT_PATH ?? "./data/checker.db",
  };
}

function isLanDashboardOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const port = url.port;
  if (port !== "" && !["80", "8388", "3000", "8787", "5174"].includes(port)) return false;
  const host = url.hostname;
  if (host === "localhost" || host === "127.0.0.1") return true;
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  const [a, b] = numbers;
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

export function isAllowedOrigin(
  origin: string | undefined,
  options: { extensionId: string; allowedOrigins: string[] },
): boolean {
  if (!origin) return true;
  if (options.allowedOrigins.includes(origin)) return true;
  if (isLanDashboardOrigin(origin)) return true;
  if (options.extensionId) return origin === `chrome-extension://${options.extensionId}`;
  return /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
}
