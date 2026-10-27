import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { getAuthUser } from "../auth/context";
import { canCheckPrices } from "../../../shared/roles";
import { getPriceCheck, listPriceChecks, runPriceFileCheck } from "../services/price-file";
import { ClientError } from "../errors";
import { requireUser, requestIp } from "./guard";

const Platform = z.enum(["shopee", "tiktok"]);

export function registerPriceFileRoutes(app: FastifyInstance): void {
  app.get("/api/price-checks", { preHandler: requireUser }, async (request) => {
    const user = getAuthUser(request)!;
    const query = z.object({ platform: Platform.optional() }).parse(request.query);
    return { ok: true, checks: await listPriceChecks(user.id, user.role, query.platform) };
  });

  app.get("/api/price-checks/:id", { preHandler: requireUser }, async (request) => {
    const user = getAuthUser(request)!;
    const params = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    return { ok: true, ...(await getPriceCheck(params.id, user.id, user.role)) };
  });

  app.post("/api/price-checks", { preHandler: requireUser }, async (request, reply) => {
    const user = getAuthUser(request)!;
    if (!canCheckPrices(user.role)) throw new ClientError("Không có quyền check giá", 403);
    const body = z.object({
      fileName: z.string().min(1).max(180),
      contentBase64: z.string().min(1),
      platform: Platform,
      discountPercent: z.number().min(0).max(100).nullable().optional(),
    }).parse(request.body);
    const lower = body.fileName.toLowerCase();
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".xls") && !lower.endsWith(".csv")) {
      return reply.code(400).send({ ok: false, error: "Chỉ hỗ trợ file .xlsx hoặc .csv" });
    }
    const buffer = Buffer.from(body.contentBase64, "base64");
    const result = await runPriceFileCheck({
      buffer,
      fileName: body.fileName,
      platform: body.platform,
      discountPercent: body.discountPercent ?? null,
      userId: user.id,
      ip: requestIp(request),
    });
    return { ok: true, ...result };
  });
}
