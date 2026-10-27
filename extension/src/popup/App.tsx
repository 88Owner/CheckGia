import { useEffect, useMemo, useRef, useState } from "react";
import { formatVnd } from "../../../shared/price";
import type { CheckResult, CheckRun, ColumnMapping, HealthInfo, Summary } from "../../../shared/types";
import { bytesToBase64 } from "../shared/backend-client";
import { CURRENT_PAGE_MESSAGE, EMPTY_PAGE_MESSAGE } from "../shared/seller";
import type { ExtensionBridge, PageStatus } from "./extension-bridge";
import { getBridge } from "./get-bridge";

type View = "main" | "errors" | "history";

const bridgeState = getBridge();

export function App() {
  const bridgeRef = useRef<ExtensionBridge>(bridgeState.bridge);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingFile = useRef<{ fileName: string; contentBase64: string } | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [offline, setOffline] = useState<string | null>(null);
  const [page, setPage] = useState<PageStatus | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [results, setResults] = useState<CheckResult[]>([]);
  const [runs, setRuns] = useState<CheckRun[]>([]);
  const [runId, setRunId] = useState<number | null>(null);
  const [view, setView] = useState<View>("main");
  const [scanning, setScanning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [scanned, setScanned] = useState(0);
  const [scanTotal, setScanTotal] = useState(100);
  const [banner, setBanner] = useState<string | null>(null);
  const [includeNotFound, setIncludeNotFound] = useState(true);
  const [showOk, setShowOk] = useState(false);
  const [masterFileName, setMasterFileName] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState("http://127.0.0.1:8787");
  const [machineName, setMachineName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mappingColumns, setMappingColumns] = useState<string[] | null>(null);
  const [skuColumn, setSkuColumn] = useState("");
  const [priceColumn, setPriceColumn] = useState("");
  const filters = useRef({ includeNotFound: true, showOk: false });
  filters.current = { includeNotFound, showOk };

  const bridge = bridgeRef.current;

  async function loadResults(nextRunId: number) {
    const options = filters.current;
    const response = await bridge.getResults(nextRunId, {
      includeOk: options.showOk,
      includeNotFound: options.includeNotFound,
    });
    if (response.summary) setSummary(response.summary);
    setResults(response.results);
  }

  async function loadPageProducts(nextRunId: number) {
    const response = await bridge.getResults(nextRunId, {
      includeOk: true,
      includeNotFound: false,
    });
    if (response.summary) setSummary(response.summary);
    setResults(response.results.filter((result) => result.status !== "NOT_FOUND"));
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      const [healthResponse, pageStatus, settings, history, session] = await Promise.all([
        bridge.health(),
        bridge.pageStatus(),
        bridge.getSettings(),
        bridge.listRuns(),
        bridge.getScanState(),
      ]);
      if (!active) return;
      if (healthResponse.ok) {
        setHealth(healthResponse);
        setOffline(null);
        setScanTotal(healthResponse.maxItems);
        setMasterFileName(healthResponse.masterVersion ?? healthResponse.masterFileName ?? settings.masterFileName);
        if (healthResponse.serverUrl) setServerUrl(healthResponse.serverUrl);
        if (healthResponse.machineName) setMachineName(healthResponse.machineName);
      } else {
        setOffline(healthResponse.error);
      }
      setPage(pageStatus);
      setIncludeNotFound(settings.includeNotFound);
      setShowOk(settings.showOk);
      setRuns(history);
      if (session.status === "running" || session.status === "paused") {
        setScanning(true);
        setPaused(session.status === "paused");
        setScanned(session.scanned ?? 0);
        setScanTotal(session.total ?? (healthResponse.ok ? healthResponse.maxItems : 100));
        if (session.summary) setSummary(session.summary);
        if (session.runId) setRunId(session.runId);
      }
    })();
    const unsubscribe = bridge.subscribe((event) => {
      if (event.type === "SCAN_PROGRESS") {
        setScanning(true);
        setScanned(event.scanned ?? 0);
        setScanTotal(event.total ?? 100);
        if (event.summary) setSummary(event.summary);
        if (event.runId) setRunId(event.runId);
      }
      if (event.type === "SCAN_COMPLETE") {
        setScanning(false);
        setPaused(false);
        setScanned(event.total ?? 0);
        if (event.summary) setSummary(event.summary);
        if (event.runId) {
          setRunId(event.runId);
          void loadResults(event.runId);
          void bridge.listRuns().then(setRuns);
        }
        setBanner(event.empty ? EMPTY_PAGE_MESSAGE : event.stopped ? "Đã dừng. Kết quả đã lấy được vẫn được giữ." : null);
      }
      if (event.type === "SCAN_ERROR") {
        setScanning(false);
        setPaused(false);
        setBanner(event.message ?? "Lỗi quét dữ liệu");
        if (event.runId) {
          setRunId(event.runId);
          void loadResults(event.runId);
        }
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
    // Chỉ gắn listener một lần khi popup mở.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const percent = useMemo(() => {
    if (!scanTotal) return 0;
    return Math.min(100, Math.round((scanned / scanTotal) * 100));
  }, [scanned, scanTotal]);

  async function persistSettings(next: { includeNotFound: boolean; showOk: boolean; masterFileName: string | null }) {
    await bridge.setSettings(next);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const contentBase64 = bytesToBase64(bytes);
    pendingFile.current = { fileName: file.name, contentBase64 };
    await submitImport();
  }

  async function submitImport(mapping?: ColumnMapping) {
    const pending = pendingFile.current;
    if (!pending) return;
    const response = await bridge.importMaster({ ...pending, mapping });
    if (response.needsMapping) {
      const columns = (response.columns as string[]) ?? [];
      setMappingColumns(columns);
      setSkuColumn(columns[0] ?? "");
      setPriceColumn(columns[1] ?? columns[0] ?? "");
      return;
    }
    if (!response.ok) {
      setBanner(String(response.error ?? "Không nhập được Master Data"));
      return;
    }
    setMappingColumns(null);
    setMasterFileName(pending.fileName);
    setBanner(null);
    await persistSettings({ includeNotFound, showOk, masterFileName: pending.fileName });
    const healthResponse = await bridge.health();
    if (healthResponse.ok) setHealth(healthResponse);
  }

  async function onCheck() {
    setBanner(null);
    const limits = health ?? { maxItems: 100, minDelayMs: 3000, maxDelayMs: 7000 };
    const response = await bridge.startScan({
      maxItems: limits.maxItems,
      minDelayMs: limits.minDelayMs,
      maxDelayMs: limits.maxDelayMs,
    });
    if (!response.ok) {
      setBanner(response.error ?? "Không bắt đầu được lượt quét");
      return;
    }
    setScanning(true);
    setPaused(false);
    setScanned(0);
    setScanTotal(limits.maxItems);
    setView("main");
  }

  async function onExport() {
    if (!runId) return;
    const response = await bridge.exportErrors(runId, includeNotFound);
    if (!response.ok) {
      setBanner(response.error);
      return;
    }
    const url = URL.createObjectURL(response.blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "shopee_price_errors.xlsx";
    link.click();
    URL.revokeObjectURL(url);
  }

  const masterCount = health?.masterCount ?? 0;
  const role = health?.role ?? "";
  const canScan = role === "ADMIN" || role === "USER" || role === "SALE" || role === "IT";
  const canCheck = Boolean(health?.displayName && canScan && page?.isProductManagement && masterCount > 0 && !scanning);

  async function onSaveServer() {
    const trimmed = serverUrl.trim().replace(/\/$/, "");
    if (trimmed && typeof chrome !== "undefined" && chrome.permissions?.request) {
      try {
        const origin = new URL(trimmed).origin;
        await chrome.permissions.request({ origins: [`${origin}/*`] });
      } catch {
        setBanner("Server URL không hợp lệ");
        return;
      }
    }
    const saved = await bridge.saveConnection({ serverUrl: trimmed, machineName: machineName.trim() });
    if (!saved.ok) {
      setBanner(saved.error ?? "Không lưu được server");
      return;
    }
    const healthResponse = await bridge.health();
    if (healthResponse.ok) {
      setHealth(healthResponse);
      setOffline(null);
      setMasterFileName(healthResponse.masterVersion ?? healthResponse.masterFileName);
      setBanner(null);
    } else {
      setHealth(null);
      setOffline(healthResponse.error);
    }
  }

  async function onLogin() {
    const result = await bridge.login(username.trim(), password);
    setPassword("");
    if (!result.ok) {
      setBanner(result.error ?? "Không đăng nhập được");
      return;
    }
    setBanner(null);
    const healthResponse = await bridge.health();
    if (healthResponse.ok) {
      setHealth(healthResponse);
      setOffline(null);
      setMasterFileName(healthResponse.masterVersion ?? healthResponse.masterFileName);
    }
  }

  return (
    <main className="app">
      <header className="header">
        <h1>SHOPEE PRICE CHECKER</h1>
        <p>Chỉ đọc DOM tab hiện tại. Kết quả gửi về server nội bộ.</p>
      </header>

      <section className="card">
        <div className="row">
          <span className="label">User</span>
          <span className="value">{health?.displayName || "Chưa đăng nhập"}</span>
        </div>
        <div className="row">
          <span className="label">Server</span>
          <span className="value"><i className={health ? "dot on" : "dot off"} />{health ? "Connected" : "Offline"}</span>
        </div>
        <label className="label">Server URL</label>
        <input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} placeholder="http://192.168.1.100:8787" />
        <label className="label">Machine Name</label>
        <input value={machineName} onChange={(event) => setMachineName(event.target.value)} placeholder="PC-SALE-01" />
        <button type="button" onClick={() => void onSaveServer()}>Test Connection</button>
        {health?.displayName ? (
          <button type="button" onClick={() => { void bridge.logout().then(() => setHealth(null)); }}>Đăng xuất</button>
        ) : (
          <>
            <label className="label">Username</label>
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
            <label className="label">Password</label>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
            <button className="primary" type="button" onClick={() => void onLogin()}>Đăng nhập</button>
          </>
        )}
      </section>

      {bridgeState.demo ? (
        <div className="banner demo">
          Đang xem thử giao diện. CHECK GIÁ gửi 3 sản phẩm mẫu tới backend local. Trong Chrome, nút này đọc đúng tab Shopee đang mở.
        </div>
      ) : null}
      {offline ? <div className="banner error">{offline}</div> : null}
      {banner ? <div className="banner">{banner}</div> : null}
      {page && !page.isProductManagement ? <div className="banner">{page.message}</div> : null}

      {mappingColumns ? (
        <section className="card">
          <h2 className="section-title">CHỌN CỘT</h2>
          <label className="label">SKU column</label>
          <select value={skuColumn} onChange={(event) => setSkuColumn(event.target.value)}>
            {mappingColumns.map((column) => (
              <option key={column} value={column}>{column}</option>
            ))}
          </select>
          <label className="label">Price column</label>
          <select value={priceColumn} onChange={(event) => setPriceColumn(event.target.value)}>
            {mappingColumns.map((column) => (
              <option key={column} value={column}>{column}</option>
            ))}
          </select>
          <button className="primary" type="button" onClick={() => void submitImport({ skuColumn, priceColumn })}>Import</button>
        </section>
      ) : null}

      <section className="card">
        <div className="row">
          <span className="label">Seller Center</span>
          <span className="value"><i className={page?.shopConnected ? "dot on" : "dot off"} />{page?.shopLabel ?? "—"}</span>
        </div>
        <div className="row">
          <span className="label">Page</span>
          <span className="value">{page?.pageLabel ?? "—"}</span>
        </div>
        <div className="row">
          <span className="label">Master Data</span>
          <span className="value">{health?.masterVersion ?? masterFileName ?? "Chưa chọn"}</span>
        </div>
        <div className="row">
          <span className="label">Products</span>
          <span className="value">{masterCount}</span>
        </div>
        <input ref={fileRef} hidden type="file" accept=".xlsx,.xls,.csv" onChange={(event) => void onFile(event.target.files?.[0])} />
        {role === "ADMIN" || role === "IT" ? <button type="button" onClick={() => fileRef.current?.click()}>Chọn Master Data</button> : null}
        {scanning ? (
          <div className="actions">
            {paused ? (
              <button type="button" onClick={() => { setPaused(false); void bridge.resume(); }}>RESUME</button>
            ) : (
              <button type="button" onClick={() => { setPaused(true); void bridge.pause(); }}>PAUSE</button>
            )}
            <button type="button" onClick={() => void bridge.stop()}>STOP</button>
          </div>
        ) : (
          <button className="primary" type="button" disabled={!canCheck} onClick={() => void onCheck()}>CHECK GIÁ</button>
        )}
      </section>

      <section className="card">
        <h2 className="section-title">PROGRESS</h2>
        {scanning ? <div className="banner">{CURRENT_PAGE_MESSAGE}</div> : null}
        <div className="bar" aria-hidden="true"><span style={{ width: `${percent}%` }} /></div>
        <div className="row">
          <span className="label">Scanned</span>
          <span className="value">{scanned} / {scanTotal}</span>
        </div>
      </section>

      {view === "history" ? (
        <section className="card">
          <h2 className="section-title">LỊCH SỬ KIỂM TRA</h2>
          {runs.length === 0 ? <p className="label">Chưa có lần kiểm tra.</p> : null}
          {runs.map((run) => (
            <button
              className="run"
              type="button"
              key={run.id}
              onClick={() => {
                setRunId(run.id);
                setView("errors");
                void loadPageProducts(run.id);
              }}
            >
              Run #{run.id}
              <div className="label">{run.total} products · {run.wrong_price} wrong · {run.unmapped} unmapped</div>
            </button>
          ))}
          <button type="button" onClick={() => setView("main")}>Quay lại</button>
        </section>
      ) : null}

      {view === "errors" ? (
        <section className="card">
          <h2 className="section-title">SẢN PHẨM TRÊN TRANG</h2>
          <p className="label">
            {results.length === 0
              ? "Chưa đọc được sản phẩm nào trên trang."
              : `Đọc được ${results.length} dòng trên trang.`}
            {results.length > 0 && results.every((result) => result.current_price === null)
              ? " Chưa có giá từng biến thể. Reload extension, refresh tab Shopee, rồi CHECK GIÁ lại."
              : ""}
          </p>
          <ResultTable results={results} />
          <button type="button" onClick={() => setView("main")}>Quay lại</button>
        </section>
      ) : null}

      {view === "main" ? (
        <section className="card">
          <h2 className="section-title">RESULT</h2>
          <div className="summary"><span>Total</span><b>{summary?.total ?? 0}</b></div>
          <div className="summary"><span>OK</span><b>{summary?.ok ?? 0}</b></div>
          <div className="summary"><span>Wrong Price</span><b>{summary?.wrong_price ?? 0}</b></div>
          <div className="summary"><span>Unmapped</span><b>{summary?.unmapped ?? 0}</b></div>
          <div className="summary"><span>Not Found</span><b>{summary?.not_found ?? 0}</b></div>
          <div className="summary"><span>Error</span><b>{summary?.error ?? 0}</b></div>
          <div className="checks">
            <label>
              <input
                type="checkbox"
                checked={includeNotFound}
                onChange={(event) => {
                  const next = event.target.checked;
                  filters.current = { ...filters.current, includeNotFound: next };
                  setIncludeNotFound(next);
                  void persistSettings({ includeNotFound: next, showOk, masterFileName });
                  if (runId) void loadResults(runId);
                }}
              />
              Hiển thị NOT_FOUND
            </label>
            <label>
              <input
                type="checkbox"
                checked={showOk}
                onChange={(event) => {
                  const next = event.target.checked;
                  filters.current = { ...filters.current, showOk: next };
                  setShowOk(next);
                  void persistSettings({ includeNotFound, showOk: next, masterFileName });
                  if (runId) void loadResults(runId);
                }}
              />
              Hiện sản phẩm đúng
            </label>
          </div>
          <p className="label">Danh sách chỉ gồm sản phẩm trên trang. SKU và giá lấy từ dòng master có tên nằm trong tên sản phẩm.</p>
          <div className="actions">
            <button type="button" disabled={!runId} onClick={() => { setView("errors"); if (runId) void loadPageProducts(runId); }}>XEM LỖI</button>
            <button type="button" disabled={!runId} onClick={() => void onExport()}>EXPORT EXCEL</button>
            <button className="wide ghost" type="button" onClick={() => { setView("history"); void bridge.listRuns().then(setRuns); }}>Lịch sử kiểm tra</button>
          </div>
        </section>
      ) : null}
    </main>
  );
}

function ResultTable({ results }: { results: CheckResult[] }) {
  if (results.length === 0) return <p className="label">Không có dòng nào trong bộ lọc hiện tại.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>SKU</th>
            <th>Product Name</th>
            <th>Model ID</th>
            <th>Giá lẻ</th>
            <th>Giá Đăng</th>
            <th>Shopee</th>
            <th>Diff</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {results.map((result) => (
            <tr key={`${result.status}-${result.model_id ?? ""}-${result.sku ?? ""}`}>
              <td>{result.sku ?? "—"}</td>
              <td className="name" title={result.product_name ?? ""}>{result.product_name ?? "—"}</td>
              <td>{result.model_id ?? "—"}</td>
              <td>{formatVnd(result.retail_price)}</td>
              <td>{formatVnd(result.standard_price)}</td>
              <td>{formatVnd(result.current_price)}</td>
              <td className={result.difference && result.difference < 0 ? "neg" : ""}>{formatVnd(result.difference)}</td>
              <td>{result.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
