import { describe, expect, it } from "vitest";
import { emptySummary } from "../../../shared/status";
import type { Summary } from "../../../shared/types";
import { planScroll } from "./scroll";
import { collectFresh, runScanLoop, type ScanControl } from "./scanner";
import type { ParsedModel } from "./parser";

function model(modelId: string, sku: string): ParsedModel {
  return {
    sku,
    model_id: modelId,
    product_name: sku,
    current_price: 1000,
    original_price: null,
    fingerprint: modelId,
  };
}

function summary(): Summary {
  return emptySummary();
}

describe("scroll plan", () => {
  it("bước khoảng 80% chiều cao khung nhìn và biết khi đã tới cuối", () => {
    const next = planScroll({ scrollTop: 0, scrollHeight: 5000, clientHeight: 800 });
    expect(next.scrollTop).toBe(640);
    expect(next.moved).toBe(true);
    expect(next.atEnd).toBe(false);

    const end = planScroll({ scrollTop: 4000, scrollHeight: 4200, clientHeight: 200 });
    expect(end.moved).toBe(false);
    expect(end.atEnd).toBe(true);
  });
});

describe("scanner", () => {
  it("không nhân đôi model khi cùng model_id xuất hiện lại sau khi cuộn", async () => {
    const pages = [
      [model("1", "A"), model("2", "B")],
      [model("2", "B"), model("3", "C")],
      [model("3", "C")],
    ];
    let phase = 0;
    const seen = new Map<string, ParsedModel>();
    const fresh = pages.map((page) => collectFresh(seen, page, 100));
    expect(fresh[0].map((item) => item.model_id)).toEqual(["1", "2"]);
    expect(fresh[1].map((item) => item.model_id)).toEqual(["3"]);
    expect(fresh[2]).toEqual([]);

    const control: ScanControl = { state: "running" };
    const sent: string[] = [];
    const result = await runScanLoop({
      maxItems: 100,
      minDelayMs: 0,
      maxDelayMs: 0,
      control,
      readCurrent: () => pages[Math.min(phase, pages.length - 1)],
      scroll: () => {
        phase += 1;
        return { moved: phase < pages.length, atEnd: phase >= pages.length - 1 };
      },
      delay: async () => undefined,
      isVerification: () => null,
      onBatch: async (items) => {
        sent.push(...items.map((item) => item.model_id ?? ""));
        return { runId: 7, summary: summary() };
      },
      onProgress: () => undefined,
      random: () => 0,
    });

    expect(result.scanned).toBe(3);
    expect(sent.filter(Boolean)).toEqual(["1", "2", "3"]);
  });

  it("dừng khi đủ MAX_ITEMS", async () => {
    const control: ScanControl = { state: "running" };
    let reads = 0;
    const result = await runScanLoop({
      maxItems: 2,
      minDelayMs: 5000,
      maxDelayMs: 5000,
      control,
      readCurrent: () => {
        reads += 1;
        return [model("1", "A"), model("2", "B"), model("3", "C")];
      },
      scroll: () => ({ moved: true, atEnd: false }),
      delay: async () => {
        throw new Error("không được chờ sau khi đã đủ số lượng");
      },
      isVerification: () => null,
      onBatch: async () => ({ runId: 1, summary: summary() }),
      onProgress: () => undefined,
    });
    expect(result.scanned).toBe(2);
    expect(reads).toBe(1);
  });

  it("dừng và báo khi trang yêu cầu xác minh", async () => {
    const control: ScanControl = { state: "running" };
    await expect(
      runScanLoop({
        maxItems: 10,
        minDelayMs: 0,
        maxDelayMs: 0,
        control,
        readCurrent: () => [model("1", "A")],
        scroll: () => ({ moved: true, atEnd: false }),
        delay: async () => undefined,
        isVerification: () => "Trang yêu cầu xác minh. Vui lòng xử lý thủ công rồi chạy lại.",
        onBatch: async () => ({ runId: 1, summary: summary() }),
        onProgress: () => undefined,
      }),
    ).rejects.toThrow("Trang yêu cầu xác minh. Vui lòng xử lý thủ công rồi chạy lại.");
  });

  it("stop giữ các model đã đọc", async () => {
    const control: ScanControl = { state: "running" };
    let finalized = false;
    const result = await runScanLoop({
      maxItems: 100,
      minDelayMs: 1000,
      maxDelayMs: 1000,
      control,
      readCurrent: () => [model("9", "KEEP")],
      scroll: () => ({ moved: true, atEnd: false }),
      delay: async () => {
        control.state = "stopped";
      },
      isVerification: () => null,
      onBatch: async (_items, finalize) => {
        if (finalize) finalized = true;
        return { runId: 3, summary: summary() };
      },
      onProgress: () => undefined,
    });
    expect(result.scanned).toBe(1);
    expect(result.stopped).toBe(true);
    expect(finalized).toBe(true);
  });
});
