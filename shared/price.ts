const THOUSANDS = /^\d{1,3}([.,]\d{3})+$/;

export function parseVndPrice(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    const rounded = Math.round(input);
    if (!Number.isSafeInteger(rounded) || rounded < 0) return null;
    return rounded;
  }

  let value = input.replace(/[\u00a0\u202f\s]/g, "");
  value = value.replace(/₫/g, "").replace(/đ/gi, "").replace(/vnd/gi, "");
  if (!value || !/^[\d.,]+$/.test(value)) return null;

  if (THOUSANDS.test(value)) {
    value = value.replace(/[.,]/g, "");
  } else if (!/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return null;
  return parsed;
}

export function formatVnd(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("vi-VN").format(value);
}
