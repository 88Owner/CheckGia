import { foldHeader } from "./columns";
import { parseVndPrice } from "./price";
import { normalizeSku, skuKey } from "./sku";
import type { PlatformId } from "./types";

export type FileRowStatus = "OK" | "WRONG_PRICE" | "UNMAPPED" | "MISSING_SKU" | "PRICE_PARSE_ERROR";

export interface MasterPrice {
  sku: string;
  name: string | null;
  price: number;
}

export interface PriceCheckLine {
  sku: string | null;
  productName: string | null;
  variantName: string | null;
  retailPrice: number | null;
  comparePrice: number | null;
  masterPrice: number | null;
  masterName: string | null;
  difference: number | null;
  status: FileRowStatus;
}

export interface PriceCheckSummary {
  total: number;
  ok: number;
  wrong_price: number;
  unmapped: number;
  error: number;
}

export interface PriceColumnMap {
  sku: string;
  price: string;
  name: string | null;
  variant: string | null;
  parentSku: string | null;
}

interface HeaderMatch {
  raw: string;
  fold: string;
  bare: string;
}

const MAX_PRICE = 2_000_000_000;

export function applyDiscount(retail: number, discountPercent: number): number {
  return Math.round(retail * (1 - discountPercent / 100));
}

export function parseMoney(input: string | number | null | undefined): number | null {
  if (typeof input === "string" && !input.trim()) return null;
  const direct = parseVndPrice(input);
  if (direct !== null) return direct;
  if (typeof input !== "string") return null;

  let value = input.replace(/[\u00a0\u202f\s]/g, "");
  value = value.replace(/₫/g, "").replace(/đ/gi, "").replace(/vnd/gi, "").replace(/[^\d.,]/g, "");
  if (!value || !/\d/.test(value)) return null;

  const lastDot = value.lastIndexOf(".");
  const lastComma = value.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const decimalSep = lastDot > lastComma ? "." : ",";
    const thousandSep = decimalSep === "." ? "," : ".";
    value = value.split(thousandSep).join("").replace(decimalSep, ".");
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastComma >= 0 ? "," : ".";
    const parts = value.split(sep);
    if (parts.length > 2) value = parts.join("");
    else if (parts[1].length === 3) value = parts.join("");
    else value = `${parts[0]}.${parts[1]}`;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  const rounded = Math.round(parsed);
  if (!Number.isSafeInteger(rounded) || rounded > MAX_PRICE) return null;
  return rounded;
}

function headersOf(cells: unknown[]): HeaderMatch[] {
  return cells.flatMap((cell) => {
    const raw = String(cell ?? "").trim();
    if (!raw) return [];
    const fold = foldHeader(raw);
    return [{ raw, fold, bare: fold.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim() }];
  });
}

function pick(headers: HeaderMatch[], tokens: string[]): string | null {
  for (const token of tokens) {
    const exact = headers.find((header) => header.bare === token || header.fold === token);
    if (exact) return exact.raw;
  }
  for (const token of tokens) {
    const partial = headers.find((header) => header.bare.includes(token) || header.fold.includes(token));
    if (partial) return partial.raw;
  }
  return null;
}

export function findHeaderIndex(matrix: unknown[][], platform: PlatformId): number {
  const limit = Math.min(matrix.length, 20);
  for (let index = 0; index < limit; index += 1) {
    const folds = headersOf(matrix[index] ?? []).map((header) => header.fold);
    if (platform === "shopee") {
      const hasPrice = folds.some((fold) => fold.includes("gia da giam"));
      const hasSku = folds.some((fold) => fold.includes("sku"));
      if (hasPrice && hasSku) return index;
    } else {
      const hasSku = folds.some((fold) => fold.includes("sku nguoi ban"));
      const hasPrice = folds.some((fold) => fold.includes("gia ban le"));
      if (hasSku && hasPrice) return index;
    }
  }
  return -1;
}

export function mapPriceColumns(headers: string[], platform: PlatformId): PriceColumnMap | string {
  const matched = headersOf(headers);
  if (platform === "shopee") {
    const sku = pick(matched, ["so sku phan loai hang", "so sku phan loai", "sku phan loai"]);
    const parentSku = pick(matched, ["so sku san pham", "sku san pham", "sku"]);
    const price = pick(matched, ["gia da giam"]);
    const name = pick(matched, ["ten san pham"]);
    const variant = pick(matched, ["ten phan loai hang", "ten phan loai"]);
    if (!price || (!sku && !parentSku)) {
      return "File Shopee cần cột Giá đã giảm và Số SKU Phân loại hàng hoặc Số SKU Sản phẩm";
    }
    return { sku: sku ?? parentSku!, price, name, variant, parentSku: sku ? parentSku : null };
  }

  const sku = pick(matched, ["sku nguoi ban", "seller sku"]);
  const price = pick(matched, ["gia ban le (noi te)", "gia ban le"]);
  const name = pick(matched, ["ten san pham"]);
  const variant = pick(matched, ["tuy chon bien the", "bien the"]);
  if (!sku || !price) return "File TikTok cần cột SKU người bán và Giá bán lẻ (Nội tệ)";
  return { sku, price, name, variant, parentSku: null };
}

function cellString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function isBlank(row: Record<string, unknown>): boolean {
  return Object.values(row).every((value) => cellString(value) === "");
}

export function recordsFromMatrix(matrix: unknown[][], headerIndex: number): { headers: string[]; rows: Record<string, unknown>[] } {
  const headerRow = matrix[headerIndex] ?? [];
  const headers = headerRow.map((cell) => String(cell ?? "").trim());
  const rows = matrix.slice(headerIndex + 1).map((line) => {
    const record: Record<string, unknown> = {};
    const cells = Array.isArray(line) ? line : [];
    headers.forEach((header, index) => {
      if (!header) return;
      record[header] = cells[index] ?? "";
    });
    return record;
  });
  return { headers: headers.filter((header) => header.length > 0), rows };
}

function summarize(lines: PriceCheckLine[]): PriceCheckSummary {
  return {
    total: lines.length,
    ok: lines.filter((line) => line.status === "OK").length,
    wrong_price: lines.filter((line) => line.status === "WRONG_PRICE").length,
    unmapped: lines.filter((line) => line.status === "UNMAPPED").length,
    error: lines.filter((line) => line.status === "MISSING_SKU" || line.status === "PRICE_PARSE_ERROR").length,
  };
}

export function checkPriceMatrix(
  matrix: unknown[][],
  platform: PlatformId,
  discountPercent: number,
  master: MasterPrice[],
): { ok: true; lines: PriceCheckLine[]; summary: PriceCheckSummary; columns: PriceColumnMap } | { ok: false; error: string } {
  if (platform === "tiktok" && (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100)) {
    return { ok: false, error: "% Giảm giá phải từ 0 đến 100" };
  }
  const headerIndex = findHeaderIndex(matrix, platform);
  if (headerIndex < 0) {
    return {
      ok: false,
      error: platform === "shopee"
        ? "Không thấy tiêu đề file Shopee. Cần cột Giá đã giảm và SKU."
        : "Không thấy tiêu đề file TikTok. Cần cột SKU người bán và Giá bán lẻ (Nội tệ).",
    };
  }
  const table = recordsFromMatrix(matrix, headerIndex);
  const columns = mapPriceColumns(table.headers, platform);
  if (typeof columns === "string") return { ok: false, error: columns };

  const byKey = new Map(master.map((row) => [skuKey(row.sku), row]));
  const lines: PriceCheckLine[] = [];
  for (const row of table.rows) {
    if (isBlank(row)) continue;
    const variantSku = normalizeSku(cellString(row[columns.sku]));
    const parentSku = columns.parentSku ? normalizeSku(cellString(row[columns.parentSku])) : "";
    const sku = variantSku || parentSku;
    const productName = columns.name ? cellString(row[columns.name]) || null : null;
    const variantName = columns.variant ? cellString(row[columns.variant]) || null : null;
    const parsed = parseMoney(row[columns.price] as string | number | null);
    if (!sku && parsed === null && !productName && !variantName) continue;
    if (!sku) {
      lines.push({ sku: null, productName, variantName, retailPrice: parsed, comparePrice: null, masterPrice: null, masterName: null, difference: null, status: "MISSING_SKU" });
      continue;
    }
    if (parsed === null) {
      lines.push({ sku, productName, variantName, retailPrice: null, comparePrice: null, masterPrice: null, masterName: null, difference: null, status: "PRICE_PARSE_ERROR" });
      continue;
    }
    const retailPrice = parsed;
    const comparePrice = platform === "tiktok" ? applyDiscount(retailPrice, discountPercent) : retailPrice;
    const found = byKey.get(skuKey(sku));
    if (!found) {
      lines.push({ sku, productName, variantName, retailPrice, comparePrice, masterPrice: null, masterName: null, difference: null, status: "UNMAPPED" });
      continue;
    }
    const difference = comparePrice - found.price;
    lines.push({
      sku,
      productName: productName || found.name,
      variantName,
      retailPrice,
      comparePrice,
      masterPrice: found.price,
      masterName: found.name,
      difference,
      status: difference === 0 ? "OK" : "WRONG_PRICE",
    });
  }

  if (lines.length === 0) return { ok: false, error: "File không có dòng sản phẩm để đối chiếu" };
  if (lines.length > 10000) return { ok: false, error: "File vượt quá 10.000 dòng" };
  return { ok: true, lines, summary: summarize(lines), columns };
}
