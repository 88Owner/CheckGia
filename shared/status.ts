import type { ItemStatus, Summary } from "./types";

export function emptySummary(): Summary {
  return {
    total: 0,
    ok: 0,
    wrong_price: 0,
    unmapped: 0,
    not_found: 0,
    error: 0,
  };
}

export function summarize(statuses: Iterable<ItemStatus | string>): Summary {
  const summary = emptySummary();
  for (const status of statuses) {
    if (status !== "NOT_FOUND") summary.total += 1;
    if (status === "OK") summary.ok += 1;
    else if (status === "WRONG_PRICE") summary.wrong_price += 1;
    else if (status === "UNMAPPED") summary.unmapped += 1;
    else if (status === "NOT_FOUND") summary.not_found += 1;
    else summary.error += 1;
  }
  return summary;
}

export function isErrorStatus(status: string): boolean {
  return status !== "OK";
}

export function isVisibleStatus(
  status: string,
  options: { includeOk: boolean; includeNotFound: boolean },
): boolean {
  if (status === "OK") return options.includeOk;
  if (status === "NOT_FOUND") return options.includeNotFound;
  return true;
}
