import type { ScrapedItem, Summary } from "../../../shared/types";
import { EMPTY_PAGE_MESSAGE } from "../shared/seller";
import { detectVerification } from "./page";
import { scrapeVisibleModels } from "./scraper";
import { scanCurrentPage, type ScanControl } from "./scanner";

const LOADED = "__SHOPEE_PRICE_CHECKER_LOADED__";

interface StartScanMessage {
  type: "START_SCAN";
  maxItems: number;
  minDelayMs: number;
  maxDelayMs: number;
}

interface BatchResult {
  ok?: boolean;
  error?: string;
  runId?: number;
  summary?: Summary;
}

const control: ScanControl = { state: "idle" };

function startScan(message: StartScanMessage): { ok: boolean; error?: string } {
  if (control.state === "running" || control.state === "paused") {
    return { ok: false, error: "Đang quét. Hãy bấm Stop trước khi quét lại." };
  }
  control.state = "running";
  void (async () => {
    let runId: number | undefined;
    let summary: Summary | undefined;
    let first = true;
    try {
      const verification = detectVerification(document);
      if (verification) throw new Error(verification);
      const result = await scanCurrentPage({
        maxItems: message.maxItems,
        minDelayMs: message.minDelayMs,
        maxDelayMs: message.maxDelayMs,
        control,
        onBatch: async (items: ScrapedItem[], finalize: boolean) => {
          const response = (await chrome.runtime.sendMessage({
            type: "BATCH_CHECK",
            items,
            finalize,
            newRun: first,
          })) as BatchResult;
          first = false;
          if (!response?.ok || !response.runId || !response.summary) {
            throw new Error(response?.error || "Không gửi được dữ liệu về Local Backend.");
          }
          runId = response.runId;
          summary = response.summary;
          return { runId: response.runId, summary: response.summary };
        },
        onProgress: (progress) => {
          void chrome.runtime.sendMessage({
            type: "SCAN_PROGRESS",
            ...progress,
            runId: progress.runId ?? runId,
            summary: progress.summary ?? summary,
          });
        },
      });
      void chrome.runtime.sendMessage({
        type: "SCAN_COMPLETE",
        total: result.scanned,
        runId: result.runId ?? runId,
        summary: result.summary ?? summary,
        stopped: result.stopped,
        empty: result.empty,
        message: result.empty ? EMPTY_PAGE_MESSAGE : undefined,
      });
    } catch (error) {
      void chrome.runtime.sendMessage({
        type: "SCAN_ERROR",
        message: error instanceof Error ? error.message : "Lỗi quét dữ liệu",
        runId,
      });
    } finally {
      control.state = "idle";
    }
  })();
  return { ok: true };
}

function handleMessage(message: { type?: string }): unknown {
  if (!message?.type) return { ok: false };
  if (message.type === "PING") return { ok: true };
  if (message.type === "CHECK_PAGE") {
    return {
      ok: true,
      hasModels: scrapeVisibleModels(document).length > 0,
      verification: detectVerification(document),
    };
  }
  if (message.type === "START_SCAN") return startScan(message as StartScanMessage);
  if (message.type === "PAUSE_SCAN") {
    if (control.state === "running") control.state = "paused";
    return { ok: true, state: control.state };
  }
  if (message.type === "RESUME_SCAN") {
    if (control.state === "paused") control.state = "running";
    return { ok: true, state: control.state };
  }
  if (message.type === "STOP_SCAN") {
    if (control.state === "running" || control.state === "paused") control.state = "stopped";
    return { ok: true, state: control.state };
  }
  return { ok: false };
}

const globalState = globalThis as typeof globalThis & { [LOADED]?: boolean };
if (!globalState[LOADED]) {
  globalState[LOADED] = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    sendResponse(handleMessage(message as { type?: string }));
  });
}
