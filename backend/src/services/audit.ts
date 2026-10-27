import { query } from "../db/pool";

export async function writeAudit(
  userId: string | null,
  action: string,
  ip: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await query(
    "INSERT INTO audit_logs (user_id, action, ip, metadata) VALUES ($1, $2, $3, $4::jsonb)",
    [userId, action, ip, JSON.stringify(metadata)],
  );
}
