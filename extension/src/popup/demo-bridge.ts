import type { CheckResult, CheckRun, HealthInfo, Summary } from "../../../shared/types";
import { bootstrap, checkBatch, exportErrors, fetchHealth, fetchResults, fetchRuns, importMaster, login, setAccessToken, setBackendOrigin } from "../shared/backend-client";
import type { ExtensionBridge, PageStatus, ScanEvent, Settings } from "./extension-bridge";

const DEMO_ITEMS = [
  {
    sku: "PE/D2-TH-100-120",
    model_id: "440089298348",
    product_name: "Thông Hồng,Ngang:1mxcao:1m2",
    current_price: 67900,
    original_price: 78625,
  },
  {
    sku: "PE/D2-TrX-100-120",
    model_id: "440089298362",
    product_name: "Trời Xanh,Ngang:1mxcao:1m2",
    current_price: 67900,
    original_price: 74875,
  },
  {
    sku: "PE/D2-TrX-120-150",
    model_id: "260446367237",
    product_name: "Trời Xanh,Ngang:1m2xcao:1m5",
    current_price: 103000,
    original_price: 112500,
  },
];

const listeners = new Set<(event: ScanEvent) => void>();
let settings: Settings = { includeNotFound: true, showOk: false, masterFileName: null };
let mode: "idle" | "running" | "paused" | "stopped" = "idle";
let demoRole = "";
let demoName = "";

function readMode(): "idle" | "running" | "paused" | "stopped" {
  return mode;
}

function emit(event: ScanEvent) {
  listeners.forEach((listener) => listener(event));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createDemoBridge(): ExtensionBridge {
  setBackendOrigin("");
  return {
    async health() {
      const response = await fetchHealth();
      if (!response.ok) return { ok: false as const, error: String(response.error ?? "Server Offline") };
      const profile = await bootstrap();
      const user = profile.user as { displayName?: string; role?: string } | undefined;
      if (user?.displayName) demoName = user.displayName;
      if (user?.role) demoRole = user.role;
      return {
        ok: true as const,
        service: "shopee-price-checker" as const,
        port: Number(response.port ?? 8787),
        database: String(response.database ?? ""),
        masterCount: Number(profile.masterCount ?? 0),
        masterFileName: (profile.masterFileName as string | null) ?? null,
        masterVersion: (profile.masterVersion as string | null) ?? null,
        maxItems: Number(profile.maxItems ?? response.maxItems ?? 100),
        minDelayMs: Number(profile.minDelayMs ?? response.minDelayMs ?? 3000),
        maxDelayMs: Number(profile.maxDelayMs ?? response.maxDelayMs ?? 7000),
        displayName: demoName || null,
        role: (demoRole || "") as HealthInfo["role"],
        serverUrl: "",
      };
    },
    async pageStatus(): Promise<PageStatus> {
      return {
        shopConnected: true,
        isProductManagement: true,
        shopLabel: "Connected",
        pageLabel: "Product Management",
      };
    },
    importMaster: (input) => importMaster(input),
    async startScan(input) {
      if (demoRole === "VIEWER") return { ok: false, error: "Viewer không được chạy kiểm tra giá" };
      if (!demoRole) return { ok: false, error: "Cần đăng nhập" };
      if (mode === "running" || mode === "paused") return { ok: false, error: "Đang quét." };
      mode = "running";
      void (async () => {
        try {
          const steps = Math.min(DEMO_ITEMS.length, input.maxItems);
          for (let index = 1; index <= steps; index += 1) {
            while (readMode() === "paused") await sleep(120);
            if (readMode() === "stopped") break;
            emit({ type: "SCAN_PROGRESS", scanned: index, total: input.maxItems, wrong: 0 });
            await sleep(200);
          }
          const stopped = readMode() === "stopped";
          const response = await checkBatch({
            items: DEMO_ITEMS.slice(0, steps),
            finalize: true,
            newRun: true,
          });
          if (!response.ok) {
            emit({ type: "SCAN_ERROR", message: String(response.error ?? "Local Backend chưa chạy.") });
            return;
          }
          emit({
            type: "SCAN_COMPLETE",
            total: steps,
            runId: Number(response.runId),
            summary: response.summary as Summary,
            stopped,
            empty: steps === 0,
          });
        } finally {
          mode = "idle";
        }
      })();
      return { ok: true };
    },
    async pause() {
      if (mode === "running") mode = "paused";
    },
    async resume() {
      if (mode === "paused") mode = "running";
    },
    async stop() {
      if (mode === "running" || mode === "paused") mode = "stopped";
    },
    async listRuns() {
      const response = await fetchRuns();
      return (response.runs as CheckRun[] | undefined) ?? [];
    },
    async getResults(runId, options) {
      const response = await fetchResults(runId, options);
      return {
        summary: (response.run as Summary | undefined) ?? null,
        results: (response.results as CheckResult[] | undefined) ?? [],
      };
    },
    async exportErrors(runId, includeNotFound) {
      const response = await exportErrors(runId, includeNotFound);
      if (!response.ok) return response;
      const binary = atob(response.base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return {
        ok: true,
        blob: new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      };
    },
    async getSettings() {
      return settings;
    },
    async setSettings(next) {
      settings = next;
    },
    async getScanState() {
      return { type: "SCAN_PROGRESS", scanned: 0, total: 100, wrong: 0, status: mode };
    },
    async login(username, password) {
      const result = await login(username, password);
      const user = result.user as { displayName?: string; role?: string } | undefined;
      if (result.ok && result.accessToken) {
        setAccessToken(String(result.accessToken));
        demoName = user?.displayName ?? username;
        demoRole = user?.role ?? "";
      }
      return { ok: Boolean(result.ok), error: result.error ? String(result.error) : undefined };
    },
    async logout() {
      setAccessToken("");
      demoName = "";
      demoRole = "";
    },
    async saveConnection(input) {
      const local = !input.serverUrl || input.serverUrl.includes("127.0.0.1:8787") || input.serverUrl.includes("localhost:8787");
      setBackendOrigin(local ? "" : input.serverUrl);
      return { ok: true };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
