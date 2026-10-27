import { useEffect, useState } from "react";
import { api, clearSession, currentToken, saveSession, type SessionUser } from "./api";
import { LogsPage, UsersPage } from "./AdminPages";
import { CheckPage, type PlatformId } from "./CheckPage";
import { canCheckPrices, canManageMaster, canManageUsers, canViewLogs, roleLabel } from "./format";
import { MasterPage } from "./MasterPage";
import { pageItems, Pager, useListPage } from "./Pager";

type View = "check" | "master" | "users" | "logs" | "scans";

const PLATFORM_KEY = "auditor.platform";

interface RunRow {
  id: number;
  display_name: string;
  machine_name: string | null;
  started_at: string;
  total: number;
  wrong_price: number;
  status: string;
  master_version: string | null;
}

export function App() {
  const [platform, setPlatform] = useState<PlatformId>(() => {
    const saved = sessionStorage.getItem(PLATFORM_KEY);
    return saved === "tiktok" ? "tiktok" : "shopee";
  });
  const [user, setUser] = useState<SessionUser | null>(null);
  const [view, setView] = useState<View>("check");
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    document.documentElement.dataset.platform = platform;
    document.title = platform === "tiktok" ? "TikTok Check Giá" : "Shopee Check Giá";
  }, [platform]);

  useEffect(() => {
    if (!currentToken()) return;
    void api<{ user: SessionUser }>("/api/auth/me")
      .then((data) => setUser(data.user))
      .catch(() => clearSession());
  }, []);

  function choosePlatform(next: PlatformId) {
    sessionStorage.setItem(PLATFORM_KEY, next);
    setPlatform(next);
    setError("");
  }

  async function onLogin() {
    setError("");
    try {
      const data = await api<{ accessToken: string; refreshToken: string; user: SessionUser }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      saveSession(data.accessToken, data.refreshToken);
      setUser(data.user);
      setPassword("");
      setView("check");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không đăng nhập được");
    }
  }

  async function onLogout() {
    const refreshToken = sessionStorage.getItem("auditor.refresh");
    await api("/api/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken }) }).catch(() => undefined);
    clearSession();
    setUser(null);
  }

  if (!user) {
    return (
      <div className="login-wrap">
        <PlatformSwitch platform={platform} onChange={choosePlatform} />
        <form className="login" onSubmit={(event) => { event.preventDefault(); void onLogin(); }}>
          <h1>Check giá</h1>
          <p className="hint">{platform === "shopee" ? "Đối chiếu file giá Shopee với master data." : "Đối chiếu file giá TikTok với master data."}</p>
          <label>Username<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" /></label>
          <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label>
          {error ? <p className="error">{error}</p> : null}
          <button className="primary" type="submit">Đăng nhập</button>
        </form>
      </div>
    );
  }

  const manageMaster = canManageMaster(user.role);
  const manageUsers = canManageUsers(user.role);
  const viewLogs = canViewLogs(user.role);

  return (
    <div className="shell">
      <nav>
        <h1>{platform === "shopee" ? "SHOPEE" : "TIKTOK"}</h1>
        <p className="who">{user.displayName} · {roleLabel(user.role)}</p>
        <button className={view === "check" ? "active" : ""} type="button" onClick={() => setView("check")}>Check giá</button>
        <button className={view === "master" ? "active" : ""} type="button" onClick={() => setView("master")}>Master Data</button>
        <button className={view === "scans" ? "active" : ""} type="button" onClick={() => setView("scans")}>Lịch sử quét</button>
        {manageUsers ? <button className={view === "users" ? "active" : ""} type="button" onClick={() => setView("users")}>Tài khoản</button> : null}
        {viewLogs ? <button className={view === "logs" ? "active" : ""} type="button" onClick={() => setView("logs")}>Nhật ký</button> : null}
        <button type="button" onClick={() => void onLogout()}>Đăng xuất</button>
      </nav>
      <main>
        <PlatformSwitch platform={platform} onChange={choosePlatform} />
        {error ? (
          <div className="popup-back" role="presentation" onClick={() => setError("")}>
            <div className="popup" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
              <p>{error}</p>
              <button className="primary" type="button" onClick={() => setError("")}>Đóng</button>
            </div>
          </div>
        ) : null}
        {view === "check" ? <CheckPage platform={platform} canCheck={canCheckPrices(user.role)} onError={setError} /> : null}
        {view === "master" ? <MasterPage platform={platform} canEdit={manageMaster} onError={setError} /> : null}
        {view === "users" && manageUsers ? <UsersPage onError={setError} /> : null}
        {view === "logs" && viewLogs ? <LogsPage onError={setError} /> : null}
        {view === "scans" ? <ScanHistory onError={setError} /> : null}
      </main>
    </div>
  );
}

function PlatformSwitch({ platform, onChange }: { platform: PlatformId; onChange: (next: PlatformId) => void }) {
  return (
    <div className="platform-switch" role="group" aria-label="Chọn nền tảng">
      <button type="button" className={platform === "shopee" ? "on" : ""} aria-pressed={platform === "shopee"} onClick={() => onChange("shopee")}>Shopee</button>
      <button type="button" className={platform === "tiktok" ? "on" : ""} aria-pressed={platform === "tiktok"} onClick={() => onChange("tiktok")}>TikTok</button>
    </div>
  );
}

function ScanHistory({ onError }: { onError: (message: string) => void }) {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [page, setPage] = useListPage(runs.length);
  useEffect(() => {
    void api<{ runs: RunRow[] }>("/api/runs").then((data) => setRuns(data.runs)).catch((cause: Error) => onError(cause.message));
  }, [onError]);
  const shown = pageItems(runs, page);
  return (
    <section className="card">
      <h2>Lịch sử quét extension</h2>
      <p className="hint">Các lượt quét từ extension trên trang quản lý sản phẩm. Sale chỉ thấy lượt của mình.</p>
      <table>
        <thead><tr><th>Thời gian</th><th>User</th><th>Máy</th><th>Tổng</th><th>Sai giá</th><th>Trạng thái</th><th>Version</th></tr></thead>
        <tbody>
          {shown.map((run) => (
            <tr key={run.id}>
              <td>{new Date(run.started_at).toLocaleString("vi-VN")}</td>
              <td>{run.display_name}</td>
              <td>{run.machine_name ?? "—"}</td>
              <td>{run.total}</td>
              <td>{run.wrong_price}</td>
              <td>{run.status}</td>
              <td>{run.master_version ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pager total={runs.length} page={page} onPage={setPage} />
    </section>
  );
}
