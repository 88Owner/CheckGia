import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildErrorWorkbook } from "./services/export-errors";
import type { CheckResult } from "../../shared/types";

function row(status: CheckResult["status"], name: string): CheckResult {
  return {
    sku: status === "OK" ? "PE/OK" : null,
    model_id: null,
    product_name: name,
    current_price: status === "UNMAPPED" ? 90000 : 80000,
    original_price: null,
    standard_price: status === "UNMAPPED" ? null : 80000,
    retail_price: null,
    difference: status === "WRONG_PRICE" ? 10000 : status === "OK" ? 0 : null,
    status,
    checked_at: "2026-10-08T04:00:00.000Z",
  };
}

async function fills(buffer: Buffer): Promise<Array<string | undefined>> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet("Price");
  if (!sheet) return [];
  return [2, 3, 4].map((index) => {
    const fill = sheet.getRow(index).getCell(9).fill;
    return fill && fill.type === "pattern" ? fill.fgColor?.argb : undefined;
  });
}

describe("file xuất giá", () => {
  it("tô đỏ khi sai giá, vàng khi không có trong master, xanh khi đúng giá", async () => {
    const buffer = await buildErrorWorkbook([
      row("WRONG_PRICE", "Xanh than 2 lớp, ngang 1m8 x dài 2m"),
      row("UNMAPPED", "Hồng, ngang 1m x dài 2m"),
      row("OK", "Xám 2 lớp, ngang 1m x dài 2m"),
    ]);
    expect(await fills(buffer)).toEqual(["FFFF6B6B", "FFFFFF00", "FF00B050"]);
  });

  it("tô cam khi đã khớp master nhưng không đọc được giá Shopee", async () => {
    const buffer = await buildErrorWorkbook([row("PRICE_PARSE_ERROR", "Xanh than 2 lớp, ngang 1m8 x dài 2m")]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const fill = workbook.getWorksheet("Price")?.getRow(2).getCell(9).fill;
    expect(fill && fill.type === "pattern" ? fill.fgColor?.argb : undefined).toBe("FFFFC000");
  });
});
