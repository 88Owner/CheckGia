import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { getAuthUser } from "../auth/context";
import { checkItems } from "../services/check";
import { requireRole, requestIp } from "./guard";

const ItemSchema = z.object({
  sku: z.string().nullable().optional(),
  model_id: z.union([z.string(), z.number()]).nullable().optional(),
  product_name: z.string().nullable().optional(),
  attributes: z.string().nullable().optional(),
  current_price: z.number().int().nonnegative().nullable().optional(),
  original_price: z.number().int().nonnegative().nullable().optional(),
});

const CheckBody = z.object({
  items: z.array(ItemSchema).max(5000),
  includeOk: z.boolean().optional(),
  includeNotFound: z.boolean().optional(),
  machineName: z.string().max(80).optional(),
  scanTarget: z.number().int().positive().max(5000).optional(),
});

const BatchBody = CheckBody.extend({
  runId: z.number().int().positive().optional(),
  finalize: z.boolean().optional(),
  newRun: z.boolean().optional(),
});

function toItems(items: z.infer<typeof ItemSchema>[]) {
  return items.map((item) => ({
    sku: item.sku ?? null,
    model_id: item.model_id === null || item.model_id === undefined ? null : String(item.model_id),
    product_name: item.product_name ?? null,
    attributes: item.attributes ?? null,
    current_price: item.current_price ?? null,
    original_price: item.original_price ?? null,
  }));
}

export function registerCheckRoutes(app: FastifyInstance): void {
  app.post("/api/check", { preHandler: requireRole("ADMIN", "USER", "SALE", "IT") }, async (request) => {
    const body = CheckBody.parse(request.body);
    const user = getAuthUser(request)!;
    const checked = await checkItems({
      userId: user.id,
      role: user.role,
      items: toItems(body.items),
      finalize: true,
      newRun: true,
      machineName: body.machineName ?? null,
      scanTarget: body.scanTarget ?? null,
      ip: requestIp(request),
    });
    return {
      ok: true,
      queued: checked.queued,
      message: checked.queued ? "Server đang bận, yêu cầu được đưa vào hàng đợi." : undefined,
      runId: checked.runId,
      summary: checked.summary,
      run: checked.run,
    };
  });

  app.post("/api/check/batch", { preHandler: requireRole("ADMIN", "USER", "SALE", "IT") }, async (request) => {
    const body = BatchBody.parse(request.body);
    const user = getAuthUser(request)!;
    const checked = await checkItems({
      userId: user.id,
      role: user.role,
      items: toItems(body.items),
      runId: body.runId,
      finalize: body.finalize ?? false,
      newRun: body.newRun ?? false,
      machineName: body.machineName ?? null,
      scanTarget: body.scanTarget ?? null,
      ip: requestIp(request),
    });
    return {
      ok: true,
      queued: checked.queued,
      message: checked.queued ? "Server đang bận, yêu cầu được đưa vào hàng đợi." : undefined,
      runId: checked.runId,
      summary: checked.summary,
    };
  });
}
