import { detectColumns, foldHeader } from "../../../shared/columns";
import type { PlatformId } from "../../../shared/types";
import { parseVndPrice } from "../../../shared/price";
import { normalizeSku, skuKey } from "../../../shared/sku";
import { codeKey, emptyLookup, parseSkuLabels, type SkuLookup } from "../../../shared/sku-labels";
import type { ColumnMapping, ImportNeedsMapping } from "../../../shared/types";
import * as XLSX from "xlsx";
import { one, query, withTransaction } from "../db/pool";
import { ClientError } from "../errors";
import { writeAudit } from "./audit";

export interface MasterProductRow {
  sku: string;
  skuKey: string;
  standardPrice: number;
  retailPrice: number | null;
  name: string | null;
  attributes: string | null;
  patternName: string | null;
  typeName: string | null;
  sizeLabel: string | null;
}

export interface ParsedMaster {
  ok: true;
  rows: MasterProductRow[];
  skipped: number;
  fileName: string;
  skuColumn: string;
  priceColumn: string;
  retailColumn: string | null;
}

interface TableData {
  headers: string[];
  rows: Record<string, unknown>[];
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function readLookup(workbook: XLSX.WorkBook): SkuLookup {
  const lookup = emptyLookup();
  const sheetName = workbook.SheetNames.find((name) => foldHeader(name) === "data");
  if (!sheetName) return lookup;
  const matrix = XLSX.utils.sheet_to_json<(string | number | null)[]>(workbook.Sheets[sheetName], {
    header: 1,
    defval: "",
    raw: true,
  });
  for (const line of matrix) {
    const patternCode = cellText(line?.[0]);
    const patternName = cellText(line?.[1]);
    const typeCode = cellText(line?.[3]);
    const typeName = cellText(line?.[4]);
    const patternHeader = foldHeader(patternCode);
    const typeHeader = foldHeader(typeCode);
    if (patternCode && patternName && !patternHeader.startsWith("ma ") && patternHeader !== "ma" && patternHeader !== "sku") {
      lookup.patterns.set(codeKey(patternCode), patternName);
    }
    if (typeCode && typeName && !typeHeader.startsWith("ma ") && typeHeader !== "ma" && typeHeader !== "sku") {
      lookup.types.set(codeKey(typeCode), typeName);
    }
  }
  return lookup;
}

function workbookFrom(buffer: Buffer, fileName: string): XLSX.WorkBook {
  const lower = fileName.toLowerCase();
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const useTabs = lower.endsWith(".csv") && firstLine.includes("\t") && firstLine.split("\t").length > firstLine.split(",").length;
  return lower.endsWith(".csv")
    ? XLSX.read(text, { type: "string", raw: true, FS: useTabs ? "\t" : "," })
    : XLSX.read(buffer, { type: "buffer", raw: true });
}

export function readTable(buffer: Buffer, fileName: string): TableData {
  const workbook = workbookFrom(buffer, fileName);
  const sheetName = workbook.SheetNames.find((name) => foldHeader(name) !== "data");
  if (!sheetName) return { headers: [], rows: [] };
  const matrix = XLSX.utils.sheet_to_json<(string | number | null)[]>(workbook.Sheets[sheetName], {
    header: 1,
    defval: "",
    raw: true,
  });
  if (matrix.length === 0) return { headers: [], rows: [] };
  const headers = (matrix[0] ?? []).map((cell) => String(cell ?? "").trim());
  const rows = matrix.slice(1).map((line) => {
    const record: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      if (!header) return;
      record[header] = line[index] ?? "";
    });
    return record;
  });
  return { headers: headers.filter((header) => header.length > 0), rows };
}

function cellString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

export function parseMasterFile(buffer: Buffer, fileName: string, mapping?: ColumnMapping): ParsedMaster | ImportNeedsMapping {
  const workbook = workbookFrom(buffer, fileName);
  const lookup = readLookup(workbook);
  const table = readTable(buffer, fileName);
  const detected = detectColumns(table.headers);
  const skuColumn = mapping?.skuColumn ?? detected.skuColumn;
  const priceColumn = mapping?.priceColumn ?? detected.priceColumn;
  const retailColumn = mapping?.retailColumn ?? detected.retailColumn;
  const nameColumn = mapping?.nameColumn ?? detected.nameColumn;
  const attributeColumns = detected.attributeColumns.filter((column) => table.headers.includes(column));
  if (!skuColumn || !priceColumn || !table.headers.includes(skuColumn) || !table.headers.includes(priceColumn)) {
    return { ok: false, needsMapping: true, columns: table.headers, fileName };
  }

  const rows: MasterProductRow[] = [];
  let skipped = 0;
  const seen = new Map<string, MasterProductRow>();
  for (const row of table.rows) {
    const sku = normalizeSku(cellString(row[skuColumn]));
    const standardPrice = parseVndPrice(typeof row[priceColumn] === "number" ? row[priceColumn] : cellString(row[priceColumn]));
    if (!sku || standardPrice === null) {
      if (sku || cellString(row[priceColumn]).trim()) skipped += 1;
      continue;
    }
    const retailSource = retailColumn ? row[retailColumn] : null;
    const parsedRetail = retailSource === null ? null : parseVndPrice(typeof retailSource === "number" ? retailSource : cellString(retailSource));
    const retailPrice = parsedRetail ?? (retailColumn === priceColumn ? standardPrice : null);
    const name = nameColumn ? cellString(row[nameColumn]).trim() || null : null;
    const attributes = attributeColumns
      .map((column) => cellString(row[column]).trim())
      .filter(Boolean)
      .join(", ") || null;
    const labels = parseSkuLabels(sku, lookup);
    seen.set(skuKey(sku), { sku, skuKey: skuKey(sku), standardPrice, retailPrice, name, attributes, ...labels });
  }
  rows.push(...seen.values());
  if (rows.length === 0) throw new ClientError("Không có dòng SKU và giá hợp lệ trong file");
  return { ok: true, rows, skipped, fileName, skuColumn, priceColumn, retailColumn: retailColumn === priceColumn ? null : retailColumn };
}

export interface MasterVersionInfo {
  id: number;
  version: string;
  filename: string;
  totalSku: number;
  uploadedBy: string | null;
  createdAt: string;
  status: "ACTIVE" | "ARCHIVED";
  platform: PlatformId;
}

function mapVersion(row: Record<string, unknown>): MasterVersionInfo {
  return {
    id: Number(row.id),
    version: String(row.version),
    filename: String(row.filename),
    totalSku: Number(row.total_sku),
    uploadedBy: row.uploaded_by_name ? String(row.uploaded_by_name) : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    status: row.status as "ACTIVE" | "ARCHIVED",
    platform: row.platform === "tiktok" ? "tiktok" : "shopee",
  };
}

const VERSION_SELECT = `
  SELECT v.*, u.display_name AS uploaded_by_name
  FROM master_data_versions v
  LEFT JOIN users u ON u.id = v.uploaded_by
`;

export async function listVersions(platform: PlatformId): Promise<MasterVersionInfo[]> {
  const rows = await query(`${VERSION_SELECT} WHERE v.platform = $1 ORDER BY v.id DESC`, [platform]);
  return rows.map(mapVersion);
}

export async function activeVersion(platform: PlatformId = "shopee"): Promise<MasterVersionInfo | null> {
  const row = await one(`${VERSION_SELECT} WHERE v.status = 'ACTIVE' AND v.platform = $1`, [platform]);
  return row ? mapVersion(row) : null;
}

export async function saveMasterVersion(parsed: ParsedMaster, userId: string, ip: string, platform: PlatformId): Promise<MasterVersionInfo> {
  const today = new Date();
  const tag = platform === "tiktok" ? "TTK" : "SHP";
  const prefix = `MD-${tag}-${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}-`;
  const saved = await withTransaction(async (tx) => {
    const existing = await tx<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM master_data_versions WHERE version LIKE $1",
      [`${prefix}%`],
    );
    const version = `${prefix}${String((existing[0]?.n ?? 0) + 1).padStart(2, "0")}`;
    await tx("UPDATE master_data_versions SET status = 'ARCHIVED' WHERE status = 'ACTIVE' AND platform = $1", [platform]);
    const inserted = await tx<{ id: number }>(
      `INSERT INTO master_data_versions (version, filename, total_sku, uploaded_by, status, platform)
       VALUES ($1, $2, $3, $4, 'ACTIVE', $5) RETURNING id`,
      [version, parsed.fileName, parsed.rows.length, userId, platform],
    );
    const versionId = Number(inserted[0].id);
    for (const row of parsed.rows) {
      await tx(
        `INSERT INTO master_products (version_id, sku, sku_key, standard_price, retail_price, name, attributes, pattern_name, type_name, size_label)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [versionId, row.sku, row.skuKey, row.standardPrice, row.retailPrice, row.name, row.attributes, row.patternName, row.typeName, row.sizeLabel],
      );
    }
    const loaded = await tx(`${VERSION_SELECT} WHERE v.id = $1`, [versionId]);
    return mapVersion(loaded[0]);
  });
  invalidateMasterCache();
  await writeAudit(userId, "UPLOAD_MASTER_DATA", ip, { version: saved.version, totalSku: saved.totalSku, fileName: parsed.fileName, platform });
  return saved;
}

export async function activateVersion(versionId: number, userId: string, ip: string): Promise<MasterVersionInfo> {
  const saved = await withTransaction(async (tx) => {
    const found = await tx<{ id: number; platform: string }>("SELECT id, platform FROM master_data_versions WHERE id = $1", [versionId]);
    if (!found[0]) throw new ClientError("Không tìm thấy version", 404);
    const platform = found[0].platform === "tiktok" ? "tiktok" : "shopee";
    await tx("UPDATE master_data_versions SET status = 'ARCHIVED' WHERE status = 'ACTIVE' AND platform = $1", [platform]);
    await tx("UPDATE master_data_versions SET status = 'ACTIVE' WHERE id = $1", [versionId]);
    const loaded = await tx(`${VERSION_SELECT} WHERE v.id = $1`, [versionId]);
    return mapVersion(loaded[0]);
  });
  await writeAudit(userId, "ACTIVATE_MASTER_VERSION", ip, { version: saved.version, platform: saved.platform });
  return saved;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export async function searchProducts(input: {
  platform: PlatformId;
  name?: string;
  sku?: string;
  pattern?: string;
  typeName?: string;
  size?: string;
  limit: number;
  offset: number;
}): Promise<{
  version: MasterVersionInfo | null;
  total: number;
  products: Array<{
    sku: string;
    name: string | null;
    attributes: string | null;
    standardPrice: number;
    retailPrice: number | null;
    patternName: string | null;
    typeName: string | null;
    sizeLabel: string | null;
  }>;
}> {
  const version = await activeVersion(input.platform);
  if (!version) return { version: null, total: 0, products: [] };
  const where = ["p.version_id = $1"];
  const params: unknown[] = [version.id];
  const like = (column: string, value: string | undefined) => {
    const text = value?.trim();
    if (!text) return;
    params.push(`%${escapeLike(text)}%`);
    where.push(`COALESCE(${column}, '') ILIKE $${params.length} ESCAPE '\\'`);
  };
  if (input.sku?.trim()) {
    params.push(`%${escapeLike(input.sku.trim())}%`);
    where.push(`(p.sku ILIKE $${params.length} ESCAPE '\\' OR p.sku_key ILIKE $${params.length} ESCAPE '\\')`);
  }
  like("p.name", input.name);
  like("p.pattern_name", input.pattern);
  like("p.type_name", input.typeName);
  like("p.size_label", input.size);
  const filter = where.join(" AND ");
  const total = await one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM master_products p WHERE ${filter}`, params);
  const rows = await query<{
    sku: string;
    name: string | null;
    attributes: string | null;
    standard_price: number;
    retail_price: number | null;
    pattern_name: string | null;
    type_name: string | null;
    size_label: string | null;
  }>(
    `SELECT p.sku, p.name, p.attributes, p.standard_price, p.retail_price, p.pattern_name, p.type_name, p.size_label
     FROM master_products p
     WHERE ${filter}
     ORDER BY p.sku ASC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, input.limit, input.offset],
  );
  return {
    version,
    total: total?.n ?? 0,
    products: rows.map((row) => ({
      sku: row.sku,
      name: row.name,
      attributes: row.attributes,
      standardPrice: Number(row.standard_price),
      retailPrice: row.retail_price === null ? null : Number(row.retail_price),
      patternName: row.pattern_name,
      typeName: row.type_name,
      sizeLabel: row.size_label,
    })),
  };
}

export interface CachedMasterRow {
  sku: string;
  sku_key: string;
  standard_price: number;
  retail_price: number | null;
  name: string | null;
  attributes: string | null;
}

const cache = new Map<number, Map<string, CachedMasterRow>>();

export function invalidateMasterCache(versionId?: number): void {
  if (versionId) cache.delete(versionId);
  else cache.clear();
}

export interface PriceGroupOption {
  typeName: string;
  sizeLabel: string;
  patternName: string;
  skuCount: number;
  retailPrices: number[];
  standardPrices: number[];
}

function numberList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => Number(item)).filter((item) => Number.isInteger(item)))];
}

export async function listPriceGroups(platform: PlatformId): Promise<PriceGroupOption[]> {
  const version = await activeVersion(platform);
  if (!version) return [];
  const rows = await query<{
    type_name: string;
    size_label: string;
    pattern_name: string;
    sku_count: number;
    retail_prices: unknown;
    standard_prices: unknown;
  }>(
    `SELECT COALESCE(type_name, '') AS type_name,
            COALESCE(size_label, '') AS size_label,
            pattern_name,
            COUNT(*)::int AS sku_count,
            ARRAY_AGG(DISTINCT retail_price) FILTER (WHERE retail_price IS NOT NULL) AS retail_prices,
            ARRAY_AGG(DISTINCT standard_price) AS standard_prices
     FROM master_products
     WHERE version_id = $1 AND pattern_name IS NOT NULL AND pattern_name <> ''
     GROUP BY 1, 2, 3
     ORDER BY 1, 2, 3`,
    [version.id],
  );
  return rows.map((row) => ({
    typeName: row.type_name,
    sizeLabel: row.size_label,
    patternName: row.pattern_name,
    skuCount: Number(row.sku_count),
    retailPrices: numberList(row.retail_prices),
    standardPrices: numberList(row.standard_prices),
  }));
}

export async function updateGroupPrices(input: {
  platform: PlatformId;
  typeName: string;
  sizeLabel: string;
  patterns: string[];
  retailPrice: number;
  standardPrice: number;
  userId: string;
  ip: string;
}): Promise<{ updated: number; skus: string[] }> {
  const version = await activeVersion(input.platform);
  if (!version) throw new ClientError("Chưa có master data đang dùng", 404);
  const patterns = [...new Set(input.patterns.map((item) => item.trim()).filter(Boolean))];
  if (!patterns.length) throw new ClientError("Chọn ít nhất một mẫu");
  const typeName = input.typeName.trim();
  const sizeLabel = input.sizeLabel.trim();
  const skus = await withTransaction(async (tx) => {
    const rows = await tx<{ sku: string }>(
      `UPDATE master_products
       SET retail_price = $1, standard_price = $2
       WHERE version_id = $3
         AND COALESCE(type_name, '') = $4
         AND COALESCE(size_label, '') = $5
         AND pattern_name = ANY($6::text[])
       RETURNING sku`,
      [input.retailPrice, input.standardPrice, version.id, typeName, sizeLabel, patterns],
    );
    return rows.map((row) => row.sku).sort((left, right) => left.localeCompare(right, "vi"));
  });
  if (!skus.length) throw new ClientError("Không có SKU khớp loại, kích thước và mẫu đã chọn", 404);
  invalidateMasterCache(version.id);
  await writeAudit(input.userId, "UPDATE_MASTER_PRICE", input.ip, {
    platform: input.platform,
    version: version.version,
    typeName,
    sizeLabel,
    patterns,
    retailPrice: input.retailPrice,
    standardPrice: input.standardPrice,
    updated: skus.length,
  });
  return { updated: skus.length, skus };
}

export async function masterMap(versionId: number): Promise<Map<string, CachedMasterRow>> {
  const hit = cache.get(versionId);
  if (hit) return hit;
  const rows = await query<CachedMasterRow>(
    "SELECT sku, sku_key, standard_price, retail_price, name, attributes FROM master_products WHERE version_id = $1",
    [versionId],
  );
  const map = new Map(rows.map((row) => [row.sku_key, {
    ...row,
    standard_price: Number(row.standard_price),
    retail_price: row.retail_price === null ? null : Number(row.retail_price),
  }]));
  cache.set(versionId, map);
  return map;
}
