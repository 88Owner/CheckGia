import { useEffect, useState } from "react";

export const PAGE_SIZE = 10;

export function pageItems<T>(items: T[], page: number): T[] {
  const start = page * PAGE_SIZE;
  return items.slice(start, start + PAGE_SIZE);
}

export function Pager({ total, page, onPage }: { total: number; page: number; onPage: (page: number) => void }) {
  if (total <= PAGE_SIZE) return null;
  const pages = Math.ceil(total / PAGE_SIZE);
  const current = Math.min(page, pages - 1);
  const start = current * PAGE_SIZE;
  return (
    <div className="pager">
      <button type="button" disabled={current === 0} onClick={() => onPage(current - 1)}>Trước</button>
      <span>{start + 1}–{Math.min(start + PAGE_SIZE, total)} / {total}</span>
      <button type="button" disabled={current + 1 >= pages} onClick={() => onPage(current + 1)}>Sau</button>
    </div>
  );
}

export function useListPage(resetKey: unknown) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [resetKey]);
  return [page, setPage] as const;
}
