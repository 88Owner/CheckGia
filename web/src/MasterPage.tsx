import { useEffect, useState } from "react";
import { api } from "./api";
import type { PlatformId } from "./CheckPage";
import { fileToBase64, parseDong, sizeCaption } from "./format";
import { Pager, PAGE_SIZE } from "./Pager";

interface Product {
  sku: string;
  name: string | null;
  attributes: string | null;
  standardPrice: number;
  retailPrice: number | null;
  patternName: string | null;
  typeName: string | null;
  sizeLabel: string | null;
}

function dong(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return String(Math.round(value));
}

interface VersionRow {
  id: number;
  version: string;
  filename: string;
  totalSku: number;
  uploadedBy: string | null;
  createdAt: string;
  status: string;
}

export function MasterPage({ platform, canEdit, onError }: { platform: PlatformId; canEdit: boolean; onError: (message: string) => void }) {
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [pattern, setPattern] = useState("");
  const [typeName, setTypeName] = useState("");
  const [size, setSize] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [version, setVersion] = useState<VersionRow | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [versionPage, setVersionPage] = useState(0);
  const limit = PAGE_SIZE;

  async function load(
    nextOffset = offset,
    filters = { name, sku, pattern, typeName, size },
    nextPlatform = platform,
  ) {
    const params = new URLSearchParams({ platform: nextPlatform, limit: String(limit), offset: String(nextOffset) });
    if (filters.name.trim()) params.set("name", filters.name.trim());
    if (filters.sku.trim()) params.set("sku", filters.sku.trim());
    if (filters.pattern.trim()) params.set("pattern", filters.pattern.trim());
    if (filters.typeName.trim()) params.set("type", filters.typeName.trim());
    if (filters.size.trim()) params.set("size", filters.size.trim());
    const data = await api<{ products: Product[]; total: number; version: VersionRow | null }>(`/api/master-data/products?${params.toString()}`);
    setProducts(data.products);
    setTotal(data.total);
    setVersion(data.version);
    setOffset(nextOffset);
    if (canEdit) {
      const history = await api<{ versions: VersionRow[] }>(`/api/master-data/versions?platform=${nextPlatform}`);
      setVersions(history.versions);
    } else {
      setVersions([]);
    }
  }

  useEffect(() => {
    setName("");
    setSku("");
    setPattern("");
    setTypeName("");
    setSize("");
    void load(0, { name: "", sku: "", pattern: "", typeName: "", size: "" }, platform).catch((cause: Error) => onError(cause.message));
  }, [canEdit, platform]);

  async function upload(file: File | undefined) {
    if (!file) return;
    const data = await api<{ imported: number; patternCount: number; typeCount: number; sizeCount: number }>("/api/master-data/import", {
      method: "POST",
      body: JSON.stringify({ fileName: file.name, contentBase64: await fileToBase64(file), platform }),
    });
    await load(0, { name, sku, pattern, typeName, size }, platform);
    onError(`Đã import ${file.name}: ${data.imported} SKU. Tên mẫu ${data.patternCount}, tên loại ${data.typeCount}, kích thước ${data.sizeCount}.`);
  }

  return (
    <>
      <section className="card">
        <h2>Master Data {platform === "shopee" ? "Shopee" : "TikTok"}</h2>
        <div>Version: {version?.version ?? "Chưa có"}</div>
        <div>Số SKU: {version?.totalSku ?? 0}</div>
        <div className="hint"></div>
        {canEdit ? (
          <label>
            Import hoặc cập nhật master
            <input key={platform} type="file" accept=".xlsx,.xls,.csv" onChange={(event) => void upload(event.target.files?.[0]).catch((cause: Error) => onError(cause.message))} />
          </label>
        ) : <p className="hint">Sale được xem, lọc và tìm. Admin hoặc IT mới import được file master.</p>}
      </section>
      {canEdit ? <PriceEditor platform={platform} onError={onError} onSaved={() => void load(0).catch((cause: Error) => onError(cause.message))} /> : null}
      <form className="filters" onSubmit={(event) => { event.preventDefault(); void load(0).catch((cause: Error) => onError(cause.message)); }}>
        <label>Tên sản phẩm<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Tìm theo tên" /></label>
        <label>SKU<input value={sku} onChange={(event) => setSku(event.target.value)} placeholder="Tìm theo SKU" /></label>
        <label>Tên mẫu<input value={pattern} onChange={(event) => setPattern(event.target.value)} placeholder="Dưa Hấu" /></label>
        <label>Tên loại<input value={typeName} onChange={(event) => setTypeName(event.target.value)} placeholder="2 trong 1" /></label>
        <label>Kích thước<input value={size} onChange={(event) => setSize(event.target.value)} placeholder="100-100" /></label>
        <button className="primary" type="submit">Lọc</button>
      </form>
      <div style={{ overflow: "auto" }}>
        <table>
          <thead>
            <tr><th>SKU</th><th>Tên mẫu</th><th>Tên loại</th><th>Kích thước</th><th>Giá Bán Lẻ (VNĐ)</th><th>Giá Đăng</th><th>Tên sản phẩm</th></tr>
          </thead>
          <tbody>
            {products.map((item) => (
              <tr key={item.sku}>
                <td>{item.sku}</td>
                <td>{item.patternName ?? "—"}</td>
                <td>{item.typeName ?? "—"}</td>
                <td>{item.sizeLabel ?? "—"}</td>
                <td>{dong(item.retailPrice)}</td>
                <td>{dong(item.standardPrice)}</td>
                <td>{item.name ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager total={total} page={Math.floor(offset / limit)} onPage={(page) => void load(page * limit).catch((cause: Error) => onError(cause.message))} />
      {canEdit && versions.length > 0 ? (
        <table>
          <thead><tr><th>Version</th><th>File</th><th>SKU</th><th>Người import</th><th>Trạng thái</th><th></th></tr></thead>
          <tbody>
            {versions.slice(versionPage * PAGE_SIZE, versionPage * PAGE_SIZE + PAGE_SIZE).map((item) => (
              <tr key={item.id}>
                <td>{item.version}</td>
                <td>{item.filename}</td>
                <td>{item.totalSku}</td>
                <td>{item.uploadedBy ?? "—"}</td>
                <td>{item.status === "ACTIVE" ? "Đang dùng" : "Lưu trữ"}</td>
                <td>
                  {item.status !== "ACTIVE" ? (
                    <button type="button" onClick={() => void api(`/api/master-data/versions/${item.id}/activate`, { method: "POST", body: "{}" }).then(() => load(0)).catch((cause: Error) => onError(cause.message))}>Dùng bản này</button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {canEdit ? <Pager total={versions.length} page={versionPage} onPage={setVersionPage} /> : null}
    </>
  );
}

interface PriceGroup {
  typeName: string;
  sizeLabel: string;
  patternName: string;
  skuCount: number;
  retailPrices: number[];
  standardPrices: number[];
}

const SHARED_PATTERNS = ["Sương Đêm", "Dưa Hấu", "Chó Xám"];

function defaultChoice(groups: PriceGroup[]) {
  const typeName = groups.some((item) => item.typeName === "Dán 2 Lớp") ? "Dán 2 Lớp" : groups[0]?.typeName ?? "";
  const sizes = groups.filter((item) => item.typeName === typeName);
  const sizeLabel = sizes.some((item) => item.sizeLabel === "120-150") ? "120-150" : sizes[0]?.sizeLabel ?? "";
  const selected = sizes
    .filter((item) => item.sizeLabel === sizeLabel && SHARED_PATTERNS.includes(item.patternName))
    .map((item) => item.patternName);
  return { typeName, sizeLabel, selected };
}

function samePrices(groups: PriceGroup[], typeName: string, sizeLabel: string, selected: string[]) {
  const chosen = groups.filter((item) => item.typeName === typeName && item.sizeLabel === sizeLabel && selected.includes(item.patternName));
  const retail = new Set(chosen.flatMap((item) => item.retailPrices));
  const listed = new Set(chosen.flatMap((item) => item.standardPrices));
  if (!chosen.length || retail.size !== 1 || listed.size !== 1) return null;
  return { retail: String([...retail][0] ?? ""), listed: String([...listed][0] ?? "") };
}

function priceText(values: number[]): string {
  if (!values.length) return "—";
  return values.map((value) => String(value)).join(" / ");
}

function PriceEditor({ platform, onError, onSaved }: { platform: PlatformId; onError: (message: string) => void; onSaved: () => void }) {
  const [groups, setGroups] = useState<PriceGroup[]>([]);
  const [typeName, setTypeName] = useState("");
  const [sizeLabel, setSizeLabel] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [retail, setRetail] = useState("");
  const [listed, setListed] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancel = false;
    void api<{ groups: PriceGroup[] }>(`/api/master-data/price-groups?platform=${platform}`)
      .then((data) => {
        if (cancel) return;
        const next = defaultChoice(data.groups);
        const prices = samePrices(data.groups, next.typeName, next.sizeLabel, next.selected);
        setGroups(data.groups);
        setTypeName(next.typeName);
        setSizeLabel(next.sizeLabel);
        setSelected(next.selected);
        setRetail(prices?.retail ?? "");
        setListed(prices?.listed ?? "");
      })
      .catch((cause: Error) => onError(cause.message));
    return () => {
      cancel = true;
    };
  }, [platform, onError]);

  const types = [...new Set(groups.map((item) => item.typeName))];
  const sizes = [...new Set(groups.filter((item) => item.typeName === typeName).map((item) => item.sizeLabel))];
  const patterns = groups.filter((item) => item.typeName === typeName && item.sizeLabel === sizeLabel);
  const chosen = patterns.filter((item) => selected.includes(item.patternName));
  const skuTotal = chosen.reduce((sum, item) => sum + item.skuCount, 0);
  const mixed = chosen.length > 0 && samePrices(groups, typeName, sizeLabel, selected) === null;

  function chooseType(nextType: string) {
    const nextSizes = groups.filter((item) => item.typeName === nextType).map((item) => item.sizeLabel);
    setTypeName(nextType);
    setSizeLabel(nextSizes[0] ?? "");
    setSelected([]);
    setRetail("");
    setListed("");
  }

  function chooseSize(nextSize: string) {
    setSizeLabel(nextSize);
    setSelected([]);
    setRetail("");
    setListed("");
  }

  function toggle(name: string) {
    const next = selected.includes(name) ? selected.filter((item) => item !== name) : [...selected, name];
    const prices = samePrices(groups, typeName, sizeLabel, next);
    setSelected(next);
    if (prices) {
      setRetail(prices.retail);
      setListed(prices.listed);
    }
  }

  function fillListed() {
    const retailPrice = parseDong(retail);
    if (retailPrice === null) {
      onError("Nhập giá bán lẻ trước khi tính giá đăng.");
      return;
    }
    setListed(String(Math.round(retailPrice / 0.8)));
  }

  async function save() {
    const retailPrice = parseDong(retail);
    const standardPrice = parseDong(listed);
    if (!chosen.length) {
      onError("Chọn ít nhất một mẫu cùng giá.");
      return;
    }
    if (retailPrice === null || standardPrice === null) {
      onError("Giá bán lẻ và giá đăng phải là số nguyên.");
      return;
    }
    const names = chosen.map((item) => item.patternName).join(", ");
    const confirmed = window.confirm(`Cập nhật ${skuTotal} SKU?\n${typeName || "Không rõ loại"} · ${sizeCaption(sizeLabel)}\nMẫu: ${names}\nGiá bán lẻ ${retailPrice}\nGiá đăng ${standardPrice}`);
    if (!confirmed) return;
    setBusy(true);
    try {
      const data = await api<{ updated: number; skus: string[] }>("/api/master-data/prices", {
        method: "POST",
        body: JSON.stringify({
          platform,
          typeName,
          sizeLabel,
          patterns: chosen.map((item) => item.patternName),
          retailPrice,
          standardPrice,
        }),
      });
      const preview = data.skus.slice(0, 8).join(", ");
      const more = data.skus.length > 8 ? ` và ${data.skus.length - 8} SKU khác` : "";
      const fresh = await api<{ groups: PriceGroup[] }>(`/api/master-data/price-groups?platform=${platform}`);
      setGroups(fresh.groups);
      onSaved();
      onError(`Đã cập nhật ${data.updated} SKU. Giá bán lẻ ${retailPrice}, giá đăng ${standardPrice}. ${preview}${more}.`);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Không cập nhật được giá");
    } finally {
      setBusy(false);
    }
  }

  if (!groups.length) return null;

  return (
    <section className="card">
      <h2>Cập nhật giá theo nhóm</h2>
      <p className="hint">Các mẫu được chọn, cùng loại và cùng kích thước, dùng chung một giá bán lẻ và một giá đăng. Ví dụ Dán 2 Lớp, 1,2m × 1,5m: Sương Đêm, Dưa Hấu, Chó Xám.</p>
      <div className="filters">
        <label>Loại
          <select value={typeName} onChange={(event) => chooseType(event.target.value)}>
            {types.map((type) => <option key={type || "empty"} value={type}>{type || "Không rõ loại"}</option>)}
          </select>
        </label>
        <label>Kích thước
          <select value={sizeLabel} onChange={(event) => chooseSize(event.target.value)}>
            {sizes.map((size) => <option key={size || "empty"} value={size}>{sizeCaption(size)}</option>)}
          </select>
        </label>
      </div>
      <div className="checks">
        {patterns.map((item) => (
          <label key={item.patternName}>
            <input type="checkbox" checked={selected.includes(item.patternName)} onChange={() => toggle(item.patternName)} />
            <span>{item.patternName}</span>
            <span className="hint">{item.skuCount} SKU · bán lẻ {priceText(item.retailPrices)} · đăng {priceText(item.standardPrices)}</span>
          </label>
        ))}
      </div>
      {mixed ? <p className="hint">Các mẫu đang chọn chưa cùng một giá. Giá mới sẽ áp cho mọi SKU đã chọn.</p> : null}
      <div className="filters">
        <label>Giá bán lẻ (VNĐ)<input value={retail} inputMode="numeric" onChange={(event) => setRetail(event.target.value)} /></label>
        <label>Giá đăng<input value={listed} inputMode="numeric" onChange={(event) => setListed(event.target.value)} /></label>
        <button type="button" onClick={fillListed}>Giá đăng = giá bán lẻ / 80%</button>
        <button className="primary" type="button" disabled={busy || skuTotal === 0} onClick={() => void save()}>Cập nhật {skuTotal} SKU</button>
      </div>
    </section>
  );
}
