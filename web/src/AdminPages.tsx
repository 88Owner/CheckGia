import { useEffect, useState } from "react";
import { api, type SessionUser } from "./api";
import { pageItems, Pager, useListPage } from "./Pager";

export function UsersPage({ onError }: { onError: (message: string) => void }) {
  const [users, setUsers] = useState<SessionUser[]>([]);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("SALE");
  const [userPage, setUserPage] = useListPage(users.length);
  const shownUsers = pageItems(users, userPage);

  async function load() {
    const data = await api<{ users: SessionUser[] }>("/api/users");
    setUsers(data.users);
  }

  useEffect(() => {
    void load().catch((cause: Error) => onError(cause.message));
  }, [onError]);

  return (
    <>
      <form className="card" onSubmit={(event) => {
        event.preventDefault();
        if (username.trim().length < 3) {
          onError("Username cần ít nhất 3 ký tự");
          return;
        }
        if (!displayName.trim()) {
          onError("Cần nhập tên hiển thị");
          return;
        }
        if (password.length < 8) {
          onError("Mật khẩu cần ít nhất 8 ký tự");
          return;
        }
        void api("/api/users", {
          method: "POST",
          body: JSON.stringify({ username, displayName, password, role }),
        }).then(async () => {
          setUsername("");
          setDisplayName("");
          setPassword("");
          setRole("SALE");
          await load();
          onError("");
        }).catch((cause: Error) => onError(cause.message));
      }}>
        <h2>Tạo tài khoản</h2>
        <div className="filters">
          <input placeholder="username" value={username} onChange={(event) => setUsername(event.target.value)} />
          <input placeholder="Tên hiển thị" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          <input placeholder="Mật khẩu" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          <select value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="SALE">Sale</option>
            <option value="ADMIN">Admin</option>
            <option value="IT">IT</option>
          </select>
          <button className="primary" type="submit">Tạo</button>
        </div>
        <p className="hint">Mật khẩu ít nhất 8 ký tự. Sale xem master và check giá. Admin import, cập nhật master và check giá. IT làm được toàn bộ và xem nhật ký.</p>
      </form>
      <table>
        <thead><tr><th>Username</th><th>Tên</th><th>Quyền</th><th>Trạng thái</th><th></th></tr></thead>
        <tbody>
          {shownUsers.map((item) => (
            <tr key={item.id}>
              <td>{item.username}</td>
              <td>{item.displayName}</td>
              <td>
                <select value={item.role === "USER" ? "SALE" : item.role} onChange={(event) => void api(`/api/users/${item.id}`, { method: "POST", body: JSON.stringify({ role: event.target.value }) }).then(load).catch((cause: Error) => onError(cause.message))}>
                  <option value="SALE">Sale</option>
                  <option value="ADMIN">Admin</option>
                  <option value="IT">IT</option>
                  {item.role === "VIEWER" ? <option value="VIEWER">Viewer</option> : null}
                </select>
              </td>
              <td>{item.enabled === false ? "Đã khóa" : "Đang dùng"}</td>
              <td className="row-actions">
                <button type="button" onClick={() => void api(`/api/users/${item.id}`, { method: "POST", body: JSON.stringify({ enabled: item.enabled === false }) }).then(load).catch((cause: Error) => onError(cause.message))}>{item.enabled === false ? "Mở khóa" : "Khóa"}</button>
                <button type="button" onClick={() => {
                  const next = window.prompt("Mật khẩu mới, ít nhất 8 ký tự");
                  if (!next) return;
                  if (next.length < 8) {
                    onError("Mật khẩu cần ít nhất 8 ký tự");
                    return;
                  }
                  void api(`/api/users/${item.id}/reset-password`, { method: "POST", body: JSON.stringify({ password: next }) }).then(() => onError("")).catch((cause: Error) => onError(cause.message));
                }}>Đặt lại mật khẩu</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pager total={users.length} page={userPage} onPage={setUserPage} />
    </>
  );
}

const ACTION_LABEL: Record<string, string> = {
  LOGIN: "Đăng nhập",
  LOGOUT: "Đăng xuất",
  UPLOAD_MASTER_DATA: "Import master data",
  ACTIVATE_MASTER_VERSION: "Đổi version master",
  CREATE_USER: "Tạo user",
  UPDATE_USER: "Cập nhật user",
  DISABLE_USER: "Khóa user",
  RESET_PASSWORD: "Đặt lại mật khẩu",
  PRICE_CHECK: "Check giá bằng file",
  VIEW_MASTER: "Xem master data",
  EXPORT_REPORT: "Xuất báo cáo",
  BACKUP_DATABASE: "Backup database",
};

interface AuditRow {
  id: number;
  action: string;
  created_at: string;
  ip: string | null;
  metadata: Record<string, unknown> | null;
  username: string | null;
}

export function LogsPage({ onError }: { onError: (message: string) => void }) {
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    void api<{ logs: AuditRow[] }>("/api/admin/audit")
      .then((data) => setLogs(data.logs))
      .catch((cause: Error) => onError(cause.message));
  }, [onError]);

  const needle = query.trim().toLowerCase();
  const visible = logs.filter((log) => {
    if (!needle) return true;
    const blob = `${log.username ?? ""} ${log.action} ${JSON.stringify(log.metadata ?? {})}`.toLowerCase();
    return blob.includes(needle);
  });
  const [logPage, setLogPage] = useListPage(`${needle}:${logs.length}`);
  const shownLogs = pageItems(visible, logPage);

  return (
    <>
      <div className="filters">
        <input value={query} placeholder="Lọc user, hành động" onChange={(event) => setQuery(event.target.value)} />
      </div>
      <table>
        <thead><tr><th>Thời gian</th><th>User</th><th>Hành động</th><th>Chi tiết</th><th>IP</th></tr></thead>
        <tbody>
          {shownLogs.map((log) => (
            <tr key={log.id}>
              <td>{new Date(log.created_at).toLocaleString("vi-VN")}</td>
              <td>{log.username ?? "—"}</td>
              <td>{ACTION_LABEL[log.action] ?? log.action}</td>
              <td>{log.metadata ? Object.entries(log.metadata).map(([key, value]) => `${key}: ${String(value ?? "")}`).join(" · ") : "—"}</td>
              <td>{log.ip ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pager total={visible.length} page={logPage} onPage={setLogPage} />
    </>
  );
}
