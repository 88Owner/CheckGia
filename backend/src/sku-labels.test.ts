import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { parseSkuLabels, type SkuLookup } from "../../shared/sku-labels";
import { parseMasterFile } from "./services/master-data";

const lookup: SkuLookup = {
  patterns: new Map([["dhau", "Dưa Hấu"], ["ngha", "Ngân Hà"], ["qdua", "Quả Dứa"]]),
  types: new Map([["2in1", "2 trong 1"], ["on", "Áo gối"], ["rg", "Rèm giường"]]),
};

describe("tách SKU thành mẫu, loại, kích thước", () => {
  it("đọc PE/2IN1-DHau-100-100", () => {
    expect(parseSkuLabels("PE/2IN1-DHau-100-100", lookup)).toEqual({
      patternName: "Dưa Hấu",
      typeName: "2 trong 1",
      sizeLabel: "100-100",
    });
  });

  it("giữ kích thước khi SKU có hậu tố và khi không có khổ", () => {
    expect(parseSkuLabels("PE/RG-NgHa-200-110-RG2", lookup)).toEqual({
      patternName: "Ngân Hà",
      typeName: "Rèm giường",
      sizeLabel: "200-110",
    });
    expect(parseSkuLabels("PE/ON-QDua", lookup)).toEqual({
      patternName: "Quả Dứa",
      typeName: "Áo gối",
      sizeLabel: null,
    });
  });

  it("lấy tên từ sheet data cột A-B và D-E", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["SKU", "Giá Bán Lẻ (VNĐ)", "Giá Đăng"],
      ["PE/2IN1-DHau-100-100", 58000, 72500],
    ]), "Sheet1");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["Mã mẫu", "Tên mẫu", "", "Mã loại", "Tên loại"],
      ["DHau", "Dưa Hấu", "", "2IN1", "2 trong 1"],
    ]), "data");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const parsed = parseMasterFile(Buffer.from(buffer), "master.xlsx");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows[0]).toMatchObject({
      sku: "PE/2IN1-DHau-100-100",
      retailPrice: 58000,
      standardPrice: 72500,
      patternName: "Dưa Hấu",
      typeName: "2 trong 1",
      sizeLabel: "100-100",
    });
  });
});
