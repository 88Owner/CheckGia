# Shopee Price Checker

Công cụ nội bộ để đối chiếu giá đang hiển thị trên trang **Quản lý sản phẩm** của Shopee Seller Center với Master Data dùng chung.

Extension chỉ đọc DOM của tab đang mở. Tài khoản Shopee không được dùng làm tài khoản hệ thống. Không đọc mật khẩu, OTP, cookie của Shopee, và không sửa dữ liệu trên Shopee.

Giá đối chiếu là cột **Giá Đăng**. Cột **Giá Bán Lẻ (VNĐ)** được lưu kèm để xem và xuất Excel. Nếu file chỉ có một cột giá (Giá chuẩn, Price, …) thì cột đó vẫn là giá đối chiếu.

## Chạy backend

```bash
cd backend
npm install
npm run dev
```

Kỳ vọng:

```text
Local Backend running:
http://127.0.0.1:8787
```

Kiểm tra:

```bash
curl http://127.0.0.1:8787/health
```

Cần Node.js 22.5 trở lên vì database dùng `node:sqlite`. Delay và giới hạn quét nằm trong `.env.example` ở thư mục gốc. Copy thành `.env` nếu muốn đổi `MAX_ITEMS`, `MIN_DELAY_MS`, `MAX_DELAY_MS`.

## Cài extension

```bash
cd extension
npm install
npm run build
```

Chrome → `chrome://extensions` → bật Developer mode → Load unpacked → chọn `extension/dist`.

Muốn xem giao diện trước khi cài extension:

```bash
cd extension
npm run dev
```

Mở `http://127.0.0.1:5173/popup.html`. Trang này chỉ gửi 3 sản phẩm mẫu tới backend. Khi đã Load unpacked, nút CHECK GIÁ đọc DOM của tab Shopee đang mở.

## Dùng

1. Đăng nhập Shopee Seller Center bằng chính tài khoản shop.
2. Mở trang Quản lý sản phẩm.
3. Bấm icon extension.
4. Đăng nhập Price Auditor trong popup. Admin upload file `.xlsx` hoặc `.csv` có cột SKU, Giá Bán Lẻ (VNĐ), Giá Đăng. File mẫu: `fixtures/master_data.csv`. Nhân viên thường dùng Master Data trên server, không upload từ máy mình.
5. Bấm **CHECK GIÁ**. Extension đọc tab hiện tại, cuộn danh sách tối đa 100 model, rồi gửi về backend.
6. Danh sách mặc định chỉ có sai giá, không có SKU trong Master Data, không đọc được giá, và SKU master không thấy trong lượt quét.
7. **EXPORT EXCEL** tải `shopee_price_errors.xlsx`.

Nếu backend chưa chạy, popup báo `Local Backend chưa chạy.` Nếu không đứng ở trang sản phẩm, popup báo `Vui lòng mở trang Quản lý sản phẩm Shopee.`

## Test

```bash
npm test --prefix backend
npm test --prefix extension
```

`extension/src/content/parser.test.ts` đọc `fixtures/product-list.html` và kiểm tra SKU, Model ID, giá hiện tại, giá gốc.

`backend/src/check.test.ts` import Master Data mẫu và kiểm tra:

| SKU | Shopee | Master | Kết quả |
| --- | --- | --- | --- |
| PE/D2-TH-100-120 | 67900 | 78625 | WRONG_PRICE |
| PE/D2-TrX-100-120 | 67900 | 78625 | WRONG_PRICE |
| PE/D2-TrX-120-150 | 103000 | 103000 | OK, không có trong danh sách lỗi |
| PE/D2-ABC-100-120 | không thấy | 50000 | NOT_FOUND |

## File nào làm gì

### Dùng chung

- `shared/price.ts`: `parseVndPrice()`, đổi `₫67.900` thành `67900`.
- `shared/sku.ts`: trim SKU, giữ `/` và `-`, khóa so sánh không phân biệt hoa thường.
- `shared/columns.ts`: nhận cột SKU và giá, hoặc trả về để người dùng chọn cột.
- `shared/status.ts`: đếm OK, sai giá, unmapped, not found, lỗi.
- `shared/types.ts`: kiểu dữ liệu dùng chung.

### Backend

- `backend/src/server.ts`: bind `0.0.0.0:8787` để máy trong LAN gọi được. Không publish cổng PostgreSQL.
- `backend/src/app.ts`: CORS whitelist dashboard và `chrome-extension://`, không dùng `*`.
- `backend/src/db/schema.ts`: PostgreSQL — users, shops, master_data_versions, master_products, check_runs, scraped_products, audit_logs.
- `backend/src/services/master-data.ts`: import `.xlsx` / `.csv`, version Master Data, cache theo version.
- `backend/src/services/check.ts`: so Giá Đăng, snapshot version lúc bắt đầu run, hàng đợi khi quá 10 lượt đồng thời.
- `backend/src/services/users.ts`: bcrypt, JWT, khóa tài khoản sau đăng nhập sai.
- `backend/src/services/export-errors.ts`: xuất Excel gồm Giá Bán Lẻ và Giá Đăng, không gồm dòng OK.

### Extension

- `extension/public/manifest.json`: Manifest V3, quyền `activeTab`, `storage`, `scripting`. Host LAN xin khi bấm Test Connection.
- `web/`: dashboard đăng nhập, tổng quan, lịch sử, Master Data, user, backup.
- `extension/src/background/index.ts`: service worker, nối popup với content script và backend.
- `extension/src/content/selectors.ts`: selector chính và fallback, không phụ thuộc class có hash.
- `extension/src/content/parser.ts`: tách tên, SKU phân loại, Model ID, giá hiện tại và giá gạch.
- `extension/src/content/scraper.ts`: đọc mọi `.model-list-item` đang có trong DOM.
- `extension/src/content/scroll.ts`: tìm container thật sự cuộn được.
- `extension/src/content/scanner.ts`: cuộn, chờ, chống trùng theo Model ID rồi tới SKU, dừng ở `MAX_ITEMS`.
- `extension/src/content/page.ts`: dừng nếu trang hiện CAPTCHA hoặc yêu cầu xác minh.
- `extension/src/popup/App.tsx`: popup CHECK GIÁ, tiến độ, Pause/Resume/Stop, lỗi, lịch sử, export.

## Server LAN (5–10 nhân viên)

Máy chủ ví dụ `192.168.1.100`. Chỉ mở firewall cho cổng 8388, 3000 và 8787 trong mạng LAN. Không mở PostgreSQL. Không đưa hệ thống ra Internet.

1. Clone project trên server.
2. Copy `.env.example` thành `.env`. Đặt `JWT_SECRET`, `ADMIN_PASSWORD` (ít nhất 8 ký tự) và `ALLOWED_ORIGINS=http://192.168.1.100:8388,http://192.168.1.100:3000`.
3. Chạy:

```bash
docker compose up -d
```

4. Mở `http://192.168.1.100:8388`. Cổng 3000 vẫn trỏ cùng dashboard. API cho extension vẫn là `http://192.168.1.100:8787`.
5. Đăng nhập Admin được tạo từ `ADMIN_USERNAME` / `ADMIN_PASSWORD`. Tạo Sale01, Sale02, … với role USER. Viewer chỉ xem báo cáo.

Backup từ dashboard (Admin → Backup Database) hoặc:

```bash
sh scripts/backup.sh
```

File nằm trong `backups/price_auditor_YYYY-MM-DD.sql`.

## Máy nhân viên

1. Mở Chrome.
2. Load unpacked `extension/dist`, hoặc cài extension đã build.
3. Popup → Server: `http://192.168.1.100:8787` → Machine Name: `PC-SALE-01` → Test Connection. Khi Chrome hỏi quyền, chọn Allow.
4. Đăng nhập Price Auditor (không phải tài khoản Shopee).
5. Mở Shopee Seller Center, vào Quản lý sản phẩm, bấm CHECK GIÁ.

USER chỉ thấy run của mình. ADMIN thấy toàn bộ, upload Master Data, quản lý user, export và backup. VIEWER không chạy scan và không upload.

## Giới hạn của bản này

Bản này quét đúng bộ lọc và trang đang mở, tối đa số model trong `MAX_ITEMS` (mặc định 100). NOT_FOUND nghĩa là SKU có trong Master Data nhưng không có trong lượt quét hiện tại, không phải toàn bộ shop. Có thể tắt bằng ô **Hiển thị NOT_FOUND**.
