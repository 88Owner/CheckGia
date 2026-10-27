import { copyFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { skuKey } from "../../../shared/sku";
import { one, withTransaction } from "../db/pool";

export async function importLegacySqlite(filePath: string): Promise<number> {
  if (!existsSync(filePath)) return 0;
  const existing = await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM master_data_versions");
  if ((existing?.n ?? 0) > 0) return 0;
  const { DatabaseSync } = await import("node:sqlite");
  const copyPath = join(tmpdir(), "legacy-checker.db");
  let db: InstanceType<typeof DatabaseSync>;
  try {
    for (const suffix of ["", "-wal", "-shm"]) {
      if (existsSync(`${filePath}${suffix}`)) copyFileSync(`${filePath}${suffix}`, `${copyPath}${suffix}`);
    }
    db = new DatabaseSync(copyPath, { readOnly: true });
  } catch (error) {
    console.error("Bỏ qua import SQLite cũ vì không đọc được file:", error);
    return 0;
  }
  let rows: Array<{ sku: string; standard_price: number; name: string | null }>;
  try {
    rows = db.prepare("SELECT sku, standard_price, name FROM master_products").all() as Array<{
      sku: string;
      standard_price: number;
      name: string | null;
    }>;
    db.close();
  } catch (error) {
    db.close();
    console.error("Bỏ qua import SQLite cũ vì không đọc được bảng master_products:", error);
    return 0;
  }
  if (rows.length === 0) return 0;
  await withTransaction(async (tx) => {
    const inserted = await tx<{ id: number }>(
      `INSERT INTO master_data_versions (version, filename, total_sku, status)
       VALUES ('MD-LEGACY-IMPORT', 'checker.db', $1, 'ACTIVE') RETURNING id`,
      [rows.length],
    );
    for (const row of rows) {
      await tx(
        `INSERT INTO master_products (version_id, sku, sku_key, standard_price, retail_price, name)
         VALUES ($1, $2, $3, $4, NULL, $5)`,
        [inserted[0].id, row.sku, skuKey(row.sku), row.standard_price, row.name],
      );
    }
  });
  return rows.length;
}
