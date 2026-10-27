import { describe, expect, it } from "vitest";
import { applyDiscount, checkPriceMatrix, parseMoney } from "../../shared/platform-file";

const master = [
  { sku: "PE/D2-TH-100-120", name: "Thảm 100", price: 78625 },
  { sku: "PE/D2-TrX-120-150", name: "Thảm 120", price: 103000 },
];

describe("parseMoney", () => {
  it("đọc giá có dấu phân cách và phần thập phân", () => {
    expect(parseMoney("67.900")).toBe(67900);
    expect(parseMoney("199000.4")).toBe(199000);
    expect(parseMoney("1,990,000.5")).toBe(1990001);
    expect(parseMoney("")).toBeNull();
  });
});

describe("check file Shopee", () => {
  const matrix = [[
    "Mã sản phẩm",
    "Tên Sản phẩm (Tùy chọn)",
    "Số SKU Sản phẩm (Tùy chọn)",
    "Mã phân loại hàng",
    "Tên phân loại hàng (Tùy chọn)",
    "Số SKU Phân loại hàng (Tùy chọn)",
    "Giá gốc (Tùy chọn)",
    "Giá đã giảm",
    "Giới hạn đặt hàng (Tùy chọn)",
  ], [
    "100", "Thảm", "PARENT-1", "200", "Đỏ", "PE/D2-TH-100-120", "80000", "67900", "10",
  ], [
    "101", "Thảm lớn", "", "201", "Xanh", "PE/D2-TrX-120-150", "120000", "103.000", "",
  ], [
    "102", "Lạ", "PARENT-2", "202", "Vàng", "KHONG-CO", "10000", "9000", "",
  ], [
    "103", "Thiếu sku", "", "203", "Đen", "", "10000", "9000", "",
  ]];

  it("đối chiếu SKU phân loại và Giá đã giảm với giá sau giảm", () => {
    const checked = checkPriceMatrix(matrix, "shopee", 0, master);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.lines.map((line) => [line.sku, line.comparePrice, line.status])).toEqual([
      ["PE/D2-TH-100-120", 67900, "WRONG_PRICE"],
      ["PE/D2-TrX-120-150", 103000, "OK"],
      ["KHONG-CO", 9000, "UNMAPPED"],
      [null, null, "MISSING_SKU"],
    ]);
    expect(checked.summary).toMatchObject({ total: 4, ok: 1, wrong_price: 1, unmapped: 1, error: 1 });
  });

  it("dùng Số SKU Sản phẩm khi không có SKU phân loại", () => {
    const checked = checkPriceMatrix([
      ["Số SKU Sản phẩm (Tùy chọn)", "Giá đã giảm"],
      ["PE/D2-TrX-120-150", 103000],
    ], "shopee", 0, master);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.lines[0]).toMatchObject({ sku: "PE/D2-TrX-120-150", status: "OK" });
  });
});

describe("check file TikTok", () => {
  it("tính giá bán thực bằng giá bán lẻ nhân (1 - % giảm)", () => {
    expect(applyDiscount(100000, 10)).toBe(90000);
    const checked = checkPriceMatrix([
      ["Hướng dẫn bỏ qua"],
      ["ID sản phẩm", "Hạng mục", "Tên sản phẩm", "ID SKU", "Tùy chọn biến thể", "Giá bán lẻ (Nội tệ)", "SKU người bán"],
      ["1", "Home", "Thảm", "99", "Đỏ", 100000, "PE/D2-TH-100-120"],
      ["2", "Home", "Thảm lớn", "100", "Xanh", 103000, "PE/D2-TrX-120-150"],
    ], "tiktok", 0, master);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.lines[0]).toMatchObject({ comparePrice: 100000, status: "WRONG_PRICE" });
    expect(checked.lines[1]).toMatchObject({ comparePrice: 103000, status: "OK" });

    const discounted = checkPriceMatrix([
      ["ID sản phẩm", "Hạng mục", "Tên sản phẩm", "ID SKU", "Tùy chọn biến thể", "Giá bán lẻ (Nội tệ)", "SKU người bán"],
      ["2", "Home", "Thảm lớn", "100", "Xanh", 200000, "PE/D2-TrX-120-150"],
    ], "tiktok", 48.5, master);
    expect(discounted.ok).toBe(true);
    if (!discounted.ok) return;
    expect(discounted.lines[0].comparePrice).toBe(103000);
    expect(discounted.lines[0].status).toBe("OK");
  });
});
