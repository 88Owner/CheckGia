import { masterComparePrice } from "../../../shared/match";
import { checkPriceMatrix, type PriceCheckLine, type PriceCheckSummary } from "../../../shared/platform-file";
import type { PlatformId } from "../../../shared/types";
import { seesOwnData } from "../../../shared/roles";
import * as XLSX from "xlsx";
import { one, query, withTransaction, type QueryFn } from "../db/pool";
import { ClientError } from "../errors";
import { writeAudit } from "./audit";
import { activeVersion, masterMap } from "./master-data";

export interface SavedPriceCheck {
  id: number;
  platform: PlatformId;
  filename: string;
  discountPercent: number | null;
  masterVersion: string | null;
  username: string;
  displayName: string;
  createdAt: string;
  summary: PriceCheckSummary;
}

function readMatrix(buffer: Buffer, fileName: string): unknown[][] {
  const lower = fileName.toLowerCase();
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const useTabs = lower.endsWith(".csv") && firstLine.includes("\t") && firstLine.split("\t").length > firstLine.split(",").length;
  const workbook = lower.endsWith(".csv")
    ? XLSX.read(text, { type: "string", raw: true, FS: useTabs ? "\t" : "," })
    : XLSX.read(buffer, { type: "buffer", raw: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: "", raw: true });
}

function mapSaved(row: Record<string, unknown>): SavedPriceCheck {
  return {
    id: Number(row.id),
    platform: row.platform as PlatformId,
    filename: String(row.filename),
    discountPercent: row.discount_percent === null || row.discount_percent === undefined ? null : Number(row.discount_percent),
    masterVersion: row.master_version ? String(row.master_version) : null,
    username: String(row.username ?? ""),
    displayName: String(row.display_name ?? ""),
    createdAt: new Date(String(row.created_at)).toISOString(),
    summary: {
      total: Number(row.total),
      ok: Number(row.ok),
      wrong_price: Number(row.wrong_price),
      unmapped: Number(row.unmapped),
      error: Number(row.error_count),
    },
  };
}

const CHECK_SELECT = `
  SELECT f.*, u.username, u.display_name, v.version AS master_version
  FROM file_checks f
  JOIN users u ON u.id = f.user_id
  LEFT JOIN master_data_versions v ON v.id = f.master_data_version_id
`;

function mapLine(row: Record<string, unknown>): PriceCheckLine {
  const numberOrNull = (value: unknown) => value === null || value === undefined ? null : Number(value);
  return {
    sku: (row.sku as string | null) ?? null,
    productName: (row.product_name as string | null) ?? null,
    variantName: (row.variant_name as string | null) ?? null,
    retailPrice: numberOrNull(row.retail_price),
    comparePrice: numberOrNull(row.compare_price),
    masterPrice: numberOrNull(row.master_price),
    masterName: null,
    difference: numberOrNull(row.difference),
    status: row.status as PriceCheckLine["status"],
  };
}

async function insertLines(run: QueryFn, checkId: number, lines: PriceCheckLine[]): Promise<void> {
  const size = 200;
  for (let offset = 0; offset < lines.length; offset += size) {
    const chunk = lines.slice(offset, offset + size);
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((line, index) => {
      const base = index * 9;
      values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`);
      params.push(checkId, line.sku, line.productName, line.variantName, line.retailPrice, line.comparePrice, line.masterPrice, line.difference, line.status);
    });
    await run(
      `INSERT INTO file_check_items
        (check_id, sku, product_name, variant_name, retail_price, compare_price, master_price, difference, status)
       VALUES ${values.join(", ")}`,
      params,
    );
  }
}

export async function runPriceFileCheck(input: {
  buffer: Buffer;
  fileName: string;
  platform: PlatformId;
  discountPercent: number | null;
  userId: string;
  ip: string;
}): Promise<{ check: SavedPriceCheck; lines: PriceCheckLine[] }> {
  const active = await activeVersion(input.platform);
  if (!active) {
    const label = input.platform === "tiktok" ? "TikTok" : "Shopee";
    throw new ClientError(`Chưa có Master Data ${label}. Admin cần import file có cột Giá Bán Lẻ (VNĐ) của ${label} trước.`);
  }
  const discount = input.platform === "tiktok" ? input.discountPercent ?? NaN : 0;
  const matrix = readMatrix(input.buffer, input.fileName);
  const masterRows = await masterMap(active.id);
  const checked = checkPriceMatrix(
    matrix,
    input.platform,
    discount,
    [...masterRows.values()].map((row) => ({ sku: row.sku, name: row.name, price: masterComparePrice(row) })),
  );
  if (!checked.ok) throw new ClientError(checked.error);

  const savedId = await withTransaction(async (tx) => {
    const inserted = await tx<{ id: number }>(
      `INSERT INTO file_checks
        (user_id, platform, filename, discount_percent, master_data_version_id, total, ok, wrong_price, unmapped, error_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        input.userId,
        input.platform,
        input.fileName,
        input.platform === "tiktok" ? discount : null,
        active.id,
        checked.summary.total,
        checked.summary.ok,
        checked.summary.wrong_price,
        checked.summary.unmapped,
        checked.summary.error,
      ],
    );
    const checkId = Number(inserted[0].id);
    await insertLines(tx, checkId, checked.lines);
    return checkId;
  });
  await writeAudit(input.userId, "PRICE_CHECK", input.ip, {
    platform: input.platform,
    fileName: input.fileName,
    discountPercent: input.platform === "tiktok" ? discount : null,
    ...checked.summary,
  });
  const row = await one(`${CHECK_SELECT} WHERE f.id = $1`, [savedId]);
  return { check: mapSaved(row!), lines: checked.lines };
}

export async function listPriceChecks(userId: string, role: string, platform?: PlatformId): Promise<SavedPriceCheck[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (seesOwnData(role)) {
    params.push(userId);
    where.push(`f.user_id = $${params.length}`);
  }
  if (platform) {
    params.push(platform);
    where.push(`f.platform = $${params.length}`);
  }
  const sql = `${CHECK_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY f.id DESC LIMIT 50`;
  const rows = await query(sql, params);
  return rows.map(mapSaved);
}

export async function getPriceCheck(id: number, userId: string, role: string): Promise<{ check: SavedPriceCheck; lines: PriceCheckLine[] }> {
  const row = await one(`${CHECK_SELECT} WHERE f.id = $1`, [id]);
  if (!row) throw new ClientError("Không tìm thấy lần check giá", 404);
  if (seesOwnData(role) && String(row.user_id) !== userId) throw new ClientError("Không có quyền xem lần check này", 403);
  const lines = await query("SELECT * FROM file_check_items WHERE check_id = $1 ORDER BY id ASC", [id]);
  return { check: mapSaved(row), lines: lines.map(mapLine) };
}
