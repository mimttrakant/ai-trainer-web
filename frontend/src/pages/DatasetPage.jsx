import { useState } from "react";
import Navbar from "../components/Navbar";
import DatasetGuide from "../components/DatasetGuide";
import DatasetDetailsDialog from "../components/DatasetDetailsDialog";
import { Modal, NameField, Pagination, ScopeTabs, useLibrary, VisibilityButton } from "../components/LibraryUI";
import { api, API_URL, download, getUser } from "../utils/api";

export default function DatasetPage() {
  const user = getUser();
  const [scope, setScope] = useState("mine");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [modal, setModal] = useState(null);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const data = useLibrary("datasets", scope, query, page, "", refresh);
  const reload = () => setRefresh(value => value + 1);
  async function action(work) {
    if (busy) return;
    setBusy(true); setMessage("");
    try { await work(); reload(); } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }
  if (!user) return <div className="library-shell"><Navbar /><main className="library-main">Please log in to use Dataset Library.</main></div>;
  return <div className="library-shell"><Navbar /><main className="library-main">
    <header className="library-header"><div><h1>Dataset Library</h1><p>Private datasets and datasets shared by the community.</p></div>
      <div className="library-actions"><button onClick={() => setModal("url")}>Import URL</button><button onClick={() => setModal("zip")}>+ Upload ZIP</button></div></header>
    <DatasetGuide />
    {message && <p role="alert" className="library-notice">{message}</p>}
    <input className="library-search" type="search" aria-label="Search datasets" placeholder="Search by dataset, owner or description…" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} />
    <ScopeTabs scope={scope} mine="My Datasets" onChange={value => { setScope(value); setPage(1); }} />
    <h2>{scope === "mine" ? "My Datasets" : "Public Datasets (Community)"}</h2><button onClick={reload}>Refresh</button>
    {data.error && <p role="alert" className="library-error">{data.error}</p>}
    {data.loading ? <p role="status">Loading datasets…</p> : <>
      {!data.items.length && <p>No datasets found in this section.</p>}
      {data.items.map(item => <article className="library-row" key={item.id}>
        <div className="library-row-info"><h3>{item.display_name}</h3><p>{item.description || "No description"}</p><p>{item.status} · {item.class_count ?? "—"} classes · {item.image_count ?? "—"} images</p>
          {item.unsupported_reason && <p>{item.unsupported_reason}</p>}{item.error_message && <p className="library-error">{item.error_message}</p>}</div>
        <div className="library-actions"><button aria-label={`ดูรายละเอียด ${item.display_name}`} onClick={() => setDetail(item)}>🔍 Details</button>
          <button disabled={busy || !["ready", "unsupported"].includes(item.status)} onClick={() => action(() => download(`/library/datasets/${item.id}/download`, `dataset-${item.id}.zip`))}>Download ZIP</button>
          {item.is_owner && <><VisibilityButton item={item} disabled={busy} onChange={visibility => action(() => api(`/library/datasets/${item.id}/visibility`, { method: "PATCH", body: JSON.stringify({ visibility }) }))} />
            <button disabled={busy} onClick={() => { if (confirm(`Delete ${item.display_name} and its files? This cannot be undone.`)) action(() => api(`/datasets/${item.id}?owner_id=${user.id}`, { method: "DELETE" })); }}>Delete</button></>}
        </div></article>)}
      <Pagination page={page} total={data.total} onChange={setPage} />
    </>}
  </main>
    {modal && <ImportDataset mode={modal} user={user} onClose={() => setModal(null)} onImported={() => { setScope("mine"); setPage(1); reload(); setModal(null); }} />}
    {detail && <DatasetDetailsDialog dataset={{ ...detail, name: detail.display_name }} ownerId={user.id} apiUrl={API_URL} detailsPath={`/library/datasets/${detail.id}/details`} onClose={() => setDetail(null)} />}
  </div>;
}

function ImportDataset({ mode, user, onClose, onImported }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState(null);
  const [provider, setProvider] = useState("google_drive");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault(); if (busy) return;
    if (!name.trim()) return setError("Please enter a dataset name.");
    setBusy(true); setError("");
    try {
      if (mode === "zip") {
        const body = new FormData(); body.append("owner_id", user.id); body.append("name", name.trim()); body.append("description", description); body.append("file", file);
        await api("/datasets/upload", { method: "POST", body });
      } else await api("/datasets/url", { method: "POST", body: JSON.stringify({ owner_id: user.id, name: name.trim(), description, source_url: url, provider }) });
      onImported();
    } catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }
  return <Modal title={mode === "zip" ? "Upload ZIP dataset" : "Import dataset from URL"} onClose={onClose} busy={busy}><form onSubmit={submit}>
    <NameField username={user.username} value={name} onChange={event => setName(event.target.value)} label="Dataset name" />
    <label className="library-field">Description<textarea maxLength={1000} value={description} onChange={event => setDescription(event.target.value)} /></label>
    {mode === "zip" ? <label className="library-field">ZIP file<input required type="file" accept=".zip" onChange={event => setFile(event.target.files[0])} /></label> : <>
      <fieldset className="library-fieldset"><legend>URL source</legend><label><input type="radio" name="provider" checked={provider === "google_drive"} onChange={() => setProvider("google_drive")} /> Google Drive</label>{" "}<label><input type="radio" name="provider" checked={provider === "other"} onChange={() => setProvider("other")} /> Other URL</label></fieldset>
      <label className="library-field">Dataset URL<input required type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder={provider === "google_drive" ? "https://drive.google.com/file/d/…" : "https://example.com/dataset.zip"} /></label>
      <p>{provider === "google_drive" ? "แชร์ไฟล์ ZIP เป็น Anyone with the link ไม่รองรับลิงก์โฟลเดอร์" : "ใช้ลิงก์ HTTP(S) ที่ดาวน์โหลด ZIP ได้โดยตรง ไม่ใช่หน้าเว็บที่ต้องล็อกอิน รองรับ Redirect ไปยังเว็บไซต์สาธารณะ"}</p>
    </>}
    <p>Private by default · ชื่อที่แสดง: {user.username}/{name || "ชื่อ Dataset"}</p><p>แยกภาพเป็นโฟลเดอร์คลาสอย่างน้อย 2 คลาส เช่น apple/ และ banana/ ดูคู่มือบนหน้า Library</p>
    {error && <p role="alert" className="library-error">{error}</p>}<button disabled={busy}>{busy ? "Importing…" : mode === "zip" ? "Upload Dataset" : "Import Dataset"}</button>
  </form></Modal>;
}
