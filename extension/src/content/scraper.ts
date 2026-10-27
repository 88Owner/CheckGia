import { extractEmbeddedModels } from "./embedded";
import { parseModelElement, parseProductDetail, parseVariationDivs, type ParsedModel } from "./parser";
import { SELECTORS, queryAll } from "./selectors";

export function scrapeVisibleModels(root: ParentNode): ParsedModel[] {
  const models = queryAll(root, SELECTORS.modelItem).map((element) => parseModelElement(element));
  if (models.length > 0) return models;
  const title = root.querySelector("h1")?.textContent?.replace(/\u00a0/g, " ").trim() || null;
  const embedded = extractEmbeddedModels(root, title);
  if (embedded.length > 0) return embedded;
  const variations = parseVariationDivs(root);
  if (variations.length > 0) return variations;
  const detail = parseProductDetail(root);
  return detail ? [detail] : [];
}
