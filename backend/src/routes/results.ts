import type { FastifyInstance } from "fastify";
import { getAuthUser } from "../auth/context";
import { assertRunAccess, listResults } from "../services/check";
import { requireUser } from "./guard";

function flag(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === "1" || value === "true" || value === true;
}

export function registerResultRoutes(app: FastifyInstance): void {
  app.get("/api/results", { preHandler: requireUser }, async (request, reply) => {
    const query = request.query as { runId?: string; includeOk?: string; includeNotFound?: string };
    const user = getAuthUser(request)!;
    if (!query.runId) return reply.code(400).send({ ok: false, error: "Thiếu runId" });
    const run = await assertRunAccess(Number(query.runId), user.id, user.role);
    return {
      runId: run.id,
      run,
      results: await listResults(run.id, {
        includeOk: flag(query.includeOk, false),
        includeNotFound: flag(query.includeNotFound, true),
      }),
    };
  });

  app.get("/api/results/errors", { preHandler: requireUser }, async (request, reply) => {
    const query = request.query as { runId?: string; includeNotFound?: string };
    const user = getAuthUser(request)!;
    if (!query.runId) return reply.code(400).send({ ok: false, error: "Thiếu runId" });
    const run = await assertRunAccess(Number(query.runId), user.id, user.role);
    return {
      runId: run.id,
      summary: run,
      results: await listResults(run.id, {
        includeOk: false,
        includeNotFound: flag(query.includeNotFound, true),
      }),
    };
  });
}
