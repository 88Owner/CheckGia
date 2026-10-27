import type { FastifyReply, FastifyRequest } from "fastify";
import type { UserRole } from "../../../shared/types";
import { clientIp, getAuthUser, readAuthUser, setAuthUser } from "../auth/context";
import { ClientError } from "../errors";

export async function requireUser(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const user = await readAuthUser(request);
  if (!user) throw new ClientError("Cần đăng nhập", 401);
  setAuthUser(request, user);
}

export function requireRole(...roles: UserRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await requireUser(request, reply);
    const user = getAuthUser(request);
    if (!user || !roles.includes(user.role)) {
      throw new ClientError("Không có quyền thực hiện thao tác này", 403);
    }
  };
}

export function requestIp(request: FastifyRequest): string {
  return clientIp(request);
}
