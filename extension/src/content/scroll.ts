export interface ScrollTarget {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export function planScroll(target: ScrollTarget): { scrollTop: number; atEnd: boolean; moved: boolean } {
  const max = Math.max(0, target.scrollHeight - target.clientHeight);
  if (target.scrollTop >= max - 2) {
    return { scrollTop: target.scrollTop, atEnd: true, moved: false };
  }
  const viewport = target.clientHeight > 0 ? target.clientHeight : 600;
  const step = Math.max(240, Math.floor(viewport * 0.8));
  const scrollTop = Math.min(max, target.scrollTop + step);
  const moved = scrollTop > target.scrollTop + 1;
  return { scrollTop, atEnd: !moved || scrollTop >= max - 2, moved };
}

export function listScrollCandidates(start: Element): HTMLElement[] {
  const found: HTMLElement[] = [];
  let node = start.parentElement;
  while (node) {
    if (node instanceof HTMLElement) {
      const overflowY = getComputedStyle(node).overflowY;
      const canScroll =
        (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
        node.scrollHeight > node.clientHeight + 8;
      if (canScroll) found.push(node);
    }
    node = node.parentElement;
  }
  const scrolling = start.ownerDocument.scrollingElement;
  if (scrolling instanceof HTMLElement && scrolling.scrollHeight > scrolling.clientHeight + 8) {
    found.push(scrolling);
  }
  return found;
}

export function pickScrollContainer(candidates: HTMLElement[]): HTMLElement | null {
  for (const candidate of candidates) {
    const before = candidate.scrollTop;
    const planned = planScroll(candidate);
    if (!planned.moved) continue;
    candidate.scrollTop = planned.scrollTop;
    const changed = candidate.scrollTop > before + 1;
    candidate.scrollTop = before;
    if (changed) return candidate;
  }
  return candidates[0] ?? null;
}

export function applyScroll(target: Element): { atEnd: boolean; moved: boolean } {
  const before = target.scrollTop;
  const planned = planScroll(target);
  if (!planned.moved) return { atEnd: true, moved: false };
  target.scrollTop = planned.scrollTop;
  const doc = target.ownerDocument;
  if (target === doc.scrollingElement || target === doc.documentElement) {
    doc.defaultView?.scrollTo(0, target.scrollTop);
  }
  const moved = target.scrollTop > before + 1;
  if (!moved) return { atEnd: true, moved: false };
  const max = Math.max(0, target.scrollHeight - target.clientHeight);
  return { atEnd: target.scrollTop >= max - 2, moved: true };
}

export function scrollModelList(doc: Document): { atEnd: boolean; moved: boolean } {
  const first = doc.querySelector(".model-list-item, [class*='model-list-item']");
  const candidates = first ? listScrollCandidates(first) : [];
  const target = pickScrollContainer(candidates) ?? doc.scrollingElement ?? doc.documentElement;
  if (!target) return { atEnd: true, moved: false };
  return applyScroll(target);
}
