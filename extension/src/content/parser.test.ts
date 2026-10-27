import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { parseModelElement } from "./parser";
import { scrapeVisibleModels } from "./scraper";

const fixture = readFileSync(fileURLToPath(new URL("../../../fixtures/product-list.html", import.meta.url)), "utf8");

describe("parser fixture", () => {
  it("đọc SKU, Model ID, giá hiện tại và giá gốc của 3 model", () => {
    const { document } = parseHTML(fixture);
    const items = scrapeVisibleModels(document);

    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      sku: "PE/D2-TH-100-120",
      model_id: "440089298348",
      product_name: "Thông Hồng,Ngang:1mxcao:1m2",
      current_price: 67900,
      original_price: 78625,
    });
    expect(items[1]).toMatchObject({
      sku: "PE/D2-TrX-100-120",
      model_id: "440089298362",
      product_name: "Trời Xanh,Ngang:1mxcao:1m2",
      current_price: 67900,
      original_price: 74875,
    });
    expect(items[2]).toMatchObject({
      sku: "PE/D2-TrX-120-150",
      model_id: "260446367237",
      product_name: "Trời Xanh,Ngang:1m2xcao:1m5",
      current_price: 103000,
      original_price: 112500,
    });
  });

  it("không lấy giá trong thẻ del làm giá hiện tại", () => {
    const { document } = parseHTML(`
      <div class="model-list-item">
        <div class="variation-name-info">
          <div class="variation-name-info-name">Chỉ có giá gạch</div>
          <div class="variation-name-info-sku">SKU phân loại: ONLY-DEL</div>
          <div class="variation-name-info-sku">Model ID: 123</div>
        </div>
        <div class="list-view-model-price"><del>₫74.875</del></div>
      </div>
    `);
    const [item] = scrapeVisibleModels(document);
    expect(item.current_price).toBeNull();
    expect(item.original_price).toBe(74875);
  });

  it("fallback SKU cấp sản phẩm khi không có SKU phân loại", () => {
    const { document } = parseHTML(`
      <div class="product-card">
        <div class="product-sku">SKU sản phẩm: PARENT-1</div>
        <div class="model-list-item">
          <div class="variation-name-info">
            <div class="variation-name-info-name">Chỉ có tên</div>
            <div class="variation-name-info-sku">Model ID: 999</div>
          </div>
          <div class="list-view-model-price"><span>₫10.000</span></div>
        </div>
      </div>
    `);
    const [item] = scrapeVisibleModels(document);
    expect(item.sku).toBe("PARENT-1");
    expect(item.model_id).toBe("999");
    expect(item.current_price).toBe(10000);
  });

  it("để trống SKU khi không tìm thấy", () => {
    const { document } = parseHTML(`
      <div class="model-list-item">
        <div class="variation-name-info">
          <div class="variation-name-info-name">Thiếu mã</div>
          <div class="variation-name-info-sku">Model ID: 555</div>
        </div>
        <div class="list-view-model-price"><span>₫12.000</span></div>
      </div>
    `);
    expect(parseModelElement(document.querySelector(".model-list-item") as Element).sku).toBeNull();
  });

  it("đọc mọi biến thể trong HTML, không cần bấm từng thuộc tính", () => {
    const { document } = parseHTML(`
      <h1>Rèm dán rèm cửa dán 2 lớp dày dặn</h1>
      <section aria-live="polite"><div>80.000₫</div></section>
      <button class="selection-box-selected" aria-label="Xanh">Xanh</button>
      <script type="application/json">
        {"item":{
          "tier_variations":[
            {"name":"Màu Sắc","options":["Hồng","Xanh"]},
            {"name":"Kích Cỡ","options":["0.7*1m","0.7*1.2m"]}
          ],
          "models":[
            {"model_id":11,"name":"Hồng,0.7*1m","tier_index":[0,0],"price":5000000000},
            {"model_id":22,"name":"Xanh,0.7*1.2m","tier_index":[1,1],"price":8000000000,"price_before_discount":10000000000}
          ]
        }}
      </script>
    `);
    const items = scrapeVisibleModels(document);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      model_id: "11",
      product_name: "Rèm dán rèm cửa dán 2 lớp dày dặn",
      attributes: "Hồng || 0.7*1m",
      current_price: 50000,
      original_price: null,
    });
    expect(items[1]).toMatchObject({
      model_id: "22",
      attributes: "Xanh || 0.7*1.2m",
      current_price: 80000,
      original_price: 100000,
    });
  });

  it("đọc biến thể từ JSON get_pc, tier_index nằm trong extinfo", () => {
    const { document } = parseHTML(`
      <h1>Rèm dán rèm cửa dán 2 lớp dày dặn</h1>
      <script id="spc-page-data" type="application/json">
        {"data":{"item":{
          "tier_variations":[{"name":"Màu","options":["Hồng","Xanh"]},{"name":"Size","options":["0.7*1m","0.7*1.2m"]}],
          "models":[
            {"modelid":11,"name":"Hồng,0.7*1m","price":{"single_value":5000000000},"extinfo":{"tier_index":[0,0]}},
            {"modelid":22,"name":"Xanh,0.7*1.2m","price":8000000000,"price_before_discount":10000000000,"extinfo":{"tier_index":[1,1]}}
          ]
        }}}
      </script>
    `);
    const items = scrapeVisibleModels(document);
    expect(items.map((item) => item.attributes)).toEqual(["Hồng || 0.7*1m", "Xanh || 0.7*1.2m"]);
    expect(items.map((item) => item.current_price)).toEqual([50000, 80000]);
    expect(items[1]?.original_price).toBe(100000);
  });

  it("đọc giá bán, giá gốc và phân loại đang chọn trên trang chi tiết", () => {
    const { document } = parseHTML(`
      <div class="flex-auto flex-column xvTkTc">
        <h1 class="auau1S">Rèm Cửa Dán Tường 2 Lớp</h1>
        <section aria-live="polite">
          <div class="nt0EaI">
            <div class="pyzxvq pw3J3G">50.000₫</div>
            <div class="CcxgW6">62.500₫</div>
            <div class="JGPGqv">-20%</div>
          </div>
        </section>
        <section>
          <h2>Mẫu</h2>
          <button class="lK5dVS selection-box-unselected" aria-label="Quả Bơ"><span>Quả Bơ</span></button>
          <button class="lK5dVS selection-box-selected" aria-label="Quả Dứa"><span>Quả Dứa</span></button>
        </section>
        <section>
          <h2>Kích thước</h2>
          <button class="lK5dVS selection-box-selected" aria-label="Ngang:0,7mxcao:1m2"><span>Ngang:0,7mxcao:1m2</span></button>
          <button class="lK5dVS selection-box-unselected" aria-label="Ngang:1mxcao:1m"><span>Ngang:1mxcao:1m</span></button>
        </section>
        <div>21 pieces available</div>
      </div>
    `);
    const items = scrapeVisibleModels(document);
    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({
      sku: null,
      product_name: "Rèm Cửa Dán Tường 2 Lớp",
      attributes: "Quả Dứa || Ngang:0,7mxcao:1m2",
      current_price: 50000,
      original_price: 62500,
    });
    expect(items.filter((item) => item.current_price === null)).toHaveLength(3);
  });

  it("đọc màu và kích thước từ thẻ div, giá lấy ở div giá của tổ hợp đang chọn", () => {
    const { document } = parseHTML(`
      <h1>Rèm dán rèm cửa dán 2 lớp dày dặn</h1>
      <div><div>80.000₫</div></div>
      <div>
        <div>Màu Sắc</div>
        <div>
          <div aria-label="Hồng">Hồng</div>
          <div aria-label="Xanh" class="selection-box-selected">Xanh</div>
        </div>
      </div>
      <div>
        <div>Kích thước</div>
        <div>
          <div aria-label="0.7*1m">0.7*1m</div>
          <div aria-label="0.7*1.2m" class="selection-box-selected">0.7*1.2m</div>
        </div>
      </div>
    `);
    const items = scrapeVisibleModels(document);
    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({
      product_name: "Rèm dán rèm cửa dán 2 lớp dày dặn",
      attributes: "Xanh || 0.7*1.2m",
      current_price: 80000,
    });
    expect(items.map((item) => item.attributes).sort()).toEqual([
      "Hồng || 0.7*1.2m",
      "Hồng || 0.7*1m",
      "Xanh || 0.7*1.2m",
      "Xanh || 0.7*1m",
    ]);
  });

  it("gắn giá đang hiện vào màu và khổ đang chọn, bỏ nút số lượng và đếm ngược", () => {
    const { document } = parseHTML(`
      <h1>Rèm cửa trơn 2 lớp</h1>
      <div><div>89.000₫</div><div>120.000₫</div><div>-20%</div></div>
      <button aria-label="ending in 2 ngày 12 giờ">ending in 2 ngày 12 giờ</button>
      <div>
        <div aria-label="Xanh than 2 lớp" class="selection-box-selected">Xanh than 2 lớp</div>
        <div aria-label="Màu Hồng 2 lớp">Màu Hồng 2 lớp</div>
      </div>
      <div>
        <div aria-label="ngang 1m8 x dài 2m" class="selection-box-selected">ngang 1m8 x dài 2m</div>
        <div aria-label="ngang 0,9m x dài 1m">ngang 0,9m x dài 1m</div>
      </div>
      <button aria-label="Decrease">Decrease</button>
      <button aria-label="Increase">Increase</button>
    `);
    const items = scrapeVisibleModels(document);
    const selected = items.find((item) => item.current_price === 89000);
    expect(selected).toMatchObject({
      attributes: "Xanh than 2 lớp || ngang 1m8 x dài 2m",
      current_price: 89000,
      original_price: 120000,
    });
    expect(items.some((item) => /decrease|increase|ending in/i.test(item.attributes ?? ""))).toBe(false);
    expect(items.filter((item) => item.current_price !== null)).toHaveLength(1);
  });

  it("khi chưa đánh dấu nút đang chọn vẫn lấy Shopee Price và Original Price đang hiện", () => {
    const { document } = parseHTML(`
      <h1>Rèm cửa trơn 2 lớp</h1>
      <section aria-live="polite">
        <div>89.000₫</div>
        <div>120.000₫</div>
        <div>-20%</div>
      </section>
      <div>
        <div aria-label="Xanh than 2 lớp">Xanh than 2 lớp</div>
        <div aria-label="Màu Hồng 2 lớp">Màu Hồng 2 lớp</div>
      </div>
      <div>
        <div aria-label="ngang 1m8 x dài 2m">ngang 1m8 x dài 2m</div>
      </div>
    `);
    const items = scrapeVisibleModels(document);
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.current_price === 89000 && item.original_price === 120000)).toBe(true);
  });

  it("đọc màu Xanh và khổ 0.7*1.2m, không lấy khoảng giá làm giá bán", () => {
    const { document } = parseHTML(`
      <h1>Rèm dán rèm cửa dán 2 lớp dày dặn</h1>
      <section aria-live="polite"><div>50.000₫ - 170.000₫</div></section>
      <button class="selection-box-selected" aria-label="Xanh"><span>Xanh</span></button>
      <button class="selection-box-unselected" aria-label="0.7*1.2m"><span>0.7*1.2m</span></button>
    `);
    const items = scrapeVisibleModels(document);
    expect(items.map((item) => item.attributes)).toEqual(["Xanh", "0.7*1.2m"]);
    expect(items.every((item) => item.current_price === null && item.original_price === null)).toBe(true);
  });

  it("lấy SKU trên trang chi tiết khi trang có dòng SKU", () => {
    const { document } = parseHTML(`
      <h1>Rèm</h1>
      <div>SKU phân loại: PE/D2-TH-100-120</div>
      <section aria-live="polite"><div><span>67.900₫</span></div></section>
    `);
    const [item] = scrapeVisibleModels(document);
    expect(item.sku).toBe("PE/D2-TH-100-120");
    expect(item.current_price).toBe(67900);
    expect(item.original_price).toBeNull();
  });
});
