import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { readConfig } from "../config";
import { getAuthUser } from "../auth/context";
import { activeVersion, activateVersion, listPriceGroups, listVersions, parseMasterFile, saveMasterVersion, searchProducts, updateGroupPrices } from "../services/master-data";
import { writeAudit } from "../services/audit";
import { requireRole, requireUser, requestIp } from "./guard";

const Platform = z.enum(["shopee", "tiktok"]);

const ImportBody = z.object({
  fileName: z.string().min(1),
  contentBase64: z.string().min(1),
  platform: Platform.optional(),
  mapping: z.object({
    skuColumn: z.string().min(1),
    priceColumn: z.string().min(1),
    retailColumn: z.string().nullable().optional(),
    nameColumn: z.string().nullable().optional(),
  }).optional(),
});

export function registerMasterDataRoutes(app: FastifyInstance): void {
  app.get("/api/master-data/versions", { preHandler: requireUser }, async (request) => {
    const query = z.object({ platform: Platform.optional() }).parse(request.query);
    const platform = query.platform ?? "shopee";
    const active = await activeVersion(platform);
    return { ok: true, active, versions: await listVersions(platform) };
  });

  app.get("/api/master-data/products", { preHandler: requireUser }, async (request) => {
    const query = z.object({
      platform: Platform.optional(),
      name: z.string().max(120).optional(),
      sku: z.string().max(120).optional(),
      pattern: z.string().max(120).optional(),
      type: z.string().max(120).optional(),
      size: z.string().max(120).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
      offset: z.coerce.number().int().min(0).max(100000).optional(),
    }).parse(request.query);
    const platform = query.platform ?? "shopee";
    const actor = getAuthUser(request);
    const result = await searchProducts({
      platform,
      name: query.name,
      sku: query.sku,
      pattern: query.pattern,
      typeName: query.type,
      size: query.size,
      limit: query.limit ?? 50,
      offset: query.offset ?? 0,
    });
    if ((query.name ?? "").trim() || (query.sku ?? "").trim()) {
      await writeAudit(actor!.id, "VIEW_MASTER", requestIp(request), { platform, name: query.name ?? "", sku: query.sku ?? "" });
    }
    return { ok: true, ...result };
  });

  app.get("/api/master-data/price-groups", { preHandler: requireRole("ADMIN", "IT") }, async (request) => {
    const query = z.object({ platform: Platform.optional() }).parse(request.query);
    return { ok: true, groups: await listPriceGroups(query.platform ?? "shopee") };
  });

  const PriceBody = z.object({
    platform: Platform.optional(),
    typeName: z.string().max(120),
    sizeLabel: z.string().max(120),
    patterns: z.array(z.string().min(1).max(120)).min(1).max(80),
    retailPrice: z.number().int().min(0).max(100_000_000),
    standardPrice: z.number().int().min(0).max(100_000_000),
  });

  app.post("/api/master-data/prices", { preHandler: requireRole("ADMIN", "IT") }, async (request) => {
    const body = PriceBody.parse(request.body);
    const actor = getAuthUser(request);
    const result = await updateGroupPrices({
      platform: body.platform ?? "shopee",
      typeName: body.typeName,
      sizeLabel: body.sizeLabel,
      patterns: body.patterns,
      retailPrice: body.retailPrice,
      standardPrice: body.standardPrice,
      userId: actor!.id,
      ip: requestIp(request),
    });
    return { ok: true, ...result };
  });

  app.post("/api/master-data/import", { preHandler: requireRole("ADMIN", "IT") }, async (request, reply) => {
    const body = ImportBody.parse(request.body);
    const lower = body.fileName.toLowerCase();
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".xls") && !lower.endsWith(".csv")) {
      return reply.code(400).send({ ok: false, error: "Chỉ hỗ trợ file .xlsx hoặc .csv" });
    }
    const buffer = Buffer.from(body.contentBase64, "base64");
    const parsed = parseMasterFile(buffer, body.fileName, body.mapping);
    if (!parsed.ok) return parsed;
    const actor = getAuthUser(request);
    const version = await saveMasterVersion(parsed, actor!.id, requestIp(request), body.platform ?? "shopee");
    return {
      ok: true,
      imported: version.totalSku,
      skipped: parsed.skipped,
      fileName: parsed.fileName,
      skuColumn: parsed.skuColumn,
      priceColumn: parsed.priceColumn,
      retailColumn: parsed.retailColumn,
      patternCount: parsed.rows.filter((row) => row.patternName).length,
      typeCount: parsed.rows.filter((row) => row.typeName).length,
      sizeCount: parsed.rows.filter((row) => row.sizeLabel).length,
      version,
    };
  });

  app.post("/api/master-data/versions/:id/activate", { preHandler: requireRole("ADMIN", "IT") }, async (request) => {
    const params = request.params as { id: string };
    const actor = getAuthUser(request);
    const version = await activateVersion(Number(params.id), actor!.id, requestIp(request));
    return { ok: true, version };
  });

  app.get("/api/bootstrap", { preHandler: requireUser }, async (request) => {
    const config = readConfig();
    const active = await activeVersion();
    return {
      ok: true,
      user: getAuthUser(request),
      masterCount: active?.totalSku ?? 0,
      masterFileName: active?.filename ?? null,
      masterVersion: active?.version ?? null,
      maxItems: config.maxItems,
      minDelayMs: config.minDelayMs,
      maxDelayMs: config.maxDelayMs,
    };
  });
}
