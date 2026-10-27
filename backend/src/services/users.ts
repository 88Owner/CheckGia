import type { UserRole } from "../../../shared/types";
import { hashPassword, verifyPassword } from "../auth/passwords";
import { hashToken, newRefreshToken, signAccessToken } from "../auth/tokens";
import { readConfig } from "../config";
import { one, query } from "../db/pool";
import { ClientError } from "../errors";
import { writeAudit } from "./audit";

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  enabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  role: UserRole;
  enabled: boolean;
  created_at: Date | string;
  last_login_at: Date | string | null;
  failed_login_count: number;
  locked_until: Date | string | null;
}

function toPublic(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    enabled: row.enabled,
    createdAt: new Date(row.created_at).toISOString(),
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
  };
}

const loginHits = new Map<string, { count: number; resetAt: number }>();

function tooManyIpAttempts(ip: string): boolean {
  const now = Date.now();
  const current = loginHits.get(ip);
  if (!current || current.resetAt < now) {
    loginHits.set(ip, { count: 1, resetAt: now + 10 * 60 * 1000 });
    return false;
  }
  current.count += 1;
  return current.count > 20;
}

export async function issueTokens(user: PublicUser): Promise<{ accessToken: string; refreshToken: string }> {
  const config = readConfig();
  const accessToken = signAccessToken(
    { sub: user.id, username: user.username, role: user.role },
    config.jwtSecret,
    config.accessTtlSec,
  );
  const refreshToken = newRefreshToken();
  await query(
    "INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + ($3 || ' seconds')::interval)",
    [user.id, hashToken(refreshToken), String(config.refreshTtlSec)],
  );
  return { accessToken, refreshToken };
}

export async function login(username: string, password: string, ip: string): Promise<{
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}> {
  if (tooManyIpAttempts(ip)) throw new ClientError("Đăng nhập tạm thời bị giới hạn. Thử lại sau.", 429);
  const row = await one<UserRow>("SELECT * FROM users WHERE username = $1", [username.trim().toLowerCase()]);
  if (row?.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    throw new ClientError("Tài khoản đang bị khóa tạm thời. Thử lại sau.", 429);
  }
  const delayMs = Math.min(4000, 200 * 2 ** Math.max(0, (row?.failed_login_count ?? 1) - 1));
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  const valid = row ? await verifyPassword(password, row.password_hash) : false;
  if (!row || !valid || !row.enabled) {
    if (row) {
      const nextCount = row.failed_login_count + 1;
      const lock = nextCount >= 5 ? "NOW() + INTERVAL '15 minutes'" : "NULL";
      await query(
        `UPDATE users SET failed_login_count = $2, locked_until = ${lock} WHERE id = $1`,
        [row.id, nextCount],
      );
    }
    throw new ClientError("Sai tên đăng nhập hoặc mật khẩu", 401);
  }
  await query("UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = NOW() WHERE id = $1", [row.id]);
  const user = toPublic(row);
  const tokens = await issueTokens(user);
  await writeAudit(user.id, "LOGIN", ip, { username: user.username });
  return { ...tokens, user };
}

export async function refreshSession(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; user: PublicUser }> {
  const row = await one<{ user_id: string; expires_at: string; revoked_at: string | null }>(
    "SELECT user_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = $1",
    [hashToken(refreshToken)],
  );
  if (!row || row.revoked_at || new Date(row.expires_at).getTime() < Date.now()) {
    throw new ClientError("Phiên đăng nhập đã hết hạn", 401);
  }
  await query("UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1", [hashToken(refreshToken)]);
  const userRow = await one<UserRow>("SELECT * FROM users WHERE id = $1 AND enabled = TRUE", [row.user_id]);
  if (!userRow) throw new ClientError("Tài khoản không còn hoạt động", 401);
  const user = toPublic(userRow);
  return { ...(await issueTokens(user)), user };
}

export async function logout(refreshToken: string | undefined, userId: string | null, ip: string): Promise<void> {
  if (refreshToken) {
    await query("UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1", [hashToken(refreshToken)]);
  }
  await writeAudit(userId, "LOGOUT", ip, {});
}

export async function listUsers(): Promise<PublicUser[]> {
  const rows = await query<UserRow>("SELECT * FROM users ORDER BY username ASC");
  return rows.map(toPublic);
}

export async function createUser(input: {
  username: string;
  password: string;
  displayName: string;
  role: UserRole;
}, actorId: string, ip: string): Promise<PublicUser> {
  if (input.password.length < 8) throw new ClientError("Mật khẩu cần ít nhất 8 ký tự");
  const username = input.username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new ClientError("Username chỉ gồm chữ thường, số, dấu chấm, gạch");
  const passwordHash = await hashPassword(input.password);
  try {
    const rows = await query<UserRow>(
      `INSERT INTO users (username, password_hash, display_name, role)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [username, passwordHash, input.displayName.trim(), input.role],
    );
    await writeAudit(actorId, "CREATE_USER", ip, { username, role: input.role });
    return toPublic(rows[0]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("duplicate")) {
      throw new ClientError("Username đã tồn tại");
    }
    throw error;
  }
}

export async function updateUser(
  id: string,
  patch: { displayName?: string; role?: UserRole; enabled?: boolean },
  actorId: string,
  ip: string,
): Promise<PublicUser> {
  const current = await one<UserRow>("SELECT * FROM users WHERE id = $1", [id]);
  if (!current) throw new ClientError("Không tìm thấy user", 404);
  if (current.role === "ADMIN" && (patch.role && patch.role !== "ADMIN" || patch.enabled === false)) {
    const admins = await one<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM users WHERE role = 'ADMIN' AND enabled = TRUE AND id <> $1",
      [id],
    );
    if ((admins?.n ?? 0) < 1) throw new ClientError("Phải còn ít nhất một Admin đang hoạt động");
  }
  const rows = await query<UserRow>(
    `UPDATE users
     SET display_name = COALESCE($2::text, display_name),
         role = COALESCE($3::text, role),
         enabled = COALESCE($4::boolean, enabled)
     WHERE id = $1
     RETURNING *`,
    [id, patch.displayName ?? null, patch.role ?? null, patch.enabled ?? null],
  );
  await writeAudit(actorId, patch.enabled === false ? "DISABLE_USER" : "UPDATE_USER", ip, {
    username: current.username,
    role: patch.role,
    enabled: patch.enabled,
  });
  return toPublic(rows[0]);
}

export async function resetPassword(id: string, password: string, actorId: string, ip: string): Promise<void> {
  if (password.length < 8) throw new ClientError("Mật khẩu cần ít nhất 8 ký tự");
  const passwordHash = await hashPassword(password);
  const row = await one<{ username: string }>(
    "UPDATE users SET password_hash = $2, failed_login_count = 0, locked_until = NULL WHERE id = $1 RETURNING username",
    [id, passwordHash],
  );
  if (!row) throw new ClientError("Không tìm thấy user", 404);
  await query("UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL", [id]);
  await writeAudit(actorId, "RESET_PASSWORD", ip, { username: row.username });
}

export async function seedAdmin(): Promise<void> {
  const config = readConfig();
  const existing = await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM users");
  if ((existing?.n ?? 0) > 0 || !config.adminPassword) return;
  if (config.adminPassword.length < 8) throw new Error("ADMIN_PASSWORD cần ít nhất 8 ký tự");
  const passwordHash = await hashPassword(config.adminPassword);
  await query(
    `INSERT INTO users (username, password_hash, display_name, role)
     VALUES ($1, $2, $3, 'ADMIN')`,
    [config.adminUsername.trim().toLowerCase(), passwordHash, config.adminDisplayName],
  );
}
