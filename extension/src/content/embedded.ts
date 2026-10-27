import type { ParsedModel } from "./parser";

interface TierOption {
  options: string[];
}

interface RawModel {
  name: string | null;
  price: number | null;
  original: number | null;
  modelId: string | null;
  tierIndex: number[] | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function shopeeAmount(value: unknown): number | null {
  const record = asRecord(value);
  if (record) return shopeeAmount(record.single_value ?? record.value ?? record.price ?? record.price_before_discount);
  const raw = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : null;
  if (raw === null || !Number.isSafeInteger(raw) || raw < 0) return null;
  if (raw >= 100000 && raw % 100000 === 0) return raw / 100000;
  return raw;
}

function readTiers(value: unknown): TierOption[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const tiers: TierOption[] = [];
  for (const tier of value) {
    const record = asRecord(tier);
    if (!Array.isArray(record?.options)) return null;
    tiers.push({ options: record.options.map((option) => String(option).trim()).filter(Boolean) });
  }
  return tiers;
}

function readModel(value: unknown): RawModel | null {
  const record = asRecord(value);
  if (!record) return null;
  const price = shopeeAmount(record.price);
  if (price === null) return null;
  const original = shopeeAmount(record.price_before_discount);
  const extra = asRecord(record.extinfo);
  const modelId = record.model_id ?? record.modelid ?? record.modelId;
  const tierSource = record.tier_index ?? extra?.tier_index;
  const tierIndex = Array.isArray(tierSource) ? tierSource.map((index) => Number(index)) : null;
  return {
    name: typeof record.name === "string" ? record.name.trim() : null,
    price,
    original: original !== null && original !== price ? original : null,
    modelId: modelId === undefined || modelId === null ? null : String(modelId),
    tierIndex: tierIndex && tierIndex.every((index) => Number.isInteger(index)) ? tierIndex : null,
  };
}

function findCatalog(value: unknown): { tiers: TierOption[]; models: RawModel[] } | null {
  const record = asRecord(value);
  if (!record) return null;
  const tiers = readTiers(record.tier_variations ?? record.tier_variation) ?? [];
  const modelList = record.models ?? record.model;
  if (Array.isArray(modelList)) {
    const models = modelList.map(readModel).filter((model): model is RawModel => model !== null);
    if (models.length > 0 && (tiers.length > 0 || models.some((model) => model.name || model.tierIndex))) {
      return { tiers, models };
    }
  }
  for (const child of Object.values(record)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = findCatalog(item);
        if (found) return found;
      }
      continue;
    }
    const found = findCatalog(child);
    if (found) return found;
  }
  return null;
}

function extractBalanced(text: string, start: number): string | null {
  if (text[start] !== "{") return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escape) escape = false;
      else if (char === "\\") escape = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function objectAround(text: string, needleAt: number): unknown | null {
  let start = text.lastIndexOf("{", needleAt);
  for (let attempt = 0; start >= 0 && attempt < 12; attempt += 1) {
    const slice = extractBalanced(text, start);
    if (slice && slice.length < 5_000_000) {
      try {
        return JSON.parse(slice) as unknown;
      } catch {
        // Thử khối JSON rộng hơn.
      }
    }
    start = text.lastIndexOf("{", start - 1);
  }
  return null;
}

function catalogFromRaw(text: string): { tiers: TierOption[]; models: RawModel[] } | null {
  const needles = ['"tier_variations"', '"tier_variation"', '"modelid"', '"model_id"'];
  for (const needle of needles) {
    let from = 0;
    let hops = 0;
    while (from < text.length && hops < 8) {
      const at = text.indexOf(needle, from);
      if (at < 0) break;
      hops += 1;
      const parsed = objectAround(text, at);
      const catalog = parsed ? findCatalog(parsed) : null;
      if (catalog) return catalog;
      from = at + needle.length;
    }
  }
  return null;
}

function catalogFromText(text: string): { tiers: TierOption[]; models: RawModel[] } | null {
  return catalogFromRaw(text) ?? catalogFromRaw(text.replace(/\\u0022/g, '"').replace(/\\"/g, '"'));
}

function optionLabels(model: RawModel, tiers: TierOption[]): string[] {
  if (model.tierIndex && model.tierIndex.length === tiers.length) {
    const labels = model.tierIndex.map((index, tier) => tiers[tier]?.options[index] ?? "");
    if (labels.every(Boolean)) return labels;
  }
  return (model.name ?? "").split(",").map((part) => part.trim()).filter(Boolean);
}

export function modelsFromPageText(text: string, title: string | null): ParsedModel[] {
  const catalog = catalogFromText(text);
  if (!catalog) return [];
  return catalog.models.map((model) => {
    const labels = optionLabels(model, catalog.tiers);
    const attributes = labels.length > 0 ? labels.join(" || ") : null;
    return {
      sku: null,
      model_id: model.modelId,
      product_name: title,
      attributes,
      current_price: model.price,
      original_price: model.original,
      fingerprint: `${model.modelId ?? ""}|${attributes ?? ""}|${model.price ?? ""}`.slice(0, 180),
    };
  });
}

function scriptLooksLikeCatalog(text: string): boolean {
  return text.includes("tier_variation") || text.includes("modelid") || text.includes("model_id");
}

export function extractEmbeddedModels(root: ParentNode, title: string | null): ParsedModel[] {
  const captured = root.querySelector("#spc-page-data")?.textContent ?? "";
  if (scriptLooksLikeCatalog(captured)) {
    const models = modelsFromPageText(captured, title);
    if (models.length > 0) return models;
  }
  const scripts = [...root.querySelectorAll("script")]
    .map((script) => script.textContent ?? "")
    .filter(scriptLooksLikeCatalog);
  for (const text of scripts) {
    const models = modelsFromPageText(text, title);
    if (models.length > 0) return models;
  }
  const html = "documentElement" in root ? root.documentElement?.innerHTML ?? "" : "";
  if (scriptLooksLikeCatalog(html)) return modelsFromPageText(html, title);
  return [];
}
