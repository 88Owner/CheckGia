import { mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { readConfig } from "../config";
import { ClientError } from "../errors";
import { writeAudit } from "./audit";

export function backupFileName(date = new Date()): string {
  const stamp = date.toISOString().slice(0, 10);
  return `price_auditor_${stamp}.sql`;
}

export async function backupDatabase(userId: string, ip: string): Promise<string> {
  const config = readConfig();
  mkdirSync(config.backupDir, { recursive: true });
  const filePath = join(config.backupDir, backupFileName());
  await new Promise<void>((resolve, reject) => {
    const child = spawn("pg_dump", ["--dbname", config.databaseUrl, "--file", filePath, "--no-owner"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let errorText = "";
    child.stderr.on("data", (chunk) => {
      errorText += String(chunk);
    });
    child.on("error", () => reject(new ClientError("Máy chủ chưa có pg_dump. Dùng script backup trong thư mục scripts.")));
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new ClientError(errorText || "Backup thất bại"));
    });
  });
  await writeAudit(userId, "BACKUP_DATABASE", ip, { file: filePath });
  return filePath;
}
