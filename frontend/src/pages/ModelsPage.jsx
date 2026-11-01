import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import { Modal, NameField, Pagination, ScopeTabs, useLibrary, VisibilityButton } from "../components/LibraryUI";
import { api, getUser } from "../utils/api";

export default function ModelsPage() {
  const user = getUser(); const navigate = useNavigate();
  const [scope, setScope] = useState("mine"); const [query, setQuery] = useState(""); const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0); const [creating, setCreating] = useState(false); const [clone, setClone] = useState(null);
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const data = useLibrary("models", scope, query, page, "", refresh);
  const reload = () => setRefresh(value => value + 1);
  async function action(work) { if (busy) return; setBusy(true); setMessage(""); try { await work(); reload(); } catch (error) { setMessage(error.message); } finally { setBusy(false); } }
  return <div className="library-shell"><Navbar /><main className="library-main">
    <header className="library-header"><div><h1>Models</h1><p>Build your models, or clone a version shared by the community.</p></div><button onClick={() => setCreating(true)}>Create New Model</button></header>
    {!user ? <p>Please log in to use Models.</p> : <>
      {message && <p role="status" className="library-notice">{message}</p>}
      <input className="library-search" type="search" aria-label="Search models" placeholder="Search by model, owner or description…" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} />
      <ScopeTabs scope={scope} onChange={value => { setScope(value); setPage(1); }} />
      <h2>{scope === "mine" ? "My Models" : "Public Models (Community)"}</h2><button onClick={reload}>Refresh</button>
      {data.error && <p role="alert">{data.error}</p>}
      {data.loading ? <p role="status">Loading models…</p> : <>
        {!data.items.length && <p>No models found in this section.</p>}
        {data.items.map(item => <article key={item.id} className="library-row"><div className="library-row-info"><h3>{item.display_name}</h3><p>{item.description || "No description"}</p><p>{item.version ? `Latest Version ${item.version}` : "Draft · no saved version"}</p></div>
          <div className="library-actions">{scope === "mine" ? <>
            <Link className="library-link" to={`/models/${item.id}/builder`}>Edit</Link>
            <VisibilityButton item={item} disabled={busy} onChange={visibility => action(() => api(`/library/models/${item.id}/visibility`, { method: "PATCH", body: JSON.stringify({ visibility }) }))} />
            <button disabled={busy} onClick={() => { if (confirm(`Delete ${item.display_name}? Training history and weights will be retained.`)) action(() => api(`/library/models/${item.id}`, { method: "DELETE" })); }}>Delete</button>
          </> : <button disabled={busy} onClick={() => setClone(item)}>Clone</button>}</div>
        </article>)}
        <Pagination page={page} total={data.total} onChange={setPage} />
      </>}
    </>}
  </main>
    {creating && user && <CreateModel user={user} onClose={() => setCreating(false)} onCreated={item => navigate(`/models/${item.id}/builder`)} />}
    {clone && <CloneDialog item={clone} user={user} onClose={() => setClone(null)} onCloned={item => { setClone(null); setScope("mine"); setQuery(""); setPage(1); reload(); setMessage(`Cloned as ${item.display_name} · Version 1. Select Edit to make changes.`); }} />}
  </div>;
}

function CreateModel({ user, onClose, onCreated }) {
  const [name, setName] = useState(""); const [description, setDescription] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event) { event.preventDefault(); if (busy) return; setBusy(true); setError(""); try {
    const result = await api("/library/models", { method: "POST", body: JSON.stringify({ name: name.trim(), description }) }); onCreated(result.model);
  } catch (cause) { setError(cause.message); } finally { setBusy(false); } }
  return <Modal title="Create New Model" onClose={onClose} busy={busy}><form onSubmit={submit}>
    <NameField username={user.username} value={name} onChange={event => setName(event.target.value)} label="Model name" />
    <label className="library-field">Description<textarea maxLength={1000} value={description} onChange={event => setDescription(event.target.value)} /></label>
    <p>Private by default. Create opens Builder directly. The first successful Save creates Version 1.</p>
    {error && <p role="alert">{error}</p>}<button disabled={busy || !name.trim()}>{busy ? "Creating…" : "Create and Edit"}</button>
  </form></Modal>;
}

export function VersionSelect({ modelId, value, onChange }) {
  const [state, setState] = useState({ rows: [], loading: true, error: "" });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setState({ rows: [], loading: true, error: "" });
    api(`/library/models/${modelId}/versions`, { signal: controller.signal }).then(result => {
      if (active) { setState({ rows: result.versions, loading: false, error: "" }); onChange(result.versions[0]?.version ?? ""); }
    }).catch(error => { if (active) setState({ rows: [], loading: false, error: error.message }); });
    return () => { active = false; controller.abort(); };
  }, [modelId, retry, onChange]);
  return <><label className="library-field">Model version<select aria-label="Model version" value={value} disabled={state.loading || !state.rows.length} onChange={event => onChange(Number(event.target.value))}>
    {!state.rows.length && <option value="">{state.loading ? "Loading versions…" : "No saved versions"}</option>}
    {state.rows.map(row => <option key={row.version} value={row.version}>Version {row.version} · {row.model_name}</option>)}
  </select></label>{state.error && <p role="alert">{state.error} <button type="button" onClick={() => setRetry(n => n + 1)}>Retry versions</button></p>}</>;
}

function CloneDialog({ item, user, onClose, onCloned }) {
  const [version, setVersion] = useState(""); const [name, setName] = useState(item.name); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event) { event.preventDefault(); if (busy || !version) return; setBusy(true); try {
    const result = await api(`/library/models/${item.id}/clone`, { method: "POST", body: JSON.stringify({ version: Number(version), name: name.trim() }) }); onCloned(result.model);
  } catch (cause) { setError(cause.message); } finally { setBusy(false); } }
  return <Modal title={`Clone ${item.display_name}`} onClose={onClose} busy={busy}><form onSubmit={submit}>
    <VersionSelect modelId={item.id} value={version} onChange={setVersion} />
    <NameField username={user.username} value={name} onChange={event => setName(event.target.value)} label="Clone name" />
    <p>A new private model starts at Version 1. The original model and its weights are unchanged; weights are not copied.</p>
    {error && <p role="alert">{error}</p>}<button disabled={busy || !version || !name.trim()}>{busy ? "Cloning…" : "Clone selected version"}</button>
  </form></Modal>;
}
