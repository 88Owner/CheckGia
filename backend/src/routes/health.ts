import type { FastifyInstance } from "fastify";
import { readConfig, type AppConfig } from "../config";
import { one } from "../db/pool";
import { getAuthUser } from "../auth/context";
import { backupDatabase } from "../services/backup";
import { query } from "../db/pool";
import { requireRole, requestIp } from "./guard";

export function registerHealthRoutes(app: FastifyInstance, config: AppConfig = readConfig()): void {
  app.get("/health", async () => {
    let database: "Connected" | "Down" = "Down";
    try {
      await one("SELECT 1 AS ok");
      database = "Connected";
    } catch {
      database = "Down";
    }
    return {
      ok: database === "Connected",
      service: "shopee-price-checker" as const,
      port: config.port,
      database,
      maxItems: config.maxItems,
      minDelayMs: config.minDelayMs,
      maxDelayMs: config.maxDelayMs,
    };
  });

  app.get("/api/admin/audit", { preHandler: requireRole("IT") }, async () => {
    const rows = await query(
      `SELECT a.id, a.action, a.created_at, a.ip, a.metadata, u.username
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.id DESC
       LIMIT 200`,
    );
    return { ok: true, logs: rows };
  });

  app.post("/api/admin/backup", { preHandler: requireRole("ADMIN", "IT") }, async (request) => {
    const user = getAuthUser(request)!;
    const file = await backupDatabase(user.id, requestIp(request));
    return { ok: true, file };
  });
}
