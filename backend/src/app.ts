import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { isAllowedOrigin, readConfig, type AppConfig } from "./config";
import { ClientError } from "./errors";
import { registerAuthRoutes } from "./routes/auth";
import { registerCheckRoutes } from "./routes/check";
import { registerExportRoutes } from "./routes/export";
import { registerHealthRoutes } from "./routes/health";
import { registerMasterDataRoutes } from "./routes/master-data";
import { registerPriceFileRoutes } from "./routes/price-file";
import { registerResultRoutes } from "./routes/results";
import { registerRunRoutes } from "./routes/runs";
import { registerUserRoutes } from "./routes/users";

export function buildApp(config: AppConfig = readConfig()): FastifyInstance {
  const app = Fastify({
    logger: process.env.VITEST ? false : { level: "info" },
    bodyLimit: 20 * 1024 * 1024,
    trustProxy: 1,
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    const originHeader = request.headers.origin;
    const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
    const allowed = isAllowedOrigin(origin, { extensionId: config.extensionId, allowedOrigins: config.allowedOrigins });
    if (origin && !allowed) {
      return reply.code(403).send({ ok: false, error: "Origin không được phép" });
    }
    if (origin && allowed) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Vary", "Origin");
      reply.header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
      reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    }
    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      const message = error.issues.map((issue) => {
        const field = String(issue.path[0] ?? "");
        if (field === "password") return "Mật khẩu cần ít nhất 8 ký tự";
        if (field === "username") return "Username cần ít nhất 3 ký tự";
        if (field === "displayName") return "Cần nhập tên hiển thị";
        if (field === "role") return "Quyền không hợp lệ";
        if (field === "retailPrice" || field === "standardPrice") return "Giá phải là số nguyên";
        if (field === "patterns") return "Chọn ít nhất một mẫu";
        return "Dữ liệu gửi lên không hợp lệ";
      })[0] ?? "Dữ liệu gửi lên không hợp lệ";
      return reply.code(400).send({ ok: false, error: message });
    }
    if (error instanceof ClientError) {
      return reply.code(error.statusCode).send({ ok: false, error: error.message });
    }
    const code = (error as { code?: string }).code;
    if (code === "23505") {
      return reply.code(400).send({ ok: false, error: "Dữ liệu đã tồn tại" });
    }
    app.log.error(error);
    return reply.code(500).send({ ok: false, error: "Backend gặp lỗi" });
  });

  registerHealthRoutes(app, config);
  registerAuthRoutes(app);
  registerUserRoutes(app);
  registerMasterDataRoutes(app);
  registerPriceFileRoutes(app);
  registerCheckRoutes(app);
  registerResultRoutes(app);
  registerRunRoutes(app);
  registerExportRoutes(app);
  return app;
}
