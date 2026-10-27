import { parseVndPrice } from "../../../shared/price";
import { normalizeSku } from "../../../shared/sku";
import type { ScrapedItem } from "../../../shared/types";
import { SELECTORS, queryAll, queryFirst } from "./selectors";

const MODEL_ID = /model\s*id\s*:\s*([0-9]+)/i;
const VARIATION_SKU = /sku\s*phân\s*loại\s*:\s*(.+)$/i;
const PRODUCT_SKU = /sku(?:\s*sản\s*phẩm)?\s*:\s*(.+)$/i;
const PRICE_TOKEN = /₫\s*\d[\d.]{0,20}|\d{1,3}(?:\.\d{3})+|\d{4,}/g;

export interface ParsedModel extends ScrapedItem {
  fingerprint: string;
}

function lineText(element: Element): string {
  return (element.textContent ?? "").replace(/\u00a0/g, " ").trim();
}

function priceTokens(text: string): number[] {
  const matches = text.match(PRICE_TOKEN) ?? [];
  const prices: number[] = [];
  for (const match of matches) {
    const price = parseVndPrice(match);
    if (price !== null) prices.push(price);
  }
  return prices;
}

function firstPrice(text: string): number | null {
  return priceTokens(text)[0] ?? null;
}

function leafPriceNodes(root: Element): Element[] {
  return [...root.querySelectorAll("div, span")].filter((node) => {
    if (node.children.length > 0) return false;
    return priceTokens(node.textContent ?? "").length > 0;
  });
}

export function extractPrices(root: Element): { current: number | null; original: number | null } {
  const originalText = [...root.querySelectorAll("del, s")].map((node) => node.textContent ?? "").join(" ");
  const clone = root.cloneNode(true) as Element;
  clone.querySelectorAll("del, s").forEach((node) => node.remove());
  return {
    current: firstPrice(clone.textContent ?? ""),
    original: firstPrice(originalText),
  };
}

export function findProductLevelSku(modelEl: Element): string | null {
  const root = modelEl.closest(
    '[class*="product-item"], [class*="product-card"], [class*="product-row"], [class*="list-card"]',
  );
  if (!root) return null;
  for (const node of root.querySelectorAll("div, span, p")) {
    if (node.closest(".model-list-item")) continue;
    const text = lineText(node);
    if (!/sku/i.test(text) || /model\s*id/i.test(text) || /phân\s*loại/i.test(text)) continue;
    const match = text.match(PRODUCT_SKU);
    if (match?.[1]) return normalizeSku(match[1]);
  }
  return null;
}

export function parseModelElement(modelEl: Element): ParsedModel {
  const nameElement = queryFirst(modelEl, SELECTORS.variationName);
  let productName = nameElement ? lineText(nameElement) : "";
  if (!productName) {
    const info = queryFirst(modelEl, SELECTORS.variationInfo) ?? modelEl;
    productName = lineText(info).split(/SKU|Model ID/i)[0]?.trim() ?? "";
  }

  let variationSku: string | null = null;
  let modelId: string | null = null;
  for (const node of queryAll(modelEl, SELECTORS.variationSku)) {
    const text = lineText(node);
    const modelMatch = text.match(MODEL_ID);
    if (modelMatch) {
      modelId = modelMatch[1];
      continue;
    }
    const variationMatch = text.match(VARIATION_SKU);
    if (variationMatch?.[1]) {
      variationSku = normalizeSku(variationMatch[1]);
      continue;
    }
    const productMatch = text.match(PRODUCT_SKU);
    if (productMatch?.[1] && !variationSku) {
      variationSku = normalizeSku(productMatch[1]);
    }
  }

  const priceRoot = queryFirst(modelEl, SELECTORS.priceBox);
  let prices: { current: number | null; original: number | null };
  if (priceRoot) {
    prices = extractPrices(priceRoot);
  } else {
    const clone = modelEl.cloneNode(true) as Element;
    clone
      .querySelectorAll(".variation-name-info, .variation-name-info-name, .variation-name-info-sku")
      .forEach((node) => node.remove());
    prices = extractPrices(clone);
  }

  return {
    sku: variationSku ?? findProductLevelSku(modelEl),
    model_id: modelId,
    product_name: productName || null,
    current_price: prices.current,
    original_price: prices.original,
    fingerprint: lineText(modelEl).slice(0, 180),
  };
}

function findSkuText(root: ParentNode): string | null {
  for (const node of root.querySelectorAll("div, span, p, li")) {
    if (node.children.length > 0) continue;
    const text = lineText(node);
    const variationMatch = text.match(VARIATION_SKU);
    if (variationMatch?.[1]) return normalizeSku(variationMatch[1]);
    if (/model\s*id/i.test(text)) continue;
    const productMatch = text.match(PRODUCT_SKU);
    if (productMatch?.[1]) return normalizeSku(productMatch[1]);
  }
  return null;
}

function listedPrices(section: Element): { current: number | null; original: number | null } {
  const text = section.textContent ?? "";
  const leaves = leafPriceNodes(section);
  const prices = priceTokens(text);
  const hasPercent = /-\s*\d+\s*%/.test(text);
  const looksLikeRange = !hasPercent && /[\d₫đ]\s*-\s*[\d₫đ]/i.test(text) && prices.length >= 2;
  if (looksLikeRange) return { current: null, original: null };
  return {
    current: leaves[0] ? priceTokens(leaves[0].textContent ?? "")[0] ?? null : prices[0] ?? null,
    original: leaves[1] ? priceTokens(leaves[1].textContent ?? "")[0] ?? null : null,
  };
}

const SKIP_OPTION = /^(tìm kiếm|trang chủ|chat|giỏ hàng|mua ngay|thêm vào giỏ hàng|xem thêm|đăng nhập|decrease|increase|giảm|tăng|\+|-|–)$/i;
const SKIP_PREFIX = /^(ending in|kết thúc trong)\b/i;

function optionLabel(element: Element): string | null {
  const label = element.getAttribute("aria-label")?.trim() || lineText(element);
  if (!label || label.length > 80 || SKIP_OPTION.test(label) || SKIP_PREFIX.test(label)) return null;
  if (priceTokens(label).length > 0 && !/[a-zA-Zà-ỹ]/.test(label)) return null;
  return label;
}

function isVariationOption(element: Element): boolean {
  const className = element.getAttribute("class") ?? "";
  const role = element.getAttribute("role");
  const tag = element.tagName;
  const marked = className.includes("selection-box")
    || element.hasAttribute("aria-label")
    || role === "radio"
    || role === "option"
    || role === "button";
  if (!marked || (tag !== "BUTTON" && tag !== "DIV" && tag !== "SPAN" && tag !== "A")) return false;
  const nested = [...element.querySelectorAll("[aria-label], [class*='selection-box']")].some(
    (child) => child !== element && optionLabel(child),
  );
  return !nested && optionLabel(element) !== null;
}

function isSelectedOption(element: Element): boolean {
  const className = element.getAttribute("class") ?? "";
  const classes = className.split(/\s+/);
  const markedSelected = classes.includes("selection-box-selected")
    || (/\bselected\b/i.test(className) && !/unselected/i.test(className));
  return markedSelected
    || element.querySelector(".selection-box-tick") !== null
    || element.getAttribute("aria-checked") === "true"
    || element.getAttribute("aria-pressed") === "true"
    || element.getAttribute("aria-selected") === "true";
}

function variationGroups(root: ParentNode): Element[][] {
  const groups = new Map<ParentNode, Element[]>();
  for (const element of root.querySelectorAll("button, div, span, a")) {
    if (!isVariationOption(element)) continue;
    const parent = element.parentElement ?? element.parentNode;
    if (!parent) continue;
    const group = groups.get(parent) ?? [];
    group.push(element);
    groups.set(parent, group);
  }
  return [...groups.values()].filter((group) => group.length > 0 && group.length <= 30);
}

function productBox(root: ParentNode): ParentNode {
  const heading = root.querySelector("h1");
  if (!heading) return root;
  let node = heading.parentElement;
  for (let depth = 0; node && depth < 8; depth += 1) {
    const options = [...node.querySelectorAll("button, div, span, a")].filter(isVariationOption);
    if (options.length > 0 && priceTokens(node.textContent ?? "").length > 0) return node;
    node = node.parentElement;
  }
  return heading.parentElement ?? root;
}

function priceBox(root: ParentNode): Element | null {
  const live = [...root.querySelectorAll('section[aria-live="polite"]')].find(
    (node) => priceTokens(node.textContent ?? "").length > 0,
  );
  if (live) return live;
  const leaf = [...root.querySelectorAll("div, span")].find((node) => {
    if (node.children.length > 0) return false;
    const text = lineText(node);
    return text.length > 0 && text.length <= 40 && priceTokens(text).length > 0;
  });
  if (!leaf) return null;
  const parent = leaf.parentElement;
  if (parent && lineText(parent).length <= 48) return parent;
  return leaf;
}

function combinations(groups: Element[][]): Element[][] {
  let rows: Element[][] = [[]];
  for (const group of groups) {
    rows = rows.flatMap((row) => group.map((option) => [...row, option]));
    if (rows.length > 80) return rows.slice(0, 80);
  }
  return rows.sort((left, right) => Number(right.every(isSelectedOption)) - Number(left.every(isSelectedOption)));
}

export function parseVariationDivs(root: ParentNode): ParsedModel[] {
  const box = productBox(root);
  const groups = variationGroups(box);
  if (groups.length === 0) return [];
  const prices = priceBox(box);
  const listed = prices ? listedPrices(prices) : { current: null, original: null };
  const title = root.querySelector("h1") ? lineText(root.querySelector("h1") as Element) : "";
  const rows = combinations(groups);
  const selectedRows = rows.filter((options) => options.every(isSelectedOption));
  const pricedRows = selectedRows.length > 0 ? selectedRows : rows;
  return rows.map((options) => {
    const attributes = options.map((option) => optionLabel(option)).filter((label): label is string => Boolean(label)).join(" || ");
    const priced = pricedRows.includes(options);
    return {
      sku: null,
      model_id: null,
      product_name: title || null,
      attributes: attributes || null,
      current_price: priced ? listed.current : null,
      original_price: priced ? listed.original : null,
      fingerprint: `${title}|${attributes}|${priced ? listed.current ?? "" : ""}`.slice(0, 180),
    };
  });
}

function selectedOptionLabels(root: ParentNode): string[] {
  const labels: string[] = [];
  for (const element of root.querySelectorAll("button, div, span")) {
    if (!isVariationOption(element) || !isSelectedOption(element)) continue;
    const label = optionLabel(element);
    if (label) labels.push(label);
  }
  return labels;
}

export function parseProductDetail(root: ParentNode): ParsedModel | null {
  const section = [...root.querySelectorAll('section[aria-live="polite"]')].find(
    (node) => priceTokens(node.textContent ?? "").length > 0,
  );
  if (!section) return null;

  const prices = listedPrices(section);
  const current = prices.current;
  const original = prices.original;

  const title = root.querySelector("h1") ? lineText(root.querySelector("h1") as Element) : "";
  const selected = selectedOptionLabels(root);
  const attributes = selected.length > 0 ? selected.join(" || ") : null;

  return {
    sku: findSkuText(root),
    model_id: null,
    product_name: title || null,
    attributes,
    current_price: current,
    original_price: original,
    fingerprint: `${title}|${attributes ?? ""}|${current ?? ""}|${original ?? ""}`.slice(0, 180),
  };
}
