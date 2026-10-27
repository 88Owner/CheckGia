import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { getAuthUser } from "../auth/context";
import { createUser, listUsers, resetPassword, updateUser } from "../services/users";
import { requireRole, requestIp } from "./guard";

const Role = z.enum(["ADMIN", "USER", "VIEWER", "SALE", "IT"]);

export function registerUserRoutes(app: FastifyInstance): void {
  app.get("/api/users", { preHandler: requireRole("ADMIN", "IT") }, async () => {
    return { ok: true, users: await listUsers() };
  });

  app.post("/api/users", { preHandler: requireRole("ADMIN", "IT") }, async (request) => {
    const body = z.object({
      username: z.string().min(3),
      password: z.string().min(8),
      displayName: z.string().min(1),
      role: Role,
    }).parse(request.body);
    const actor = getAuthUser(request);
    const user = await createUser(body, actor!.id, requestIp(request));
    return { ok: true, user };
  });

  async function patchUser(request: { params: unknown; body: unknown }, actorId: string, ip: string) {
    const params = request.params as { id: string };
    const body = z.object({
      displayName: z.string().min(1).optional(),
      role: Role.optional(),
      enabled: z.boolean().optional(),
    }).parse(request.body);
    return updateUser(params.id, body, actorId, ip);
  }

  app.patch("/api/users/:id", { preHandler: requireRole("ADMIN", "IT") }, async (request) => {
    const actor = getAuthUser(request);
    const user = await patchUser(request, actor!.id, requestIp(request));
    return { ok: true, user };
  });

  app.post("/api/users/:id", { preHandler: requireRole("ADMIN", "IT") }, async (request) => {
    const actor = getAuthUser(request);
    const user = await patchUser(request, actor!.id, requestIp(request));
    return { ok: true, user };
  });

  app.post("/api/users/:id/reset-password", { preHandler: requireRole("ADMIN", "IT") }, async (request) => {
    const params = request.params as { id: string };
    const body = z.object({ password: z.string().min(8) }).parse(request.body);
    const actor = getAuthUser(request);
    await resetPassword(params.id, body.password, actor!.id, requestIp(request));
    return { ok: true };
  });
}
