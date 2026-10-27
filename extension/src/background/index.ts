import {
  bootstrap,
  checkBatch,
  exportErrors,
  fetchHealth,
  fetchResults,
  fetchRuns,
  importMaster,
  login,
  setAccessToken,
  setBackendOrigin,
  type ScanSnapshot,
} from "../shared/backend-client";
import type { ColumnMapping, ScrapedItem, Summary } from "../../../shared/types";

interface RuntimeMessage {
  type?: string;
  tabId?: number;
  maxItems?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  fileName?: string;
  contentBase64?: string;
  mapping?: ColumnMapping;
  runId?: number;
  includeOk?: boolean;
  includeNotFound?: boolean;
  items?: ScrapedItem[];
  finalize?: boolean;
  newRun?: boolean;
  scanned?: number;
  total?: number;
  wrong?: number;
  summary?: Summary;
  message?: string;
  stopped?: boolean;
  empty?: boolean;
  username?: string;
  password?: string;
  serverUrl?: string;
  machineName?: string;
}

const idleSession = (): ScanSnapshot => ({
  status: "idle",
  scanned: 0,
  total: 100,
  wrong: 0,
});

async function readSession(): Promise<ScanSnapshot> {
  const stored = await chrome.storage.session.get("scanSession");
  return (stored.scanSession as ScanSnapshot | undefined) ?? idleSession();
}

async function writeSession(session: ScanSnapshot): Promise<void> {
  await chrome.storage.session.set({ scanSession: session });
}

async function ensureContent(tabId: number): Promise<void> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "PING" });
    if (response?.ok) return;
  } catch {
    // Content script chưa có trên tab này.
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
}

async function sendToTab(tabId: number, message: unknown): Promise<unknown> {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    return { ok: false, error: "Không liên lạc được với trang Shopee. Hãy tải lại trang rồi thử lại." };
  }
}

async function rememberedTab(): Promise<number | null> {
  const session = await readSession();
  return session.tabId ?? null;
}

async function applySession(): Promise<{ serverUrl: string; machineName: string; role: string; displayName: string }> {
  const stored = await chrome.storage.local.get(["serverUrl", "accessToken", "machineName", "role", "displayName"]);
  const serverUrl = String(stored.serverUrl || "http://127.0.0.1:8787");
  setBackendOrigin(serverUrl);
  setAccessToken(String(stored.accessToken || ""));
  return {
    serverUrl,
    machineName: String(stored.machineName || ""),
    role: String(stored.role || ""),
    displayName: String(stored.displayName || ""),
  };
}

async function refreshAccess(): Promise<boolean> {
  const stored = await chrome.storage.local.get(["serverUrl", "refreshToken"]);
  const serverUrl = String(stored.serverUrl || "http://127.0.0.1:8787");
  const refreshToken = String(stored.refreshToken || "");
  if (!refreshToken) return false;
  const response = await fetch(`${serverUrl}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!response.ok) return false;
  const data = await response.json() as { accessToken?: string; refreshToken?: string; user?: { role?: string; displayName?: string } };
  if (!data.accessToken || !data.refreshToken) return false;
  await chrome.storage.local.set({
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    role: data.user?.role ?? "",
    displayName: data.user?.displayName ?? "",
  });
  setAccessToken(data.accessToken);
  setBackendOrigin(serverUrl);
  return true;
}

async function withAuth<T extends { ok?: boolean; error?: string }>(run: () => Promise<T>): Promise<T> {
  await applySession();
  const first = await run();
  if (first.ok !== false || !String(first.error ?? "").includes("đăng nhập")) return first;
  if (!(await refreshAccess())) return first;
  return run();
}

async function handle(message: RuntimeMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (message.type) {
    case "HEALTH": {
      const session = await applySession();
      const health = await fetchHealth();
      if (!health.ok) return { ok: false, error: String(health.error ?? "Server Offline") };
      const profile = await withAuth(() => bootstrap());
      const user = profile.user as { displayName?: string; role?: string } | undefined;
      return {
        ok: true,
        service: "shopee-price-checker",
        port: Number(health.port ?? 8787),
        database: health.database,
        masterCount: Number(profile.masterCount ?? 0),
        masterFileName: (profile.masterFileName as string | null) ?? null,
        masterVersion: (profile.masterVersion as string | null) ?? null,
        maxItems: Number(profile.maxItems ?? health.maxItems ?? 100),
        minDelayMs: Number(profile.minDelayMs ?? health.minDelayMs ?? 3000),
        maxDelayMs: Number(profile.maxDelayMs ?? health.maxDelayMs ?? 7000),
        displayName: user?.displayName ?? session.displayName,
        role: user?.role ?? session.role,
        serverUrl: session.serverUrl,
        machineName: session.machineName,
      };
    }
    case "LOGIN": {
      await applySession();
      const result = await login(String(message.username ?? ""), String(message.password ?? ""));
      const user = result.user as { displayName?: string; role?: string; username?: string } | undefined;
      if (result.ok && result.accessToken && result.refreshToken) {
        await chrome.storage.local.set({
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          displayName: user?.displayName ?? "",
          role: user?.role ?? "",
          username: user?.username ?? "",
        });
        setAccessToken(String(result.accessToken));
      }
      return result;
    }
    case "LOGOUT": {
      const stored = await chrome.storage.local.get(["refreshToken", "serverUrl"]);
      const serverUrl = String(stored.serverUrl || "http://127.0.0.1:8787");
      if (stored.refreshToken) {
        await fetch(`${serverUrl}/api/auth/logout`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${(await chrome.storage.local.get("accessToken")).accessToken ?? ""}` },
          body: JSON.stringify({ refreshToken: stored.refreshToken }),
        }).catch(() => undefined);
      }
      await chrome.storage.local.remove(["accessToken", "refreshToken", "displayName", "role", "username"]);
      setAccessToken("");
      return { ok: true };
    }
    case "SAVE_SERVER": {
      const serverUrl = String(message.serverUrl ?? "").replace(/\/$/, "");
      const machineName = String(message.machineName ?? "");
      await chrome.storage.local.set({ serverUrl, machineName });
      setBackendOrigin(serverUrl || "http://127.0.0.1:8787");
      return { ok: true };
    }
    case "IMPORT_MASTER":
      return withAuth(() => importMaster({
        fileName: message.fileName ?? "master.xlsx",
        contentBase64: message.contentBase64 ?? "",
        mapping: message.mapping,
      }));
    case "LIST_RUNS":
      return withAuth(() => fetchRuns());
    case "GET_RESULTS":
      if (!message.runId) return { ok: false, error: "Thiếu lần kiểm tra" };
      return withAuth(() => fetchResults(message.runId!, {
        includeOk: Boolean(message.includeOk),
        includeNotFound: message.includeNotFound !== false,
      }));
    case "EXPORT_ERRORS":
      if (!message.runId) return { ok: false, error: "Thiếu lần kiểm tra" };
      return withAuth(() => exportErrors(message.runId!, message.includeNotFound !== false));
    case "GET_SCAN_STATE":
      return { ok: true, session: await readSession() };
    case "START_SCAN": {
      if (!message.tabId) return { ok: false, error: "Không thấy tab hiện tại" };
      await ensureContent(message.tabId);
      const started = (await sendToTab(message.tabId, {
        type: "START_SCAN",
        maxItems: message.maxItems ?? 100,
        minDelayMs: message.minDelayMs ?? 3000,
        maxDelayMs: message.maxDelayMs ?? 7000,
      })) as { ok?: boolean; error?: string };
      if (!started?.ok) return { ok: false, error: started?.error ?? "Không bắt đầu được lượt quét" };
      await writeSession({
        status: "running",
        scanned: 0,
        total: message.maxItems ?? 100,
        wrong: 0,
        tabId: message.tabId,
      });
      return { ok: true };
    }
    case "PAUSE_SCAN":
    case "RESUME_SCAN":
    case "STOP_SCAN": {
      const tabId = await rememberedTab();
      if (!tabId) return { ok: false, error: "Không có lượt quét đang chạy" };
      const response = await sendToTab(tabId, { type: message.type });
      const session = await readSession();
      if (message.type === "PAUSE_SCAN") await writeSession({ ...session, status: "paused" });
      if (message.type === "RESUME_SCAN") await writeSession({ ...session, status: "running" });
      return response ?? { ok: true };
    }
    case "BATCH_CHECK": {
      const tabId = sender.tab?.id;
      if (!tabId) return { ok: false, error: "Thiếu tab Shopee" };
      const stored = await chrome.storage.session.get(`run:${tabId}`);
      const existing = stored[`run:${tabId}`] as number | undefined;
      const newRun = Boolean(message.newRun) || !existing;
      const session = await applySession();
      const scan = await readSession();
      const result = await withAuth(() => checkBatch({
        items: message.items ?? [],
        runId: newRun ? undefined : existing,
        finalize: Boolean(message.finalize),
        newRun,
        machineName: session.machineName,
        scanTarget: scan.total,
      }));
      if (result.ok && typeof result.runId === "number") {
        await chrome.storage.session.set({ [`run:${tabId}`]: result.runId });
      }
      if (message.newRun) {
        await chrome.storage.session.remove(`run:${tabId}`);
        if (result.ok && typeof result.runId === "number") {
          await chrome.storage.session.set({ [`run:${tabId}`]: result.runId });
        }
      }
      return result;
    }
    case "SCAN_PROGRESS": {
      const session = await readSession();
      await writeSession({
        ...session,
        status: session.status === "paused" ? "paused" : "running",
        scanned: message.scanned ?? session.scanned,
        total: message.total ?? session.total,
        wrong: message.wrong ?? session.wrong,
        summary: message.summary ?? session.summary,
        runId: message.runId ?? session.runId,
      });
      return { ok: true };
    }
    case "SCAN_COMPLETE": {
      const session = await readSession();
      await writeSession({
        ...session,
        status: "complete",
        scanned: message.total ?? session.scanned,
        wrong: message.summary?.wrong_price ?? session.wrong,
        summary: message.summary ?? session.summary,
        runId: message.runId ?? session.runId,
        stopped: message.stopped,
        empty: message.empty,
        message: message.message,
      });
      return { ok: true };
    }
    case "SCAN_ERROR": {
      const session = await readSession();
      const runId = message.runId ?? session.runId;
      await writeSession({
        ...session,
        status: "error",
        message: message.message,
        runId,
      });
      if (runId) {
        const current = await applySession();
        const token = String((await chrome.storage.local.get("accessToken")).accessToken ?? "");
        await fetch(`${current.serverUrl}/api/runs/${runId}/fail`, {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }).catch(() => undefined);
      }
      return { ok: true };
    }
    default:
      return { ok: false, error: "Lệnh không được hỗ trợ" };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handle(message as RuntimeMessage, sender)
    .then((result) => sendResponse(result))
    .catch((error: unknown) => {
      const text = error instanceof Error ? error.message : "Lỗi không xác định";
      sendResponse({ ok: false, error: text });
    });
  return true;
});
