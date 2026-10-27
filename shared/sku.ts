export function normalizeSku(sku: string): string {
  return sku.trim();
}

export function skuKey(sku: string): string {
  return normalizeSku(sku).toLocaleLowerCase("vi");
}

export function dedupeKey(item: {
  model_id?: string | null;
  sku?: string | null;
  product_name?: string | null;
  attributes?: string | null;
  current_price?: number | null;
  original_price?: number | null;
  fingerprint?: string | null;
}): string {
  const modelId = item.model_id?.trim();
  if (modelId) return `model:${modelId}`;
  const sku = item.sku?.trim();
  if (sku) return `sku:${skuKey(sku)}`;
  if (item.fingerprint?.trim()) return `fp:${item.fingerprint.trim()}`;
  return `fp:${item.product_name ?? ""}|${item.attributes ?? ""}|${item.current_price ?? ""}|${item.original_price ?? ""}`;
}
