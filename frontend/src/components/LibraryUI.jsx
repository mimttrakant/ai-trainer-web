import { useEffect, useRef, useState } from "react";
import { api } from "../utils/api";
import "./LibraryUI.css";

export function useLibrary(resource, scope, query, page, extra = "", refresh = 0) {
  const [state, setState] = useState({ items: [], total: 0, loading: true, error: "" });
  useEffect(() => {
    const controller = new AbortController();
    let timer;
    let cancelled = false;
    const load = async () => {
      try {
        const result = await api(`/library/${resource}?scope=${scope}&q=${encodeURIComponent(query)}&page=${page}&page_size=10${extra}`, { signal: controller.signal });
        if (!cancelled) setState({ ...result, loading: false, error: "" });
        if (!cancelled) timer = setTimeout(load, result.items.some(row => ["queued", "training", "processing", "uploading"].includes(row.status)) ? 3000 : 30000);
      } catch (error) {
        if (!cancelled) setState({ items: [], total: 0, loading: false, error: error.message });
      }
    };
    setState({ items: [], total: 0, loading: true, error: "" });
    timer = setTimeout(load, 250);
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [resource, scope, query, page, extra, refresh]);
  return state;
}

export function ScopeTabs({ scope, onChange, mine = "My Models" }) {
  return <div className="library-tabs" role="group" aria-label="Library scope">
    <button type="button" aria-pressed={scope === "mine"} onClick={() => onChange("mine")}>{mine}</button>
    <button type="button" aria-pressed={scope === "public"} onClick={() => onChange("public")}>Public (Community)</button>
  </div>;
}

export function Pagination({ page, total, onChange }) {
  const pages = Math.max(1, Math.ceil(total / 10));
  useEffect(() => { if (page > pages) onChange(pages); }, [page, pages, onChange]);
  return <nav className="library-pagination" aria-label="Pagination">
    <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</button>
    <span>Page {page} / {pages} · {total} items</span>
    <button type="button" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</button>
  </nav>;
}

export function Modal({ title, children, onClose, busy = false }) {
  const ref = useRef(null);
  useEffect(() => { const element = ref.current; const previous = document.activeElement; element.showModal(); return () => { element.close(); previous?.focus(); }; }, []);
  return <dialog ref={ref} className="library-modal" aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><h2>{title}</h2><button type="button" disabled={busy} aria-label="Close dialog" onClick={onClose}>×</button></header>{children}
  </dialog>;
}

export function NameField({ username, value, onChange, label = "Name" }) {
  return <label className="library-field">{label}<span className="library-name-field"><span aria-label="Owner prefix">{username}/</span><input required maxLength={150} value={value} onChange={onChange} /></span></label>;
}

export function VisibilityButton({ item, onChange, disabled }) {
  return <button type="button" role="switch" aria-checked={item.visibility === "public"} aria-label={`Public visibility ${item.display_name || item.name}`} disabled={disabled}
    onClick={() => { const next = item.visibility === "public" ? "private" : "public";
      if (next === "private" || window.confirm("Make this item public? Other users can access its shared content. Existing downloads/copies cannot be revoked.")) onChange(next);
    }}>{item.visibility === "public" ? "🌐 Public" : "🔒 Private"}</button>;
}
