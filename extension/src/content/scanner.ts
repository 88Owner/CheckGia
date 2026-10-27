import { dedupeKey } from "../../../shared/sku";
import type { ScrapedItem, Summary } from "../../../shared/types";
import { detectVerification } from "./page";
import { parseProductDetail, parseVariationDivs, type ParsedModel } from "./parser";
import { scrapeVisibleModels } from "./scraper";
import { SELECTORS, queryAll } from "./selectors";
import { scrollModelList } from "./scroll";

export interface ScanControl {
  state: "idle" | "running" | "paused" | "stopped";
}

export interface BatchResponse {
  summary: Summary;
  runId: number;
}

export interface ScanProgress {
  scanned: number;
  total: number;
  wrong: number;
  summary?: Summary;
  runId?: number;
}

export interface ScanLoopOptions {
  maxItems: number;
  minDelayMs: number;
  maxDelayMs: number;
  control: ScanControl;
  readCurrent: () => ParsedModel[];
  scroll: () => { atEnd: boolean; moved: boolean };
  delay: (ms: number) => Promise<void>;
  isVerification: () => string | null;
  onBatch: (items: ScrapedItem[], finalize: boolean) => Promise<BatchResponse>;
  onProgress: (progress: ScanProgress) => void;
  random?: () => number;
}

export interface ScanLoopResult {
  scanned: number;
  stopped: boolean;
  empty: boolean;
  runId?: number;
  summary?: Summary;
}

export function randomBetween(min: number, max: number, random: () => number = Math.random): number {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  if (high <= low) return low;
  return Math.floor(low + random() * (high - low + 1));
}

export function collectFresh(seen: Map<string, ParsedModel>, visible: ParsedModel[], maxItems: number): ParsedModel[] {
  const fresh: ParsedModel[] = [];
  for (const item of visible) {
    if (seen.size >= maxItems) break;
    const key = dedupeKey(item);
    if (seen.has(key)) continue;
    seen.set(key, item);
    fresh.push(item);
  }
  return fresh;
}

function readState(control: ScanControl): ScanControl["state"] {
  return control.state;
}

async function waitWhilePaused(control: ScanControl, delay: (ms: number) => Promise<void>): Promise<void> {
  while (readState(control) === "paused") {
    await delay(200);
  }
}

async function chunkedDelay(total: number, control: ScanControl, delay: (ms: number) => Promise<void>): Promise<void> {
  let left = total;
  while (left > 0) {
    if (readState(control) === "stopped") return;
    await waitWhilePaused(control, delay);
    if (readState(control) === "stopped") return;
    const step = Math.min(200, left);
    await delay(step);
    left -= step;
  }
}

export async function runScanLoop(options: ScanLoopOptions): Promise<ScanLoopResult> {
  const seen = new Map<string, ParsedModel>();
  const maxRounds = Math.max(options.maxItems, 10) + 5;
  let stagnant = 0;
  let rounds = 0;
  let finalized = false;
  let runId: number | undefined;
  let summary: Summary | undefined;

  const finalize = async () => {
    if (finalized) return;
    finalized = true;
    const response = await options.onBatch([], true);
    runId = response.runId;
    summary = response.summary;
  };

  try {
    while (seen.size < options.maxItems && rounds < maxRounds) {
      rounds += 1;
      if (readState(options.control) === "stopped") break;
      await waitWhilePaused(options.control, options.delay);
      if (readState(options.control) === "stopped") break;

      const verification = options.isVerification();
      if (verification) throw new Error(verification);

      const fresh = collectFresh(seen, options.readCurrent(), options.maxItems);
      if (fresh.length > 0) {
        const response = await options.onBatch(fresh, false);
        runId = response.runId;
        summary = response.summary;
        stagnant = 0;
      } else {
        stagnant += 1;
      }

      options.onProgress({
        scanned: seen.size,
        total: options.maxItems,
        wrong: summary?.wrong_price ?? 0,
        summary,
        runId,
      });

      if (seen.size >= options.maxItems) break;
      if (stagnant >= 3) break;

      const scrolled = options.scroll();
      if (!scrolled.moved && fresh.length === 0) break;
      if (scrolled.atEnd && fresh.length === 0 && stagnant >= 2) break;

      await chunkedDelay(
        randomBetween(options.minDelayMs, options.maxDelayMs, options.random),
        options.control,
        options.delay,
      );
    }
    await finalize();
  } catch (error) {
    if (seen.size > 0) {
      try {
        await finalize();
      } catch {
        // Giữ lỗi gốc nếu backend cũng không chốt được lượt quét.
      }
    }
    throw error;
  }

  return {
    scanned: seen.size,
    stopped: readState(options.control) === "stopped",
    empty: seen.size === 0,
    runId,
    summary,
  };
}

export async function scanCurrentPage(
  options: Omit<ScanLoopOptions, "readCurrent" | "scroll" | "delay" | "isVerification"> & {
    doc?: Document;
  },
): Promise<ScanLoopResult> {
  const doc = options.doc ?? document;
  return runScanLoop({
    ...options,
    readCurrent: () => scrapeVisibleModels(doc),
    scroll: () => {
      if (queryAll(doc, SELECTORS.modelItem).length === 0 && (parseVariationDivs(doc).length > 0 || parseProductDetail(doc))) {
        return { atEnd: true, moved: false };
      }
      return scrollModelList(doc);
    },
    delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    isVerification: () => detectVerification(doc),
  });
}
