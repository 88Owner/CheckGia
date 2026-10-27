import type { FastifyInstance } from "fastify";
import { getAuthUser } from "../auth/context";
import { query } from "../db/pool";
import { assertRunAccess, failRun, listRuns, promoteQueue, searchResults } from "../services/check";
import { listResults } from "../services/check";
import { overview } from "../services/overview";
import { requireUser, requestIp } from "./guard";

export function registerRunRoutes(app: FastifyInstance): void {
  app.get("/api/shops", { preHandler: requireUser }, async () => {
    const shops = await query("SELECT id, name, platform, enabled FROM shops ORDER BY id");
    return { ok: true, shops };
  });

  app.get("/api/runs", { preHandler: requireUser }, async (request) => {
    const user = getAuthUser(request)!;
    return { ok: true, runs: await listRuns(user.id, user.role) };
  });

  app.get("/api/runs/:id", { preHandler: requireUser }, async (request) => {
    const params = request.params as { id: string };
    const query = request.query as { includeOk?: string; includeNotFound?: string };
    const user = getAuthUser(request)!;
    const run = await assertRunAccess(Number(params.id), user.id, user.role);
    const includeOk = query.includeOk === "1" || query.includeOk === "true";
    const includeNotFound = query.includeNotFound === undefined ? true : query.includeNotFound === "1" || query.includeNotFound === "true";
    return { run, results: await listResults(run.id, { includeOk, includeNotFound }) };
  });

  app.post("/api/runs/:id/ticket", { preHandler: requireUser }, async (request) => {
    const params = request.params as { id: string };
    const user = getAuthUser(request)!;
    await promoteQueue();
    const run = await assertRunAccess(Number(params.id), user.id, user.role, true);
    return {
      ok: true,
      queued: run.status === "QUEUED",
      message: run.status === "QUEUED" ? "Server đang bận, yêu cầu được đưa vào hàng đợi." : undefined,
      runId: run.id,
      status: run.status,
    };
  });

  app.post("/api/runs/:id/fail", { preHandler: requireUser }, async (request) => {
    const params = request.params as { id: string };
    const user = getAuthUser(request)!;
    await failRun(Number(params.id), user.id, user.role, requestIp(request));
    return { ok: true };
  });

  app.get("/api/reports", { preHandler: requireUser }, async (request) => {
    const query = request.query as { from?: string; to?: string; userId?: string; status?: string; sku?: string; shopId?: string };
    const user = getAuthUser(request)!;
    const results = await searchResults(user.id, user.role, {
      from: query.from,
      to: query.to,
      userId: query.userId,
      status: query.status,
      sku: query.sku,
      shopId: query.shopId ? Number(query.shopId) : undefined,
    });
    return { ok: true, results };
  });

  app.get("/api/overview", { preHandler: requireUser }, async (request) => {
    const user = getAuthUser(request)!;
    return { ok: true, ...(await overview(user.id, user.role)) };
  });
}
