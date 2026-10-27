export function sizeCaption(label: string): string {
  if (!label) return "Không có kích thước";
  const match = /^(\d+)-(\d+)$/.exec(label);
  if (!match) return label;
  return `${label} · ${meter(Number(match[1]))} × ${meter(Number(match[2]))}`;
}

function meter(cm: number): string {
  const text = (cm / 100).toFixed(2).replace(/0+$/, "").replace(/\.$/, "").replace(".", ",");
  return `${text}m`;
}

export function parseDong(text: string): number | null {
  const cleaned = text.trim().replace(/\s/g, "").replace(/\./g, "");
  if (!/^\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (value > 100_000_000) return null;
  return value;
}

export function vnd(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("vi-VN").format(value);
}

export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const size = 0x8000;
  for (let index = 0; index < bytes.length; index += size) {
    binary += String.fromCharCode(...bytes.subarray(index, index + size));
  }
  return btoa(binary);
}

export function roleLabel(role: string): string {
  if (role === "SALE" || role === "USER") return "Sale";
  if (role === "ADMIN") return "Admin";
  if (role === "IT") return "IT";
  if (role === "VIEWER") return "Viewer";
  return role;
}

export function canCheckPrices(role: string): boolean {
  return role === "ADMIN" || role === "IT" || role === "USER" || role === "SALE";
}

export function canManageMaster(role: string): boolean {
  return role === "ADMIN" || role === "IT";
}

export function canManageUsers(role: string): boolean {
  return role === "ADMIN" || role === "IT";
}

export function canViewLogs(role: string): boolean {
  return role === "IT";
}

export function statusLabel(status: string): string {
  if (status === "OK") return "Khớp";
  if (status === "WRONG_PRICE") return "Sai giá";
  if (status === "UNMAPPED") return "Không có trong master";
  if (status === "MISSING_SKU") return "Thiếu SKU";
  if (status === "PRICE_PARSE_ERROR") return "Không đọc được giá";
  return status;
}
