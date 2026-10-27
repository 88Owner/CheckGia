export const SELECTORS = {
  modelItem: [".model-list-item", '[class*="model-list-item"]'],
  variationInfo: [".variation-name-info"],
  variationName: [".variation-name-info-name", '[class*="variation-name-info-name"]'],
  variationSku: [".variation-name-info-sku", '[class*="variation-name-info-sku"]'],
  priceBox: [".list-view-model-price", '[class*="list-view-model-price"]', '[class*="ListViewPrice"]'],
};

export function queryFirst(root: ParentNode, selectors: string[]): Element | null {
  for (const selector of selectors) {
    const found = root.querySelector(selector);
    if (found) return found;
  }
  return null;
}

export function queryAll(root: ParentNode, selectors: string[]): Element[] {
  const seen = new Set<Element>();
  const result: Element[] = [];
  for (const selector of selectors) {
    root.querySelectorAll(selector).forEach((element) => {
      if (seen.has(element)) return;
      seen.add(element);
      result.push(element);
    });
  }
  return result;
}
