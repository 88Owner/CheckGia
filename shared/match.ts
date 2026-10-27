const ATTRIBUTE_SPLIT = /\s*\|\|\s*/;

export function foldMatchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/gi, "d")
    .replace(/ơ/gi, "o")
    .replace(/ư/gi, "u")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function compactMatchText(value: string): string {
  return foldMatchText(value).replace(/ /g, "");
}

function containsPhrase(haystack: string, phrase: string): boolean {
  const words = haystack.split(" ").filter(Boolean);
  const needle = phrase.split(" ").filter(Boolean);
  if (needle.length === 0 || needle.length > words.length) return false;
  for (let index = 0; index <= words.length - needle.length; index += 1) {
    if (needle.every((word, offset) => words[index + offset] === word)) return true;
  }
  return false;
}

export function nameMatchScore(masterName: string, pageTitle: string): number {
  const master = foldMatchText(masterName);
  const page = foldMatchText(pageTitle);
  if (!master || !page) return 0;
  if (containsPhrase(page, master) || containsPhrase(master, page)) return master.length;
  return 0;
}

export interface ListingMasterRow {
  name: string | null;
  attributes: string | null;
  standard_price: number;
  retail_price?: number | null;
}

export function masterComparePrice(row: { standard_price: number; retail_price?: number | null }): number {
  return row.retail_price ?? row.standard_price;
}

const DIMENSION = String.raw`\d+(?:[.,]\d+)?m\d*`;

function dimensionToCm(token: string): number | null {
  const compact = token.toLowerCase().replace(/\s+/g, "");
  const decimal = compact.match(/^(\d+)[.,](\d+)m?$/);
  if (decimal) return Math.round(Number(`${decimal[1]}.${decimal[2]}`) * 100);
  const shorthand = compact.match(/^(\d+)m(\d+)$/);
  if (shorthand) return Math.round(Number(`${shorthand[1]}.${shorthand[2]}`) * 100);
  const meters = compact.match(/^(\d+)m$/);
  if (meters) return Number(meters[1]) * 100;
  return null;
}

function dimensionBeside(compact: string, keyword: "ngang" | "cao"): string | null {
  const before = compact.match(new RegExp(`(${DIMENSION})${keyword}`));
  if (before) return before[1];
  const after = compact.match(new RegExp(`${keyword}:?(${DIMENSION})`));
  if (after) return after[1];
  return null;
}

function sizeFromDimensions(widthToken: string, heightToken: string): string | null {
  const width = dimensionToCm(widthToken);
  const height = dimensionToCm(heightToken);
  if (width === null || height === null) return null;
  return `${width}-${height}`;
}

function sizeFromWords(compact: string): string | null {
  if (!compact.includes("ngang") || !compact.includes("cao")) return null;
  const width = dimensionBeside(compact, "ngang");
  const height = dimensionBeside(compact, "cao");
  if (!width || !height) return null;
  return sizeFromDimensions(width, height);
}

function sizeFromPair(compact: string): string | null {
  const match = compact.match(/^(\d+(?:[.,]\d+)?)(m\d*)?(?:\*|x|×)(\d+(?:[.,]\d+)?)(m\d*)?$/);
  if (!match) return null;
  const unit = match[2] || match[4] || "";
  return sizeFromDimensions(`${match[1]}${match[2] ?? unit}`, `${match[3]}${match[4] ?? unit}`);
}

export function sizeCodeFromText(value: string): string | null {
  for (const part of value.split(ATTRIBUTE_SPLIT)) {
    const compact = part.toLowerCase().replace(/\s+/g, "");
    const code = sizeFromWords(compact) ?? sizeFromPair(compact);
    if (code) return code;
  }
  return null;
}

function listingScore(row: ListingMasterRow, corpus: string): number {
  if (!row.name) return 0;
  const master = foldMatchText(row.name);
  if (master.length < 2 || !containsPhrase(corpus, master)) return 0;
  return master.length;
}

export function findMasterByListing<T extends ListingMasterRow>(
  pageTitle: string,
  selected: string | null,
  rows: Iterable<T>,
): T | null {
  const corpus = foldMatchText(`${pageTitle} ${(selected ?? "").replace(/\|\|/g, " ")}`);
  if (!corpus) return null;
  let best = 0;
  const matched: T[] = [];
  for (const row of rows) {
    const score = listingScore(row, corpus);
    if (score > best) {
      best = score;
      matched.length = 0;
      matched.push(row);
    } else if (score > 0 && score === best) {
      matched.push(row);
    }
  }
  if (matched.length === 0) return null;
  if (matched.length === 1) return matched[0];
  const prices = new Set(matched.map((row) => masterComparePrice(row)));
  return prices.size === 1 ? matched[0] : null;
}
