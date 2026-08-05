import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Navbar from "../components/Navbar";

const API_URL = "http://127.0.0.1:8000";

function DatasetPage() {
  const currentUser = getStoredUser();
  const ownerId = currentUser?.id;
  const fileInputRef = useRef(null);

  const [datasets, setDatasets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [searchText, setSearchText] = useState("");
  const [sortMode, setSortMode] = useState("newest");
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showUrlModal, setShowUrlModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [importingUrl, setImportingUrl] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [uploadForm, setUploadForm] = useState({ name: "", description: "", file: null });
  const [urlForm, setUrlForm] = useState({ name: "", description: "", sourceUrl: "" });

  const loadDatasets = useCallback(async () => {
    if (!ownerId) {
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(`${API_URL}/datasets/${ownerId}`);
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || "Unable to load datasets");
      setDatasets(Array.isArray(data.datasets) ? data.datasets : []);
    } catch (error) {
      setMessage(error.message || "Unable to load datasets");
    } finally {
      setLoading(false);
    }
  }, [ownerId]);

  useEffect(() => { loadDatasets(); }, [loadDatasets]);

  useEffect(() => {
    const hasProcessing = datasets.some((dataset) => ["uploading", "processing"].includes(dataset.status));
    if (!hasProcessing) return undefined;
    const intervalId = window.setInterval(loadDatasets, 3000);
    return () => window.clearInterval(intervalId);
  }, [datasets, loadDatasets]);

  const visibleDatasets = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    const filtered = datasets.filter((dataset) => {
      if (!keyword) return true;
      return [dataset.name, dataset.description, dataset.source_type, dataset.status, dataset.original_filename]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword));
    });

    return [...filtered].sort((a, b) => {
      if (sortMode === "oldest") return new Date(a.created_at) - new Date(b.created_at);
      if (sortMode === "name") return String(a.name).localeCompare(String(b.name));
      if (sortMode === "size") return Number(b.size_bytes || 0) - Number(a.size_bytes || 0);
      return new Date(b.created_at) - new Date(a.created_at);
    });
  }, [datasets, searchText, sortMode]);

  const handleFileSelection = (event) => {
    const selectedFile = event.target.files?.[0] || null;
    setUploadForm((current) => ({
      ...current,
      file: selectedFile,
      name: current.name || (selectedFile ? formatFilenameAsName(selectedFile.name) : ""),
    }));
  };

  const uploadZipDataset = async (event) => {
    event.preventDefault();
    if (!ownerId) return setMessage("Please login before uploading a dataset.");
    if (!uploadForm.file) return setMessage("Please select a ZIP file.");
    if (!uploadForm.file.name.toLowerCase().endsWith(".zip")) return setMessage("Only ZIP files are supported.");

    const formData = new FormData();
    formData.append("owner_id", String(ownerId));
    formData.append("name", uploadForm.name.trim());
    formData.append("description", uploadForm.description.trim());
    formData.append("file", uploadForm.file);

    setUploading(true);
    setMessage("");
    try {
      const response = await fetch(`${API_URL}/datasets/upload`, { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || "Dataset upload failed");
      setShowUploadModal(false);
      setUploadForm({ name: "", description: "", file: null });
      if (fileInputRef.current) fileInputRef.current.value = "";
      setMessage("Dataset uploaded successfully.");
      await loadDatasets();
    } catch (error) {
      setMessage(error.message || "Dataset upload failed");
    } finally {
      setUploading(false);
    }
  };

  const importDatasetUrl = async (event) => {
    event.preventDefault();
    if (!ownerId) return setMessage("Please login before importing a dataset.");

    setImportingUrl(true);
    setMessage("");
    try {
      const response = await fetch(`${API_URL}/datasets/url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner_id: ownerId,
          name: urlForm.name.trim(),
          description: urlForm.description.trim(),
          source_url: urlForm.sourceUrl.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || "Unable to import dataset URL");
      setShowUrlModal(false);
      setUrlForm({ name: "", description: "", sourceUrl: "" });
      setMessage("Dataset import started.");
      await loadDatasets();
    } catch (error) {
      setMessage(error.message || "Unable to import dataset URL");
    } finally {
      setImportingUrl(false);
    }
  };

  const deleteDataset = async () => {
    if (!deleteTarget || !ownerId) return;
    setDeleting(true);
    setMessage("");
    try {
      const response = await fetch(`${API_URL}/datasets/${deleteTarget.id}?owner_id=${ownerId}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || "Unable to delete dataset");
      setDeleteTarget(null);
      setMessage("Dataset deleted successfully.");
      await loadDatasets();
    } catch (error) {
      setMessage(error.message || "Unable to delete dataset");
    } finally {
      setDeleting(false);
    }
  };

  if (!ownerId) {
    return (
      <div style={pageShellStyle}>
        <Navbar />
        <main style={containerStyle}>
          <div style={emptyStateStyle}>
            <div style={emptyIconStyle}>🔒</div>
            <h1 style={{ marginBottom: "10px" }}>Login required</h1>
            <p style={mutedTextStyle}>Please login before opening your Dataset Library.</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div style={pageShellStyle}>
      <Navbar />
      <main style={containerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>DATA MANAGEMENT</p>
            <h1 style={pageTitleStyle}>Dataset Library</h1>
            <p style={pageSubtitleStyle}>Upload and manage reusable datasets for your AI training jobs.</p>
          </div>
          <div style={headerActionsStyle}>
            <button type="button" onClick={() => setShowUrlModal(true)} style={secondaryButtonStyle}>Import URL</button>
            <button type="button" onClick={() => setShowUploadModal(true)} style={primaryButtonStyle}>+ Upload ZIP</button>
          </div>
        </header>

        {message && (
          <div style={notificationStyle}>
            <span>{message}</span>
            <button type="button" onClick={() => setMessage("")} style={notificationCloseStyle}>×</button>
          </div>
        )}

        <section style={toolbarStyle}>
          <div style={searchWrapperStyle}>
            <span aria-hidden="true">⌕</span>
            <input type="search" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search datasets..." style={searchInputStyle} />
          </div>
          <select value={sortMode} onChange={(event) => setSortMode(event.target.value)} style={sortSelectStyle}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="name">Name A–Z</option>
            <option value="size">Largest size</option>
          </select>
        </section>

        <section>
          <div style={sectionHeadingStyle}>
            <div>
              <h2 style={sectionTitleStyle}>My datasets</h2>
              <p style={sectionSubtitleStyle}>{visibleDatasets.length} dataset{visibleDatasets.length === 1 ? "" : "s"} shown</p>
            </div>
            <button type="button" onClick={loadDatasets} style={ghostButtonStyle}>Refresh</button>
          </div>

          {loading ? (
            <div style={emptyStateStyle}><p style={mutedTextStyle}>Loading datasets...</p></div>
          ) : visibleDatasets.length === 0 ? (
            <div style={emptyStateStyle}>
              <div style={emptyIconStyle}>▱</div>
              <h3 style={{ marginBottom: "8px" }}>{datasets.length === 0 ? "Your library is empty" : "No matching datasets"}</h3>
              <p style={mutedTextStyle}>{datasets.length === 0 ? "Upload a ZIP file or import a Google Drive URL to get started." : "Try changing the search keyword or sort option."}</p>
              {datasets.length === 0 && <button type="button" onClick={() => setShowUploadModal(true)} style={primaryButtonStyle}>Upload your first dataset</button>}
            </div>
          ) : (
            <div style={datasetGridStyle}>
              {visibleDatasets.map((dataset) => <DatasetCard key={dataset.id} dataset={dataset} onDelete={() => setDeleteTarget(dataset)} />)}
            </div>
          )}
        </section>
      </main>

      {showUploadModal && (
        <ModalShell title="Upload ZIP dataset" subtitle="The ZIP file will be extracted and stored in your personal Dataset Library." onClose={() => !uploading && setShowUploadModal(false)}>
          <form onSubmit={uploadZipDataset}>
            <FormField label="Dataset name"><input required value={uploadForm.name} onChange={(event) => setUploadForm((current) => ({ ...current, name: event.target.value }))} placeholder="Example: Cats vs Dogs" style={textInputStyle} /></FormField>
            <FormField label="Description"><textarea value={uploadForm.description} onChange={(event) => setUploadForm((current) => ({ ...current, description: event.target.value }))} placeholder="Optional description" rows={4} style={textAreaStyle} /></FormField>
            <FormField label="ZIP file"><div style={fileBoxStyle}><input ref={fileInputRef} required type="file" accept=".zip,application/zip" onChange={handleFileSelection} style={{ width: "100%" }} /><small style={helperTextStyle}>Current development version accepts ZIP files.</small></div></FormField>
            <ModalActions busy={uploading} busyText="Uploading..." submitText="Upload Dataset" onCancel={() => setShowUploadModal(false)} />
          </form>
        </ModalShell>
      )}

      {showUrlModal && (
        <ModalShell title="Import dataset from URL" subtitle="Use a direct ZIP URL or a shared Google Drive link." onClose={() => !importingUrl && setShowUrlModal(false)}>
          <form onSubmit={importDatasetUrl}>
            <FormField label="Dataset name"><input required value={urlForm.name} onChange={(event) => setUrlForm((current) => ({ ...current, name: event.target.value }))} placeholder="Example: Flower Dataset" style={textInputStyle} /></FormField>
            <FormField label="Description"><textarea value={urlForm.description} onChange={(event) => setUrlForm((current) => ({ ...current, description: event.target.value }))} placeholder="Optional description" rows={3} style={textAreaStyle} /></FormField>
            <FormField label="Dataset URL"><input required type="url" value={urlForm.sourceUrl} onChange={(event) => setUrlForm((current) => ({ ...current, sourceUrl: event.target.value }))} placeholder="https://drive.google.com/file/d/..." style={textInputStyle} /><small style={helperTextStyle}>Google Drive sharing should allow anyone with the link.</small></FormField>
            <ModalActions busy={importingUrl} busyText="Starting import..." submitText="Import Dataset" onCancel={() => setShowUrlModal(false)} />
          </form>
        </ModalShell>
      )}

      {deleteTarget && (
        <ModalShell title="Delete dataset?" subtitle="This removes both the database record and its files from storage." onClose={() => !deleting && setDeleteTarget(null)}>
          <div style={deleteSummaryStyle}><strong>{deleteTarget.name}</strong><span style={mutedTextStyle}>{formatBytes(deleteTarget.size_bytes)}</span></div>
          <div style={modalActionRowStyle}>
            <button type="button" disabled={deleting} onClick={() => setDeleteTarget(null)} style={secondaryButtonStyle}>Cancel</button>
            <button type="button" disabled={deleting} onClick={deleteDataset} style={dangerButtonStyle}>{deleting ? "Deleting..." : "Delete Dataset"}</button>
          </div>
        </ModalShell>
      )}
    </div>
  );
}

function DatasetCard({ dataset, onDelete }) {
  return (
    <article style={datasetCardStyle}>
      <div style={datasetCardTopStyle}>
        <div style={datasetIconStyle}>{dataset.source_type === "url" ? "↗" : "ZIP"}</div>
        <StatusBadge status={dataset.status} />
      </div>
      <div><h3 style={datasetNameStyle}>{dataset.name}</h3><p style={datasetDescriptionStyle}>{dataset.description || "No description provided."}</p></div>
      <div style={metadataGridStyle}>
        <MetadataItem label="Size" value={formatBytes(dataset.size_bytes)} />
        <MetadataItem label="Created" value={formatDate(dataset.created_at)} />
      </div>
      {dataset.status === "failed" && dataset.error_message && <div style={errorBoxStyle}>{dataset.error_message}</div>}
      <button type="button" onClick={onDelete} style={deleteButtonStyle}>Delete</button>
    </article>
  );
}

function MetadataItem({ label, value }) { return <div><span style={metadataLabelStyle}>{label}</span><strong style={metadataValueStyle}>{value}</strong></div>; }

function StatusBadge({ status }) {
  const statusMap = {
    ready: { label: "Ready", background: "rgba(55, 214, 122, 0.14)", color: "#68e49b", border: "rgba(104, 228, 155, 0.28)" },
    processing: { label: "Processing", background: "rgba(89, 156, 255, 0.14)", color: "#7db1ff", border: "rgba(125, 177, 255, 0.28)" },
    uploading: { label: "Uploading", background: "rgba(255, 192, 74, 0.14)", color: "#ffc867", border: "rgba(255, 200, 103, 0.28)" },
    failed: { label: "Failed", background: "rgba(255, 88, 111, 0.14)", color: "#ff7e90", border: "rgba(255, 126, 144, 0.28)" },
  };
  const selected = statusMap[status] || { label: status || "Unknown", background: "rgba(255,255,255,0.08)", color: "#c7ccda", border: "rgba(255,255,255,0.15)" };
  return <span style={{ ...statusBadgeStyle, background: selected.background, color: selected.color, borderColor: selected.border }}><span style={statusDotStyle}>●</span>{selected.label}</span>;
}

function ModalShell({ title, subtitle, onClose, children }) {
  return <div style={modalBackdropStyle} onMouseDown={onClose}><div role="dialog" aria-modal="true" style={modalStyle} onMouseDown={(event) => event.stopPropagation()}><div style={modalHeaderStyle}><div><h2 style={modalTitleStyle}>{title}</h2><p style={modalSubtitleStyle}>{subtitle}</p></div><button type="button" onClick={onClose} style={modalCloseStyle}>×</button></div>{children}</div></div>;
}
function FormField({ label, children }) { return <label style={formFieldStyle}><span style={fieldLabelStyle}>{label}</span>{children}</label>; }
function ModalActions({ busy, busyText, submitText, onCancel }) { return <div style={modalActionRowStyle}><button type="button" disabled={busy} onClick={onCancel} style={secondaryButtonStyle}>Cancel</button><button type="submit" disabled={busy} style={{ ...primaryButtonStyle, opacity: busy ? 0.65 : 1 }}>{busy ? busyText : submitText}</button></div>; }

function getStoredUser() { try { const raw = localStorage.getItem("user"); return raw ? JSON.parse(raw) : null; } catch { return null; } }
function formatFilenameAsName(filename) { return filename.replace(/\.zip$/i, "").replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()); }
function formatBytes(value) { const bytes = Number(value || 0); if (bytes <= 0) return "0 B"; const units = ["B", "KB", "MB", "GB", "TB"]; const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1); const size = bytes / 1024 ** i; return `${size.toFixed(size >= 10 || i === 0 ? 0 : 1)} ${units[i]}`; }
function formatDate(value) { if (!value) return "Unknown"; return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)); }

const pageShellStyle = { minHeight: "100vh", background: "radial-gradient(circle at top left, rgba(99, 102, 241, 0.12), transparent 30%), #111319", color: "#f5f7ff" };
const containerStyle = { width: "min(1180px, calc(100% - 40px))", margin: "0 auto", padding: "54px 0 90px" };
const pageHeaderStyle = { display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "24px", flexWrap: "wrap", marginBottom: "30px" };
const eyebrowStyle = { margin: "0 0 10px", color: "#9ca6ff", fontSize: "12px", fontWeight: "800", letterSpacing: "0.17em" };
const pageTitleStyle = { margin: 0, fontSize: "clamp(36px, 6vw, 64px)", lineHeight: 1.05, letterSpacing: "-0.04em" };
const pageSubtitleStyle = { maxWidth: "650px", margin: "16px 0 0", color: "#aeb5c6", lineHeight: 1.65 };
const headerActionsStyle = { display: "flex", gap: "12px", flexWrap: "wrap" };
const primaryButtonStyle = { minHeight: "44px", padding: "0 18px", border: "1px solid rgba(151, 162, 255, 0.48)", borderRadius: "11px", background: "linear-gradient(135deg, #6973f8, #8b5cf6)", color: "#ffffff", fontWeight: "800", cursor: "pointer" };
const secondaryButtonStyle = { minHeight: "44px", padding: "0 18px", border: "1px solid rgba(255,255,255,0.14)", borderRadius: "11px", background: "rgba(255,255,255,0.055)", color: "#eef1fa", fontWeight: "750", cursor: "pointer" };
const dangerButtonStyle = { minHeight: "44px", padding: "0 18px", border: "1px solid rgba(255, 92, 115, 0.38)", borderRadius: "11px", background: "linear-gradient(135deg, #d9445d, #ef476f)", color: "#ffffff", fontWeight: "800", cursor: "pointer" };
const ghostButtonStyle = { border: 0, background: "transparent", color: "#aeb8ff", fontWeight: "750", cursor: "pointer" };
const toolbarStyle = { display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap", padding: "16px", marginBottom: "30px", border: "1px solid rgba(255,255,255,0.09)", borderRadius: "17px", background: "rgba(22, 25, 34, 0.78)" };
const searchWrapperStyle = { flex: "1 1 340px", display: "flex", alignItems: "center", gap: "10px", minHeight: "44px", padding: "0 14px", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "11px", background: "#101219" };
const searchInputStyle = { width: "100%", border: 0, outline: 0, background: "transparent", color: "#f5f7ff", fontSize: "15px" };
const sortSelectStyle = { minHeight: "44px", padding: "0 14px", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "11px", background: "#151822", color: "#f5f7ff", cursor: "pointer" };
const notificationStyle = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", marginBottom: "18px", padding: "13px 16px", border: "1px solid rgba(140, 153, 255, 0.24)", borderRadius: "12px", background: "rgba(95, 105, 223, 0.12)", color: "#d9ddff" };
const notificationCloseStyle = { border: 0, background: "transparent", color: "#d9ddff", fontSize: "22px", cursor: "pointer" };
const sectionHeadingStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "20px", marginBottom: "18px" };
const sectionTitleStyle = { margin: 0, fontSize: "23px" };
const sectionSubtitleStyle = { margin: "5px 0 0", color: "#929aac", fontSize: "14px" };
const datasetGridStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))", gap: "18px" };
const datasetCardStyle = { display: "flex", flexDirection: "column", gap: "20px", minHeight: "340px", padding: "22px", border: "1px solid rgba(255,255,255,0.09)", borderRadius: "19px", background: "rgba(22, 25, 34, 0.88)", boxShadow: "0 18px 54px rgba(0,0,0,0.16)" };
const datasetCardTopStyle = { display: "flex", justifyContent: "space-between", alignItems: "center" };
const datasetIconStyle = { width: "50px", height: "50px", display: "grid", placeItems: "center", border: "1px solid rgba(141, 151, 255, 0.25)", borderRadius: "14px", background: "rgba(91, 101, 223, 0.13)", color: "#aeb6ff", fontSize: "13px", fontWeight: "900" };
const statusBadgeStyle = { display: "inline-flex", alignItems: "center", gap: "7px", padding: "7px 10px", border: "1px solid", borderRadius: "999px", fontSize: "12px", fontWeight: "800" };
const statusDotStyle = { fontSize: "8px" };
const datasetNameStyle = { margin: "0 0 8px", fontSize: "23px", letterSpacing: "-0.02em" };
const datasetDescriptionStyle = { minHeight: "48px", margin: 0, color: "#9fa7b8", lineHeight: 1.55 };
const metadataGridStyle = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "16px", padding: "17px", borderRadius: "14px", background: "rgba(255,255,255,0.035)" };
const metadataLabelStyle = { display: "block", marginBottom: "4px", color: "#777f91", fontSize: "11px", fontWeight: "800", letterSpacing: "0.08em", textTransform: "uppercase" };
const metadataValueStyle = { display: "block", overflow: "hidden", color: "#e9ecf4", fontSize: "14px", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const deleteButtonStyle = { minHeight: "42px", marginTop: "auto", border: "1px solid rgba(255, 95, 118, 0.24)", borderRadius: "10px", background: "rgba(255, 77, 104, 0.08)", color: "#ff8d9e", fontWeight: "800", cursor: "pointer" };
const errorBoxStyle = { padding: "11px 12px", border: "1px solid rgba(255, 92, 115, 0.2)", borderRadius: "10px", background: "rgba(255, 77, 104, 0.08)", color: "#ff9eac", fontSize: "13px", lineHeight: 1.5 };
const emptyStateStyle = { minHeight: "300px", display: "grid", placeItems: "center", alignContent: "center", gap: "10px", padding: "36px", border: "1px dashed rgba(255,255,255,0.12)", borderRadius: "20px", background: "rgba(22, 25, 34, 0.54)", textAlign: "center" };
const emptyIconStyle = { fontSize: "42px", color: "#929cff" };
const mutedTextStyle = { margin: 0, color: "#9ca4b6" };
const modalBackdropStyle = { position: "fixed", inset: 0, zIndex: 9999, display: "grid", placeItems: "center", padding: "20px", background: "rgba(4, 6, 12, 0.76)", backdropFilter: "blur(8px)" };
const modalStyle = { width: "min(560px, 100%)", maxHeight: "90vh", overflowY: "auto", padding: "24px", border: "1px solid rgba(255,255,255,0.11)", borderRadius: "20px", background: "#171a23", boxShadow: "0 30px 100px rgba(0,0,0,0.46)", color: "#f5f7ff" };
const modalHeaderStyle = { display: "flex", justifyContent: "space-between", gap: "20px", marginBottom: "24px" };
const modalTitleStyle = { margin: 0, fontSize: "27px", letterSpacing: "-0.025em" };
const modalSubtitleStyle = { margin: "8px 0 0", color: "#9da5b7", lineHeight: 1.55 };
const modalCloseStyle = { width: "38px", height: "38px", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", background: "rgba(255,255,255,0.05)", color: "#ffffff", fontSize: "23px", cursor: "pointer" };
const formFieldStyle = { display: "block", marginBottom: "17px" };
const fieldLabelStyle = { display: "block", marginBottom: "7px", color: "#dfe3ee", fontSize: "14px", fontWeight: "750" };
const textInputStyle = { width: "100%", minHeight: "44px", boxSizing: "border-box", padding: "0 13px", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "10px", outline: 0, background: "#101219", color: "#f5f7ff" };
const textAreaStyle = { ...textInputStyle, minHeight: "96px", padding: "12px 13px", resize: "vertical" };
const fileBoxStyle = { padding: "15px", border: "1px dashed rgba(151, 161, 255, 0.28)", borderRadius: "12px", background: "rgba(95, 105, 223, 0.07)" };
const helperTextStyle = { display: "block", marginTop: "8px", color: "#8f97a9", lineHeight: 1.4 };
const modalActionRowStyle = { display: "flex", justifyContent: "flex-end", gap: "11px", flexWrap: "wrap", marginTop: "24px" };
const deleteSummaryStyle = { display: "flex", justifyContent: "space-between", gap: "15px", padding: "16px", borderRadius: "12px", background: "rgba(255,255,255,0.045)" };

export default DatasetPage;
