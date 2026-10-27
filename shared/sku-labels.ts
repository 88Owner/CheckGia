export interface SkuLookup {
  patterns: Map<string, string>;
  types: Map<string, string>;
}

export interface SkuLabels {
  patternName: string | null;
  typeName: string | null;
  sizeLabel: string | null;
}

export function codeKey(value: string): string {
  return value.trim().toLocaleLowerCase("vi");
}

export function emptyLookup(): SkuLookup {
  return { patterns: new Map(), types: new Map() };
}

export function parseSkuLabels(sku: string, lookup: SkuLookup = emptyLookup()): SkuLabels {
  const body = sku.includes("/") ? sku.slice(sku.indexOf("/") + 1) : sku;
  const parts = body.split("-").map((part) => part.trim()).filter(Boolean);
  let sizeIndex = -1;
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (/^\d+$/.test(parts[index]) && /^\d+$/.test(parts[index + 1])) {
      sizeIndex = index;
      break;
    }
  }

  const typeCode = parts[0] ?? "";
  let patternCode = "";
  let sizeLabel: string | null = null;
  if (sizeIndex > 0) {
    patternCode = parts.slice(1, sizeIndex).join("-");
    sizeLabel = `${parts[sizeIndex]}-${parts[sizeIndex + 1]}`;
  } else if (sizeIndex < 0 && parts.length > 1) {
    patternCode = parts.slice(1).join("-");
  }

  const patternName = patternCode ? lookup.patterns.get(codeKey(patternCode)) ?? null : null;
  const typeName = typeCode ? lookup.types.get(codeKey(typeCode)) ?? null : null;
  return { patternName, typeName, sizeLabel };
}
