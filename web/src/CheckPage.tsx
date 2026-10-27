import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { fileToBase64, statusLabel, vnd } from "./format";
import { pageItems, Pager, useListPage } from "./Pager";

export type PlatformId = "shopee" | "tiktok";

interface PriceLine {
  sku: string | null;
  productName: string | null;
  variantName: string | null;
  retailPrice: number | null;
  comparePrice: number | null;
  masterPrice: number | null;
  difference: number | null;
  status: string;
}

interface Summary {
  total: number;
  ok: number;
  wrong_price: number;
  unmapped: number;
  error: number;
}

interface SavedCheck {
  id: number;
  filename: string;
  discountPercent: number | null;
  masterVersion: string | null;
  displayName: string;
  createdAt: string;
  summary: Summary;
}

type FilterMode = "issues" | "all" | "WRONG_PRICE" | "UNMAPPED" | "OK";

export function CheckPage({ platform, canCheck, onError }: { platform: PlatformId; canCheck: boolean; onError: (message: string) => void }) {
  const [discount, setDiscount] = useState("0");
  const [lines, setLines] = useState<PriceLine[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [fileName, setFileName] = useState("");
  const [filter, setFilter] = useState<FilterMode>("issues");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<SavedCheck[]>([]);

  async function loadHistory() {
    const data = await api<{ checks: SavedCheck[] }>(`/api/price-checks?platform=${platform}`);
    setHistory(data.checks);
  }

  useEffect(() => {
    setLines([]);
    setSummary(null);
    setFileName("");
    setFilter("issues");
    void loadHistory().catch((cause: Error) => onError(cause.message));
  }, [platform]);

  const visible = useMemo(() => lines.filter((line) => {
    if (filter === "all") return true;
    if (filter === "issues") return line.status !== "OK";
    return line.status === filter;
  }), [lines, filter]);
  const [linePage, setLinePage] = useListPage(`${filter}:${fileName}:${lines.length}`);
  const [historyPage, setHistoryPage] = useListPage(history.length);
  const shown = pageItems(visible, linePage);
  const historyShown = pageItems(history, historyPage);

  async function onFile(file: File | undefined) {
    if (!file) return;
    const percent = Number(discount);
    if (platform === "tiktok" && (!Number.isFinite(percent) || percent < 0 || percent > 100)) {
      onError("% Giảm giá phải từ 0 đến 100");
      return;
    }
    setBusy(true);
    onError("");
    try {
      const data = await api<{ check: SavedCheck; lines: PriceLine[] }>("/api/price-checks", {
        method: "POST",
        body: JSON.stringify({
          fileName: file.name,
          contentBase64: await fileToBase64(file),
          platform,
          discountPercent: platform === "tiktok" ? percent : null,
        }),
      });
      setLines(data.lines);
      setSummary(data.check.summary);
      setFileName(file.name);
      setFilter("issues");
      await loadHistory();
      const summaryText = data.check.summary;
      onError(`Đã check ${file.name}: ${summaryText.total} dòng, khớp ${summaryText.ok}, sai giá ${summaryText.wrong_price}.`);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Không check được file");
    } finally {
      setBusy(false);
    }
  }

  async function openCheck(id: number) {
    try {
      const data = await api<{ check: SavedCheck; lines: PriceLine[] }>(`/api/price-checks/${id}`);
      setLines(data.lines);
      setSummary(data.check.summary);
      setFileName(data.check.filename);
      if (data.check.discountPercent !== null) setDiscount(String(data.check.discountPercent));
      onError("");
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Không mở được lần check");
    }
  }

  function exportCsv() {
    const headers = platform === "tiktok"
      ? ["SKU người bán", "Tên sản phẩm", "Biến thể", "Giá bán lẻ", "Giá bán thực", "Giá sau giảm", "Chênh lệch", "Kết quả"]
      : ["SKU", "Tên sản phẩm", "Phân loại", "Giá đã giảm", "Giá sau giảm", "Chênh lệch", "Kết quả"];
    const rows = visible.map((line) => platform === "tiktok"
      ? [line.sku, line.productName, line.variantName, line.retailPrice, line.comparePrice, line.masterPrice, line.difference, statusLabel(line.status)]
      : [line.sku, line.productName, line.variantName, line.comparePrice, line.masterPrice, line.difference, statusLabel(line.status)]);
    const csv = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${platform}_check_gia.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const percent = Number(discount);

  return (
    <>
      <section className="card">
        <h2>Check giá {platform === "shopee" ? "Shopee" : "TikTok"}</h2>
        <p className="hint">
          {platform === "shopee"
            ? "File Shopee đối chiếu Số SKU Phân loại hàng (nếu trống thì Số SKU Sản phẩm) và cột Giá đã giảm với Giá Bán Lẻ (VNĐ) trong Master Data."
            : "File TikTok đối chiếu SKU người bán. Giá bán thực = Giá bán lẻ (Nội tệ) × (1 − % giảm), rồi so với Giá Bán Lẻ (VNĐ) trong Master Data."}
        </p>
        <div className="filters">
          {platform === "tiktok" && canCheck ? (
            <label>
              % Giảm giá
              <input type="number" min={0} max={100} step="0.01" value={discount} onChange={(event) => setDiscount(event.target.value)} />
            </label>
          ) : null}
          {canCheck ? (
            <label>
              File giá
              <input type="file" accept=".xlsx,.xls,.csv" disabled={busy} onChange={(event) => void onFile(event.target.files?.[0])} />
            </label>
          ) : <p className="hint">Tài khoản này chỉ được xem, không check giá.</p>}
        </div>
        {platform === "tiktok" && canCheck && Number.isFinite(percent) ? (
          <p className="hint">Giá bán thực = Giá bán lẻ × (1 − {percent}%). Ví dụ giá 100.000 còn {vnd(Math.round(100000 * (1 - percent / 100)))}.</p>
        ) : null}
      </section>
      {summary ? (
        <section className="cards">
          <article className="card"><span>{fileName || "Kết quả"}</span><b>{summary.total}</b></article>
          <article className="card"><span>Khớp</span><b className="ok-text">{summary.ok}</b></article>
          <article className="card"><span>Sai giá</span><b className="bad-text">{summary.wrong_price}</b></article>
          <article className="card"><span>Không có master</span><b>{summary.unmapped}</b></article>
          <article className="card"><span>Lỗi dòng</span><b>{summary.error}</b></article>
        </section>
      ) : null}
      {lines.length > 0 ? (
        <>
          <div className="filters">
            <select value={filter} onChange={(event) => setFilter(event.target.value as FilterMode)}>
              <option value="issues">Cần xử lý</option>
              <option value="all">Tất cả</option>
              <option value="WRONG_PRICE">Sai giá</option>
              <option value="UNMAPPED">Không có trong master</option>
              <option value="OK">Khớp</option>
            </select>
            <button type="button" onClick={exportCsv}>Tải CSV</button>
          </div>
          <div style={{ overflow: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Tên sản phẩm</th>
                  <th>{platform === "tiktok" ? "Biến thể" : "Phân loại"}</th>
                  {platform === "tiktok" ? <th>Giá bán lẻ</th> : null}
                  <th>{platform === "tiktok" ? "Giá bán thực" : "Giá đã giảm"}</th>
                  <th>Giá Bán Lẻ (VNĐ)</th>
                  <th>Chênh lệch</th>
                  <th>Kết quả</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((line, index) => (
                  <tr key={`${line.sku ?? "x"}-${index}`} className={line.status}>
                    <td>{line.sku ?? "—"}</td>
                    <td>{line.productName ?? "—"}</td>
                    <td>{line.variantName ?? "—"}</td>
                    {platform === "tiktok" ? <td>{vnd(line.retailPrice)}</td> : null}
                    <td>{vnd(line.comparePrice)}</td>
                    <td>{vnd(line.masterPrice)}</td>
                    <td>{line.difference === null ? "—" : vnd(line.difference)}</td>
                    <td>{statusLabel(line.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager total={visible.length} page={linePage} onPage={setLinePage} />
        </>
      ) : null}
      <section className="card">
        <h2>Lần check gần đây</h2>
        {history.length === 0 ? <p className="hint">Chưa có lần check nào trên nền tảng này.</p> : null}
        {history.length > 0 ? (
          <>
          <table>
            <thead>
              <tr><th>Thời gian</th><th>Người check</th><th>File</th><th>Sai giá</th><th>Version</th><th></th></tr>
            </thead>
            <tbody>
              {historyShown.map((item) => (
                <tr key={item.id}>
                  <td>{new Date(item.createdAt).toLocaleString("vi-VN")}</td>
                  <td>{item.displayName}</td>
                  <td>{item.filename}{item.discountPercent !== null ? ` · giảm ${item.discountPercent}%` : ""}</td>
                  <td>{item.summary.wrong_price}/{item.summary.total}</td>
                  <td>{item.masterVersion ?? "—"}</td>
                  <td><button type="button" onClick={() => void openCheck(item.id)}>Xem</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager total={history.length} page={historyPage} onPage={setHistoryPage} />
          </>
        ) : null}
      </section>
    </>
  );
}
