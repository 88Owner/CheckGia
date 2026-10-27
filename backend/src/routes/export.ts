import type { FastifyInstance } from "fastify";
import { seesOwnData } from "../../../shared/roles";
import { getAuthUser } from "../auth/context";
import { buildErrorWorkbook } from "../services/export-errors";
import { assertRunAccess, searchResults } from "../services/check";
import { writeAudit } from "../services/audit";
import { requireUser, requestIp } from "./guard";

export function registerExportRoutes(app: FastifyInstance): void {
  app.get("/api/export/errors", { preHandler: requireUser }, async (request, reply) => {
    const query = request.query as { runId?: string; includeNotFound?: string };
    const user = getAuthUser(request)!;
    if (!query.runId) return reply.code(400).send({ ok: false, error: "Thiếu runId" });
    const run = await assertRunAccess(Number(query.runId), user.id, user.role);
    if (seesOwnData(user.role) && run.user_id !== user.id) {
      return reply.code(403).send({ ok: false, error: "Chỉ export được kết quả của chính mình" });
    }
    const includeNotFound = query.includeNotFound === undefined ? true : query.includeNotFound === "1" || query.includeNotFound === "true";
    const { listResults } = await import("../services/check");
    const results = await listResults(run.id, { includeOk: true, includeNotFound });
    const buffer = await buildErrorWorkbook(results);
    await writeAudit(user.id, "EXPORT_REPORT", requestIp(request), { runId: run.id, scope: "run" });
    return reply
      .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("Content-Disposition", 'attachment; filename="shopee_price_errors.xlsx"')
      .send(buffer);
  });

  app.get("/api/export/report", { preHandler: requireUser }, async (request, reply) => {
    const query = request.query as { from?: string; to?: string; userId?: string; status?: string; sku?: string };
    const user = getAuthUser(request)!;
    if (seesOwnData(user.role) && query.userId && query.userId !== user.id) {
      return reply.code(403).send({ ok: false, error: "Chỉ export được kết quả của chính mình" });
    }
    const results = await searchResults(user.id, user.role, query);
    const buffer = await buildErrorWorkbook(results);
    await writeAudit(user.id, "EXPORT_REPORT", requestIp(request), { scope: seesOwnData(user.role) ? "mine" : "filtered" });
    return reply
      .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("Content-Disposition", 'attachment; filename="shopee_price_errors.xlsx"')
      .send(buffer);
  });
}
