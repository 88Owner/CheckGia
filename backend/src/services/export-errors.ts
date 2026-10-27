import ExcelJS from "exceljs";
import type { CheckResult, ItemStatus } from "../../../shared/types";

const HEADERS = [
  "SKU",
  "Model ID",
  "Product Name",
  "Giá Bán Lẻ",
  "Giá Đăng",
  "Shopee Price",
  "Original Price",
  "Difference",
  "Status",
  "Checked At",
] as const;

const RED = "FFFF6B6B";
const YELLOW = "FFFFFF00";
const GREEN = "FF00B050";
const ORANGE = "FFFFC000";

function rowColor(status: ItemStatus): string | null {
  if (status === "WRONG_PRICE") return RED;
  if (status === "UNMAPPED" || status === "MISSING_SKU") return YELLOW;
  if (status === "OK") return GREEN;
  if (status === "PRICE_PARSE_ERROR") return ORANGE;
  return null;
}

export async function buildErrorWorkbook(results: CheckResult[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Price");
  const header = sheet.addRow([...HEADERS]);
  header.font = { bold: true };
  for (const result of results) {
    const row = sheet.addRow([
      result.sku ?? "",
      result.model_id ?? "",
      result.product_name ?? "",
      result.retail_price,
      result.standard_price,
      result.current_price,
      result.original_price,
      result.difference,
      result.status,
      result.checked_at,
    ]);
    const color = rowColor(result.status);
    if (!color) continue;
    for (let column = 1; column <= HEADERS.length; column += 1) {
      row.getCell(column).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: color },
      };
    }
  }
  sheet.columns.forEach((column) => {
    column.width = 18;
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
