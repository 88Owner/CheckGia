import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sizeCodeFromText } from "../../shared/match";
import { classifyItem } from "./services/check";
import { parseMasterFile } from "./services/master-data";
import type { CachedMasterRow } from "./services/master-data";

describe("file giá 3 cột", () => {
  it("lấy Giá Đăng làm giá đối chiếu và giữ Giá Bán Lẻ", () => {
    const csv = readFileSync(fileURLToPath(new URL("../../fixtures/master_data.csv", import.meta.url)));
    const parsed = parseMasterFile(csv, "master_data.csv");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.priceColumn).toBe("Giá Đăng");
    expect(parsed.retailColumn).toBe("Giá Bán Lẻ (VNĐ)");
    const sample = parsed.rows.find((row) => row.sku === "PE/D2-TrX-70-120");
    expect(sample).toMatchObject({ retailPrice: 38500, standardPrice: 48125 });

    const master = new Map<string, CachedMasterRow>(
      parsed.rows.map((row) => [row.skuKey, {
        sku: row.sku,
        sku_key: row.skuKey,
        standard_price: row.standardPrice,
        retail_price: row.retailPrice,
        name: row.name,
        attributes: row.attributes,
      }]),
    );
    expect(classifyItem({
      sku: "PE/D2-TH-100-120",
      model_id: "440089298348",
      product_name: "Thông Hồng",
      current_price: 67900,
      original_price: 78625,
    }, master).status).toBe("UNMAPPED");
    expect(classifyItem({
      sku: "PE/D2-ABC-100-120",
      model_id: null,
      product_name: null,
      current_price: null,
      original_price: null,
    }, master).status).toBe("MISSING_SKU");
  });
});

describe("đọc khổ linh hoạt", () => {
  it("đưa mọi cách viết về ngang-cao theo cm", () => {
    expect(sizeCodeFromText("0.9m ngang x 1m cao")).toBe("90-100");
    expect(sizeCodeFromText("1m ngang x 1.35m cao")).toBe("100-135");
    expect(sizeCodeFromText("2m ngang x 1.35m cao")).toBe("200-135");
    expect(sizeCodeFromText("1.35m ngang x 2m cao")).toBe("135-200");
    expect(sizeCodeFromText("1.35m ngangx1.5m cao")).toBe("135-150");
    expect(sizeCodeFromText("0.7*1.2m")).toBe("70-120");
    expect(sizeCodeFromText("Ngang:0,7mxcao:1m2")).toBe("70-120");
    expect(sizeCodeFromText("Xanh || 1.35m ngang x 2m cao")).toBe("135-200");
  });
});

describe("đối chiếu chuỗi tên trên trang với tên master", () => {
  function masterFrom(text: string): Map<string, CachedMasterRow> {
    const parsed = parseMasterFile(Buffer.from(text), "master.csv");
    if (!parsed.ok) throw new Error("không đọc được master");
    return new Map(parsed.rows.map((row) => [row.skuKey, {
      sku: row.sku,
      sku_key: row.skuKey,
      standard_price: row.standardPrice,
      retail_price: row.retailPrice,
      name: row.name,
      attributes: row.attributes,
    }]));
  }

  const pageName = "Rèm cửa trơn 2 lớp, Rèm Sao dán tường chống nắng, rèm cửa dán trang trí cửa sổ,phòng khách. · ending in 2 days 13 hours, Xanh than 2 lớp, ngang 1m8 x dài 2m, Decrease";

  const csv = [
    "SKU,Tên SP,Giá Bán Lẻ (VNĐ),Giá Đăng",
    "PE/XT-180-200,\"Xanh than 2 lớp, ngang 1m8 x dài 2m\",80000,90000",
    "PE/XT-SHORT,Xanh than 2 lớp,70000,75000",
    "PE/XT-1L,\"Xanh than 1 lớp, ngang 1m8 x dài 2m\",60000,65000",
  ].join("\n");

  it("lấy SKU và giá khi tên master nằm trong chuỗi tên trên trang", () => {
    const matched = classifyItem({
      sku: null,
      model_id: null,
      product_name: pageName,
      current_price: 90000,
      original_price: null,
    }, masterFrom(csv));
    expect(matched).toMatchObject({
      sku: "PE/XT-180-200",
      status: "WRONG_PRICE",
      standard_price: 90000,
      retail_price: 80000,
      difference: 10000,
    });
  });

  it("bỏ qua SKU trên trang, chỉ lấy SKU từ tên master khớp", () => {
    const matched = classifyItem({
      sku: "PE/XT-1L",
      model_id: "999",
      product_name: pageName,
      current_price: 100000,
      original_price: null,
    }, masterFrom(csv));
    expect(matched).toMatchObject({
      sku: "PE/XT-180-200",
      status: "WRONG_PRICE",
      standard_price: 90000,
      retail_price: 80000,
      difference: 20000,
    });
  });

  it("không lấy tên 1 lớp khi trang chứa tên 2 lớp", () => {
    const matched = classifyItem({
      sku: null,
      model_id: null,
      product_name: pageName,
      current_price: 90000,
      original_price: null,
    }, masterFrom(csv));
    expect(matched.sku).not.toBe("PE/XT-1L");
  });

  it("không khớp khi tên master không có trong chuỗi trên trang", () => {
    const master = masterFrom(csv);
    expect(classifyItem({
      sku: null,
      model_id: null,
      product_name: "Rèm cửa trơn 2 lớp, Hồng, ngang 1m x dài 2m",
      current_price: 90000,
      original_price: null,
    }, master).status).toBe("UNMAPPED");
  });
});
