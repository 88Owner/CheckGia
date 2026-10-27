import type { FastifyRequest } from "fastify";
import type { UserRole } from "../../../shared/types";
import { verifyAccessToken } from "../auth/tokens";
import { readConfig } from "../config";
import { one } from "../db/pool";

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
}

const users = new WeakMap<FastifyRequest, AuthUser>();

export function setAuthUser(request: FastifyRequest, user: AuthUser): void {
  users.set(request, user);
}

export function getAuthUser(request: FastifyRequest): AuthUser | null {
  return users.get(request) ?? null;
}

export async function readAuthUser(request: FastifyRequest): Promise<AuthUser | null> {
  const cached = users.get(request);
  if (cached) return cached;
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const claims = verifyAccessToken(header.slice(7), readConfig().jwtSecret);
  if (!claims) return null;
  const row = await one<{ id: string; username: string; display_name: string; role: UserRole; enabled: boolean }>(
    "SELECT id, username, display_name, role, enabled FROM users WHERE id = $1",
    [claims.sub],
  );
  if (!row?.enabled) return null;
  const user = { id: row.id, username: row.username, displayName: row.display_name, role: row.role };
  users.set(request, user);
  return user;
}

export function clientIp(request: FastifyRequest): string {
  return request.ip || "";
}
