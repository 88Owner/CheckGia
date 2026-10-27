import type { CheckResult, CheckRun, ColumnMapping, HealthInfo, Summary } from "../../../shared/types";
import { base64ToBytes } from "../shared/backend-client";
import { analyzeSellerUrl, isStorefrontProductUrl, PRODUCT_PAGE_MESSAGE } from "../shared/seller";

export interface PageStatus {
  shopConnected: boolean;
  isProductManagement: boolean;
  shopLabel: string;
  pageLabel: string;
  message?: string;
}

export interface ScanEvent {
  type: "SCAN_PROGRESS" | "SCAN_COMPLETE" | "SCAN_ERROR";
  scanned?: number;
  total?: number;
  wrong?: number;
  summary?: Summary;
  runId?: number;
  message?: string;
  stopped?: boolean;
  empty?: boolean;
}

export interface Settings {
  includeNotFound: boolean;
  showOk: boolean;
  masterFileName: string | null;
}

export interface ExtensionBridge {
  health(): Promise<(HealthInfo & { ok: true }) | { ok: false; error: string }>;
  pageStatus(): Promise<PageStatus>;
  importMaster(input: {
    fileName: string;
    contentBase64: string;
    mapping?: ColumnMapping;
  }): Promise<Record<string, unknown>>;
  startScan(input: { maxItems: number; minDelayMs: number; maxDelayMs: number }): Promise<{ ok: boolean; error?: string }>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  listRuns(): Promise<CheckRun[]>;
  getResults(
    runId: number,
    options: { includeOk: boolean; includeNotFound: boolean },
  ): Promise<{ summary: Summary | null; results: CheckResult[] }>;
  exportErrors(runId: number, includeNotFound: boolean): Promise<{ ok: true; blob: Blob } | { ok: false; error: string }>;
  getSettings(): Promise<Settings>;
  setSettings(settings: Settings): Promise<void>;
  getScanState(): Promise<ScanEvent & { status?: string }>;
  subscribe(listener: (event: ScanEvent) => void): () => void;
  login(username: string, password: string): Promise<{ ok: boolean; error?: string }>;
  logout(): Promise<void>;
  saveConnection(input: { serverUrl: string; machineName: string }): Promise<{ ok: boolean; error?: string }>;
}

const DEFAULT_SETTINGS: Settings = {
  includeNotFound: true,
  showOk: false,
  masterFileName: null,
};

async function send<T>(message: unknown): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

export function createExtensionBridge(): ExtensionBridge {
  return {
    health: () => send({ type: "HEALTH" }),
    pageStatus: () => readPageStatus(),
    importMaster: (input) => send({ type: "IMPORT_MASTER", ...input }),
    startScan: async (input) => {
      const status = await readPageStatus();
      if (!status.isProductManagement) return { ok: false, error: PRODUCT_PAGE_MESSAGE };
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { ok: false, error: PRODUCT_PAGE_MESSAGE };
      return send({ type: "START_SCAN", tabId: tab.id, ...input });
    },
    pause: async () => {
      await send({ type: "PAUSE_SCAN" });
    },
    resume: async () => {
      await send({ type: "RESUME_SCAN" });
    },
    stop: async () => {
      await send({ type: "STOP_SCAN" });
    },
    listRuns: async () => {
      const response = await send<{ ok?: boolean; runs?: CheckRun[] }>({ type: "LIST_RUNS" });
      return response.runs ?? [];
    },
    getResults: async (runId, options) => {
      const response = await send<{ ok?: boolean; run?: Summary; results?: CheckResult[] }>({
        type: "GET_RESULTS",
        runId,
        ...options,
      });
      return { summary: response.run ?? null, results: response.results ?? [] };
    },
    exportErrors: async (runId, includeNotFound) => {
      const response = await send<{ ok: boolean; error?: string; base64?: string }>({
        type: "EXPORT_ERRORS",
        runId,
        includeNotFound,
      });
      if (!response.ok || !response.base64) return { ok: false, error: response.error ?? "Không xuất được file" };
      const bytes = base64ToBytes(response.base64);
      return {
        ok: true,
        blob: new Blob([Uint8Array.from(bytes)], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      };
    },
    getSettings: async () => {
      const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
      return {
        includeNotFound: stored.includeNotFound !== false,
        showOk: stored.showOk === true,
        masterFileName: (stored.masterFileName as string | null) ?? null,
      };
    },
    setSettings: async (settings) => {
      await chrome.storage.local.set(settings);
    },
    getScanState: async () => {
      const response = await send<{ session?: ScanEvent & { status?: string } }>({ type: "GET_SCAN_STATE" });
      return response.session ?? { type: "SCAN_PROGRESS", scanned: 0, total: 100, wrong: 0, status: "idle" };
    },
    login: async (username, password) => {
      const response = await send<{ ok?: boolean; error?: string }>({ type: "LOGIN", username, password });
      return { ok: Boolean(response.ok), error: response.error };
    },
    logout: async () => {
      await send({ type: "LOGOUT" });
    },
    saveConnection: (input) => send({ type: "SAVE_SERVER", ...input }),
    subscribe: (listener) => {
      const wrapped = (message: ScanEvent) => {
        if (message?.type === "SCAN_PROGRESS" || message?.type === "SCAN_COMPLETE" || message?.type === "SCAN_ERROR") {
          listener(message);
        }
      };
      chrome.runtime.onMessage.addListener(wrapped);
      return () => chrome.runtime.onMessage.removeListener(wrapped);
    },
  };
}

async function readPageStatus(): Promise<PageStatus> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const info = analyzeSellerUrl(tab?.url);
  const isDetail = isStorefrontProductUrl(tab?.url);
  let hasModels = false;
  if ((info.isSeller || isDetail) && tab?.id) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: "CHECK_PAGE" });
      hasModels = Boolean(response?.hasModels);
    } catch {
      hasModels = false;
    }
  }
  const isProductManagement = info.isProductPage || (info.isSeller && hasModels && !info.isLogin) || isDetail;
  if (!isProductManagement) {
    return {
      shopConnected: info.isSeller && !info.isLogin,
      isProductManagement: false,
      shopLabel: info.isSeller && !info.isLogin ? "Connected" : "Chưa kết nối",
      pageLabel: "—",
      message: PRODUCT_PAGE_MESSAGE,
    };
  }
  return {
    shopConnected: true,
    isProductManagement: true,
    shopLabel: "Connected",
    pageLabel: isDetail && !info.isProductPage ? "Product Detail" : "Product Management",
  };
}
