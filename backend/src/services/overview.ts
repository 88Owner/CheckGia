import { seesOwnData } from "../../../shared/roles";
import { readConfig } from "../config";
import { one, query } from "../db/pool";
import type { CheckRun } from "../../../shared/types";
import { listRuns } from "./check";

export async function overview(userId: string, role: string) {
  const own = seesOwnData(role);
  const mine = own ? "AND r.user_id = $1" : "";
  const params = own ? [userId] : [];
  const today = await one<{ checks: number; products: number; wrong_price: number; unmapped: number; errors: number }>(
    `SELECT COUNT(*)::int AS checks,
            COALESCE(SUM(r.total), 0)::int AS products,
            COALESCE(SUM(r.wrong_price), 0)::int AS wrong_price,
            COALESCE(SUM(r.unmapped), 0)::int AS unmapped,
            COALESCE(SUM(r.error), 0)::int AS errors
     FROM check_runs r
     WHERE r.started_at >= CURRENT_DATE ${mine}`,
    params,
  );
  const active = own
    ? await query(
      `SELECT u.display_name, u.username, r.status, r.scan_target,
              (SELECT COUNT(*)::int FROM scraped_products p WHERE p.run_id = r.id AND p.status <> 'NOT_FOUND') AS scanned
       FROM check_runs r JOIN users u ON u.id = r.user_id
       WHERE r.user_id = $1 AND r.status IN ('RUNNING', 'QUEUED')
       ORDER BY r.id DESC`,
      [userId],
    )
    : await query(
      `SELECT u.display_name, u.username, r.status, r.scan_target,
              (SELECT COUNT(*)::int FROM scraped_products p WHERE p.run_id = r.id AND p.status <> 'NOT_FOUND') AS scanned
       FROM check_runs r JOIN users u ON u.id = r.user_id
       WHERE r.status IN ('RUNNING', 'QUEUED')
       ORDER BY r.id DESC`,
    );
  const recent = await listRuns(userId, role);
  const dbOk = await one<{ ok: number }>("SELECT 1 AS ok");
  const running = await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM check_runs WHERE status = 'RUNNING'");
  return {
    today: today ?? { checks: 0, products: 0, wrong_price: 0, unmapped: 0, errors: 0 },
    active: active.map((row) => ({
      displayName: String(row.display_name),
      username: String(row.username),
      status: String(row.status),
      scanned: Number(row.scanned),
      scanTarget: row.scan_target === null ? null : Number(row.scan_target),
    })),
    recent: recent.slice(0, 12) satisfies CheckRun[],
    health: {
      server: "Online",
      database: dbOk ? "Connected" : "Down",
      backend: "Healthy",
      activeUsers: new Set(active.map((row) => String(row.username))).size,
      activeScans: Number(running?.n ?? 0),
      maxConcurrentScans: readConfig().maxConcurrentScans,
    },
  };
}
