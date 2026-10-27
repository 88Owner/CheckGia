import { buildApp } from "./app";
import { readConfig, loadEnvFile } from "./config";
import { SCHEMA_SQL } from "./db/schema";
import { connectDatabase, getPool } from "./db/pool";
import { importLegacySqlite } from "./db/legacy-sqlite";
import { promoteQueue } from "./services/check";
import { seedAdmin } from "./services/users";

loadEnvFile();
const config = readConfig();
await connectDatabase(config.databaseUrl);
await getPool().query(SCHEMA_SQL);
await seedAdmin();
const imported = await importLegacySqlite(config.sqliteImportPath);
if (imported > 0) console.log(`Đã chuyển ${imported} SKU từ SQLite sang PostgreSQL`);

const app = buildApp(config);
const timer = setInterval(() => {
  void promoteQueue().catch((error) => app.log.error(error));
}, 2000);
timer.unref();

await app.listen({ host: config.host, port: config.port });
console.log(`Price Auditor backend:\nhttp://127.0.0.1:${config.port}`);
if (config.host === "0.0.0.0") {
  console.log("Đang lắng nghe LAN trên cổng 8787. Chỉ mở firewall cho mạng nội bộ, không mở ra Internet.");
}
