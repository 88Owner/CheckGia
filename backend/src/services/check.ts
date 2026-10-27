import { findMasterByListing, masterComparePrice } from "../../../shared/match";
import { seesOwnData } from "../../../shared/roles";
import { dedupeKey } from "../../../shared/sku";
import { isVisibleStatus, summarize } from "../../../shared/status";
import type { CheckResult, CheckRun, ItemStatus, RunStatus, ScrapedItem, Summary } from "../../../shared/types";
import { readConfig } from "../config";
import { one, query, withTransaction, type QueryFn } from "../db/pool";
import { ClientError } from "../errors";
import { writeAudit } from "./audit";
import { masterMap, type CachedMasterRow } from "./master-data";

export interface ClassifiedItem extends ScrapedItem {
  standard_price: number | null;
  retail_price: number | null;
  difference: number | null;
  status: ItemStatus;
  dedupe_key: string;
}

function displayName(productName: string | null, attributes: string | null): string | null {
  const selected = attributes?.split(/\s*\|\|\s*/).filter(Boolean).join(", ") || null;
  return [productName, selected].filter(Boolean).join(" · ") || null;
}

export function classifyItem(item: ScrapedItem, master: Map<string, CachedMasterRow>): ClassifiedItem {
  const modelId = item.model_id?.trim() || null;
  const productName = item.product_name?.trim() || null;
  const attributes = item.attributes?.trim() || null;
  const found = productName || attributes
    ? findMasterByListing(productName ?? "", attributes, master.values()) ?? undefined
    : undefined;
  const resolvedSku = found?.sku ?? null;
  const base = {
    sku: resolvedSku || null,
    model_id: modelId,
    product_name: displayName(productName, attributes),
    current_price: item.current_price,
    original_price: item.original_price,
    dedupe_key: dedupeKey({
      sku: resolvedSku,
      model_id: modelId,
      product_name: productName,
      attributes,
      current_price: item.current_price,
      original_price: item.original_price,
    }),
  };
  if (!found) {
    return {
      ...base,
      standard_price: null,
      retail_price: null,
      difference: null,
      status: productName || attributes ? "UNMAPPED" : "MISSING_SKU",
    };
  }
  if (item.current_price === null || item.current_price === undefined) {
    return {
      ...base,
      standard_price: found?.standard_price ?? null,
      retail_price: found?.retail_price ?? null,
      difference: null,
      status: "PRICE_PARSE_ERROR",
    };
  }
  const difference = item.current_price - masterComparePrice(found);
  return {
    ...base,
    standard_price: found.standard_price,
    retail_price: found.retail_price,
    difference,
    status: difference === 0 ? "OK" : "WRONG_PRICE",
  };
}

const RUN_SELECT = `
  SELECT r.*, u.username, u.display_name, s.name AS shop_name, v.version AS master_version
  FROM check_runs r
  JOIN users u ON u.id = r.user_id
  LEFT JOIN shops s ON s.id = r.shop_id
  LEFT JOIN master_data_versions v ON v.id = r.master_data_version_id
`;

function mapRun(row: Record<string, unknown>): CheckRun {
  return {
    id: Number(row.id),
    user_id: String(row.user_id),
    username: String(row.username ?? ""),
    display_name: String(row.display_name ?? ""),
    machine_name: row.machine_name ? String(row.machine_name) : null,
    shop_name: row.shop_name ? String(row.shop_name) : null,
    master_version: row.master_version ? String(row.master_version) : null,
    started_at: new Date(String(row.started_at)).toISOString(),
    finished_at: row.finished_at ? new Date(String(row.finished_at)).toISOString() : null,
    total: Number(row.total),
    ok: Number(row.ok),
    wrong_price: Number(row.wrong_price),
    unmapped: Number(row.unmapped),
    not_found: Number(row.not_found),
    error: Number(row.error),
    status: row.status as RunStatus,
    scan_target: row.scan_target === null || row.scan_target === undefined ? null : Number(row.scan_target),
  };
}

async function recount(runId: number, tx: QueryFn = query): Promise<Summary> {
  const rows = await tx<{ status: string }>("SELECT status FROM scraped_products WHERE run_id = $1", [runId]);
  return summarize(rows.map((row) => row.status));
}

async function saveSummary(runId: number, summary: Summary, status: RunStatus | null, tx: QueryFn = query): Promise<void> {
  await tx(
    `UPDATE check_runs
     SET total = $2, ok = $3, wrong_price = $4, unmapped = $5, not_found = $6, error = $7,
         status = COALESCE($8, status),
         finished_at = CASE WHEN $8 IN ('COMPLETED', 'FAILED') THEN NOW() ELSE finished_at END
     WHERE id = $1`,
    [runId, summary.total, summary.ok, summary.wrong_price, summary.unmapped, summary.not_found, summary.error, status],
  );
}

export async function promoteQueue(): Promise<void> {
  const limit = readConfig().maxConcurrentScans;
  await withTransaction(async (tx) => {
    await tx("SELECT pg_advisory_xact_lock(878701)");
    const running = await tx<{ n: number }>("SELECT COUNT(*)::int AS n FROM check_runs WHERE status = 'RUNNING'");
    const slots = limit - Number(running[0]?.n ?? 0);
    if (slots <= 0) return;
    await tx(
      `UPDATE check_runs SET status = 'RUNNING'
       WHERE id IN (
         SELECT id FROM check_runs WHERE status = 'QUEUED' ORDER BY id ASC LIMIT $1
       )`,
      [slots],
    );
  });
}

export async function createRun(input: {
  userId: string;
  machineName: string | null;
  scanTarget: number | null;
  ip: string;
}): Promise<{ run: CheckRun; queued: boolean }> {
  const active = await one<{ id: number }>("SELECT id FROM master_data_versions WHERE status = 'ACTIVE' AND platform = 'shopee'");
  if (!active) throw new ClientError("Chưa có Master Data. Admin cần upload file giá trước.");
  const shop = await one<{ id: number }>("SELECT id FROM shops WHERE enabled = TRUE ORDER BY id ASC LIMIT 1");
  const limit = readConfig().maxConcurrentScans;
  const created = await withTransaction(async (tx) => {
    await tx("SELECT pg_advisory_xact_lock(878701)");
    const running = await tx<{ n: number }>("SELECT COUNT(*)::int AS n FROM check_runs WHERE status = 'RUNNING'");
    const status: RunStatus = Number(running[0]?.n ?? 0) >= limit ? "QUEUED" : "RUNNING";
    const rows = await tx(
      `INSERT INTO check_runs (user_id, shop_id, machine_name, master_data_version_id, status, scan_target)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [input.userId, shop?.id ?? null, input.machineName, active.id, status, input.scanTarget],
    );
    return { id: Number(rows[0].id), status };
  });
  await writeAudit(input.userId, "START_CHECK", input.ip, { runId: created.id, status: created.status });
  const run = await getRun(created.id);
  if (!run) throw new ClientError("Không tạo được lượt kiểm tra", 500);
  return { run, queued: created.status === "QUEUED" };
}

export async function getRun(runId: number): Promise<CheckRun | null> {
  const row = await one(`${RUN_SELECT} WHERE r.id = $1`, [runId]);
  return row ? mapRun(row) : null;
}

export function canReadRun(role: string, ownerId: string, userId: string): boolean {
  if (seesOwnData(role)) return ownerId === userId;
  return true;
}

export async function assertRunAccess(runId: number, userId: string, role: string, write = false): Promise<CheckRun> {
  const run = await getRun(runId);
  if (!run) throw new ClientError("Không tìm thấy lần kiểm tra", 404);
  if (write && run.user_id !== userId) throw new ClientError("Không có quyền ghi vào lượt kiểm tra này", 403);
  if (!write && !canReadRun(role, run.user_id, userId)) throw new ClientError("Không có quyền xem lượt kiểm tra này", 403);
  return run;
}

export async function checkItems(input: {
  userId: string;
  role: string;
  items: ScrapedItem[];
  runId?: number;
  finalize?: boolean;
  newRun?: boolean;
  machineName?: string | null;
  scanTarget?: number | null;
  ip: string;
}): Promise<{ runId: number; summary: Summary; queued: boolean; run: CheckRun }> {
  let run: CheckRun;
  if (input.newRun || !input.runId) {
    if (input.role === "VIEWER") throw new ClientError("Viewer không được chạy kiểm tra giá", 403);
    const created = await createRun({
      userId: input.userId,
      machineName: input.machineName ?? null,
      scanTarget: input.scanTarget ?? null,
      ip: input.ip,
    });
    run = created.run;
    if (created.queued) {
      return { runId: run.id, summary: emptySummaryFromRun(run), queued: true, run };
    }
  } else {
    run = await assertRunAccess(input.runId, input.userId, input.role, true);
    if (run.status === "QUEUED") {
      await promoteQueue();
      run = await assertRunAccess(run.id, input.userId, input.role, true);
      if (run.status === "QUEUED") return { runId: run.id, summary: emptySummaryFromRun(run), queued: true, run };
    }
    if (run.status === "FAILED" || run.status === "COMPLETED") {
      throw new ClientError("Lượt kiểm tra này đã kết thúc");
    }
  }

  if (!run.master_version) throw new ClientError("Lượt kiểm tra không có Master Data");
  const version = await one<{ id: number }>("SELECT id FROM master_data_versions WHERE version = $1", [run.master_version]);
  if (!version) throw new ClientError("Không tìm thấy version Master Data của lượt này", 404);
  const master = await masterMap(version.id);

  await withTransaction(async (tx) => {
    for (const item of input.items) {
      const classified = classifyItem(item, master);
      await tx(
        `INSERT INTO scraped_products (
           run_id, sku, model_id, product_name, current_price, original_price,
           standard_price, retail_price, difference, status, dedupe_key
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (run_id, dedupe_key) DO NOTHING`,
        [
          run.id,
          classified.sku,
          classified.model_id,
          classified.product_name,
          classified.current_price,
          classified.original_price,
          classified.standard_price,
          classified.retail_price,
          classified.difference,
          classified.status,
          classified.dedupe_key,
        ],
      );
    }
    const summary = await recount(run.id, tx);
    await saveSummary(run.id, summary, input.finalize ? "COMPLETED" : null, tx);
  });

  if (input.finalize) {
    await writeAudit(input.userId, "FINISH_CHECK", input.ip, { runId: run.id });
    await promoteQueue();
  }
  const fresh = await getRun(run.id);
  return {
    runId: run.id,
    summary: summaryFromRun(fresh ?? run),
    queued: false,
    run: fresh ?? run,
  };
}

function emptySummaryFromRun(run: CheckRun): Summary {
  return summaryFromRun(run);
}

function summaryFromRun(run: CheckRun): Summary {
  return {
    total: run.total,
    ok: run.ok,
    wrong_price: run.wrong_price,
    unmapped: run.unmapped,
    not_found: run.not_found,
    error: run.error,
  };
}

export async function failRun(runId: number, userId: string, role: string, ip: string): Promise<void> {
  const run = await assertRunAccess(runId, userId, role, true);
  if (run.status === "COMPLETED" || run.status === "FAILED") return;
  await query("UPDATE check_runs SET status = 'FAILED', finished_at = NOW() WHERE id = $1", [runId]);
  await writeAudit(userId, "FINISH_CHECK", ip, { runId, failed: true });
  await promoteQueue();
}

export async function listResults(
  runId: number,
  options: { includeOk: boolean; includeNotFound: boolean },
): Promise<CheckResult[]> {
  const rows = await query<Record<string, unknown>>(
    "SELECT * FROM scraped_products WHERE run_id = $1 ORDER BY id ASC",
    [runId],
  );
  return rows
    .map((row) => ({
      sku: (row.sku as string | null) ?? null,
      model_id: (row.model_id as string | null) ?? null,
      product_name: (row.product_name as string | null) ?? null,
      current_price: row.current_price === null || row.current_price === undefined ? null : Number(row.current_price),
      original_price: row.original_price === null || row.original_price === undefined ? null : Number(row.original_price),
      standard_price: row.standard_price === null || row.standard_price === undefined ? null : Number(row.standard_price),
      retail_price: row.retail_price === null || row.retail_price === undefined ? null : Number(row.retail_price),
      difference: row.difference === null || row.difference === undefined ? null : Number(row.difference),
      status: row.status as ItemStatus,
      checked_at: new Date(String(row.checked_at)).toISOString(),
    }))
    .filter((row) => isVisibleStatus(row.status, options));
}

export async function listRuns(userId: string, role: string): Promise<CheckRun[]> {
  const own = seesOwnData(role);
  const sql = own
    ? `${RUN_SELECT} WHERE r.user_id = $1 ORDER BY r.id DESC LIMIT 100`
    : `${RUN_SELECT} ORDER BY r.id DESC LIMIT 100`;
  const rows = await query(sql, own ? [userId] : []);
  return rows.map(mapRun);
}

export interface ResultFilter {
  from?: string;
  to?: string;
  userId?: string;
  status?: string;
  sku?: string;
  shopId?: number;
}

export async function searchResults(actorId: string, role: string, filter: ResultFilter): Promise<CheckResult[]> {
  const where = ["1=1"];
  const params: unknown[] = [];
  if (seesOwnData(role)) {
    params.push(actorId);
    where.push(`r.user_id = $${params.length}`);
  } else if (filter.userId) {
    params.push(filter.userId);
    where.push(`r.user_id = $${params.length}`);
  }
  if (filter.from) {
    params.push(filter.from);
    where.push(`r.started_at >= $${params.length}`);
  }
  if (filter.to) {
    params.push(filter.to);
    where.push(`r.started_at < ($${params.length}::date + INTERVAL '1 day')`);
  }
  if (filter.status) {
    params.push(filter.status);
    where.push(`p.status = $${params.length}`);
  } else {
    where.push("p.status <> 'OK'");
  }
  if (filter.sku) {
    params.push(`%${filter.sku.trim()}%`);
    where.push(`p.sku ILIKE $${params.length}`);
  }
  if (filter.shopId) {
    params.push(filter.shopId);
    where.push(`r.shop_id = $${params.length}`);
  }
  const rows = await query<Record<string, unknown>>(
    `SELECT p.* FROM scraped_products p
     JOIN check_runs r ON r.id = p.run_id
     WHERE ${where.join(" AND ")}
     ORDER BY p.id DESC
     LIMIT 1000`,
    params,
  );
  return listResultsFromRows(rows);
}

function listResultsFromRows(rows: Record<string, unknown>[]): CheckResult[] {
  return rows.map((row) => ({
    sku: (row.sku as string | null) ?? null,
    model_id: (row.model_id as string | null) ?? null,
    product_name: (row.product_name as string | null) ?? null,
    current_price: row.current_price === null || row.current_price === undefined ? null : Number(row.current_price),
    original_price: row.original_price === null || row.original_price === undefined ? null : Number(row.original_price),
    standard_price: row.standard_price === null || row.standard_price === undefined ? null : Number(row.standard_price),
    retail_price: row.retail_price === null || row.retail_price === undefined ? null : Number(row.retail_price),
    difference: row.difference === null || row.difference === undefined ? null : Number(row.difference),
    status: row.status as ItemStatus,
    checked_at: new Date(String(row.checked_at)).toISOString(),
  }));
}
