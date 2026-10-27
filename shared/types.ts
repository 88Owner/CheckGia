export type ItemStatus =
  | "OK"
  | "WRONG_PRICE"
  | "UNMAPPED"
  | "NOT_FOUND"
  | "MISSING_SKU"
  | "PRICE_PARSE_ERROR";

export interface ScrapedItem {
  sku: string | null;
  model_id: string | null;
  product_name: string | null;
  attributes?: string | null;
  current_price: number | null;
  original_price: number | null;
}

export interface CheckResult extends ScrapedItem {
  standard_price: number | null;
  retail_price: number | null;
  difference: number | null;
  status: ItemStatus;
  checked_at: string;
}

export interface Summary {
  total: number;
  ok: number;
  wrong_price: number;
  unmapped: number;
  not_found: number;
  error: number;
}

export type UserRole = "ADMIN" | "USER" | "VIEWER" | "SALE" | "IT";
export type PlatformId = "shopee" | "tiktok";
export type RunStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";

export interface CheckRun {
  id: number;
  user_id: string;
  username: string;
  display_name: string;
  machine_name: string | null;
  shop_name: string | null;
  master_version: string | null;
  started_at: string;
  finished_at: string | null;
  total: number;
  ok: number;
  wrong_price: number;
  unmapped: number;
  not_found: number;
  error: number;
  status: RunStatus;
  scan_target: number | null;
}

export interface ColumnMapping {
  skuColumn: string;
  priceColumn: string;
  retailColumn?: string | null;
  nameColumn?: string | null;
}

export interface ImportSuccess {
  ok: true;
  imported: number;
  skipped: number;
  fileName: string;
  skuColumn: string;
  priceColumn: string;
}

export interface ImportNeedsMapping {
  ok: false;
  needsMapping: true;
  columns: string[];
  fileName: string;
}

export interface HealthInfo {
  ok: true;
  service: "shopee-price-checker";
  port: number;
  masterCount: number;
  masterFileName: string | null;
  masterVersion: string | null;
  maxItems: number;
  minDelayMs: number;
  maxDelayMs: number;
  displayName?: string | null;
  role?: UserRole | "";
  serverUrl?: string;
  machineName?: string;
  database?: string;
}
