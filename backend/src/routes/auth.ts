import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { getAuthUser } from "../auth/context";
import { login, logout, refreshSession } from "../services/users";
import { requireUser, requestIp } from "./guard";

const LoginBody = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const RefreshBody = z.object({
  refreshToken: z.string().min(1),
});

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post("/api/auth/login", async (request) => {
    const body = LoginBody.parse(request.body);
    const result = await login(body.username, body.password, requestIp(request));
    return { ok: true, ...result };
  });

  app.post("/api/auth/refresh", async (request) => {
    const body = RefreshBody.parse(request.body);
    const result = await refreshSession(body.refreshToken);
    return { ok: true, ...result };
  });

  app.post("/api/auth/logout", { preHandler: requireUser }, async (request) => {
    const body = z.object({ refreshToken: z.string().optional() }).parse(request.body ?? {});
    const user = getAuthUser(request);
    await logout(body.refreshToken, user?.id ?? null, requestIp(request));
    return { ok: true };
  });

  app.get("/api/auth/me", { preHandler: requireUser }, async (request) => {
    return { ok: true, user: getAuthUser(request) };
  });
}
