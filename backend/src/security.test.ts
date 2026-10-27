import { describe, expect, it } from "vitest";
import { detectColumns } from "../../shared/columns";
import { parseVndPrice } from "../../shared/price";
import { normalizeSku, skuKey } from "../../shared/sku";
import { assertBindHost, isAllowedOrigin } from "./config";

describe("parseVndPrice", () => {
  it("đổi các dạng giá VND về số nguyên", () => {
    expect(parseVndPrice("₫67.900")).toBe(67900);
    expect(parseVndPrice("₫103.000")).toBe(103000);
    expect(parseVndPrice("₫145.000")).toBe(145000);
    expect(parseVndPrice("67.900")).toBe(67900);
    expect(parseVndPrice("103.000")).toBe(103000);
    expect(parseVndPrice("145.000")).toBe(145000);
    expect(parseVndPrice(78625)).toBe(78625);
  });

  it("trả null khi không đọc được giá", () => {
    expect(parseVndPrice("")).toBeNull();
    expect(parseVndPrice("abc")).toBeNull();
    expect(parseVndPrice(null)).toBeNull();
  });
});

describe("sku", () => {
  it("chỉ trim và so sánh không phân biệt hoa thường", () => {
    expect(normalizeSku(" PE/D2-TrX-100-120 ")).toBe("PE/D2-TrX-100-120");
    expect(skuKey("PE/D2-TrX-100-120")).toBe(skuKey("pe/d2-trx-100-120"));
    expect(normalizeSku("PE/D2-TrX-100-120")).toContain("/");
    expect(normalizeSku("PE/D2-TrX-100-120")).toContain("-");
  });
});

describe("columns", () => {
  it("nhận SKU, Giá Bán Lẻ và Giá Đăng", () => {
    expect(detectColumns(["SKU", "Giá Bán Lẻ (VNĐ)", "Giá Đăng"])).toMatchObject({
      skuColumn: "SKU",
      retailColumn: "Giá Bán Lẻ (VNĐ)",
      priceColumn: "Giá Đăng",
    });
  });

  it("nhận cột SKU và giá chuẩn", () => {
    expect(detectColumns(["SKU", "Giá chuẩn"])).toMatchObject({
      skuColumn: "SKU",
      priceColumn: "Giá chuẩn",
      retailColumn: null,
    });
  });

  it("báo thiếu mapping khi tên cột lạ", () => {
    expect(detectColumns(["Code", "Amount"])).toMatchObject({
      skuColumn: null,
      priceColumn: null,
    });
  });
});

describe("security", () => {
  it("bind LAN hoặc localhost", () => {
    expect(assertBindHost("127.0.0.1")).toBe("127.0.0.1");
    expect(assertBindHost("localhost")).toBe("127.0.0.1");
    expect(assertBindHost("0.0.0.0")).toBe("0.0.0.0");
    expect(() => assertBindHost("8.8.8.8")).toThrow(/0\.0\.0\.0/);
  });

  it("không mở CORS cho origin bất kỳ", () => {
    const options = { extensionId: "", allowedOrigins: ["http://192.168.1.100", "http://192.168.1.100:3000"] };
    expect(isAllowedOrigin(undefined, options)).toBe(true);
    expect(isAllowedOrigin("https://evil.example", options)).toBe(false);
    expect(isAllowedOrigin("http://8.8.8.8:8388", options)).toBe(false);
    expect(isAllowedOrigin("http://192.168.1.100", options)).toBe(true);
    expect(isAllowedOrigin("http://192.168.1.100:8388", options)).toBe(true);
    expect(isAllowedOrigin("chrome-extension://abcdefghijklmnopabcdefghijklmnop", options)).toBe(true);
    expect(isAllowedOrigin("chrome-extension://abcdefghijklmnopabcdefghijklmnop", {
      extensionId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      allowedOrigins: options.allowedOrigins,
    })).toBe(false);
  });
});
