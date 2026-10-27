export interface HeaderMatch {
  raw: string;
  fold: string;
}

const SKU_PRIORITY = ["ma sku", "variation sku", "product sku", "ma san pham", "sku"];
const RETAIL_PRIORITY = ["gia ban le", "retail price", "gia le"];
const LISTED_PRIORITY = ["gia sau giam", "gia da giam", "gia dang", "gia chuan", "standard price", "listed price", "gia ban", "price", "gia"];
const NAME_PRIORITY = ["ten sp", "ten san pham", "product name", "ten", "name"];
const ATTRIBUTE_COMBINED = ["thuoc tinh", "phan loai", "variation", "bien the"];
const ATTRIBUTE_PARTS = ["mau", "kich thuoc", "size", "mau sac", "color"];

export function foldHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function pickHeader(headers: HeaderMatch[], priority: string[]): string | null {
  for (const token of priority) {
    const exact = headers.find((header) => header.fold === token);
    if (exact) return exact.raw;
  }
  for (const token of priority) {
    const partial = headers.find((header) => header.fold.includes(token));
    if (partial) return partial.raw;
  }
  return null;
}

export function detectColumns(rawHeaders: string[]): {
  skuColumn: string | null;
  priceColumn: string | null;
  retailColumn: string | null;
  nameColumn: string | null;
  attributeColumns: string[];
} {
  const headers = rawHeaders
    .map((raw) => ({ raw: raw.trim(), fold: foldHeader(raw) }))
    .filter((header) => header.raw.length > 0);

  const skuColumn = pickHeader(headers, SKU_PRIORITY);
  const retailColumn = pickHeader(
    headers.filter((header) => header.raw !== skuColumn),
    RETAIL_PRIORITY,
  );
  let priceColumn = pickHeader(
    headers.filter((header) => header.raw !== skuColumn && header.raw !== retailColumn),
    LISTED_PRIORITY,
  );
  if (!priceColumn && retailColumn) priceColumn = retailColumn;
  const used = new Set([skuColumn, priceColumn, retailColumn].filter((column): column is string => Boolean(column)));
  const nameColumn = pickHeader(
    headers.filter((header) => !used.has(header.raw)),
    NAME_PRIORITY,
  );
  if (nameColumn) used.add(nameColumn);

  const remaining = headers.filter((header) => !used.has(header.raw));
  const combined = remaining.find((header) => ATTRIBUTE_COMBINED.includes(header.fold));
  const attributeColumns = combined
    ? [combined.raw]
    : remaining.filter((header) => ATTRIBUTE_PARTS.includes(header.fold)).map((header) => header.raw);

  return { skuColumn, priceColumn, retailColumn, nameColumn, attributeColumns };
}
