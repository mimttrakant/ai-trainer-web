import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import { Modal, Pagination, ScopeTabs, useLibrary, VisibilityButton } from "../components/LibraryUI";
import { MetricChart } from "../components/TrainingCharts";
import { VersionSelect } from "./ModelsPage";
import { api, download, getUser } from "../utils/api";
import { reuseUnchangedList } from "../utils/trainingData";
import "./TrainingWorkspace.css";

export default function TrainingWorkspace() {
  const user = getUser();
  const [params, setParams] = useSearchParams();
  const selectedJob = params.get("job");
  const [model, setModel] = useState(null); const [version, setVersion] = useState("");
  const [dataset, setDataset] = useState(null); const [picker, setPicker] = useState(null);
  const [settings, setSettings] = useState({ total_epochs: 10, batch_size: 32, learning_rate: 0.001, optimizer: "adam" });
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [jobQuery, setJobQuery] = useState(""); const [jobPage, setJobPage] = useState(1);
  const [weightQuery, setWeightQuery] = useState(""); const [weightPage, setWeightPage] = useState(1); const [weightScope, setWeightScope] = useState("mine");
  const jobs = useLibrary("jobs", "mine", jobQuery, jobPage, "", refresh);
  const weights = useLibrary("weights", weightScope, weightQuery, weightPage, "", refresh);
  const reload = () => setRefresh(n => n + 1);
  function selectJob(id) { setParams(previous => { const next = new URLSearchParams(previous); next.set("job", id); return next; }, { replace: true }); }
  async function train(event) {
    event.preventDefault(); if (busy || !model || !version || !dataset) return;
    setBusy(true); setMessage("");
    try {
      const result = await api("/library/jobs", { method: "POST", body: JSON.stringify({ ...settings,
        total_epochs: Number(settings.total_epochs), batch_size: Number(settings.batch_size), learning_rate: Number(settings.learning_rate),
        model_id: model.id, version: Number(version), dataset_id: dataset.id }) });
      selectJob(result.job.id); setJobPage(1); setJobQuery(""); reload(); setMessage(`Job #${result.job.id} queued. Its saved model version and dataset are shown below.`);
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }
  return <div className="library-shell"><Navbar /><main className="library-main training-workspace">
    <header className="library-header"><div><h1>Training</h1><p>Train a saved model version. Your results are private until you share them.</p></div></header>
    {!user ? <p>Please log in to train models.</p> : <>
      {message && <p role="status" className="library-notice">{message}</p>}
      <form onSubmit={train} aria-label="Training setup">
        <div className="training-setup">
          <fieldset disabled={busy}><legend>1. Model</legend><p>{model?.display_name || "Choose your model or a community model."}</p>
            <button type="button" onClick={() => setPicker("models")}>Choose model</button>
            {model && <VersionSelect key={model.id} modelId={model.id} value={version} onChange={setVersion} />}
            <small>Training a public model does not change its original design.</small>
          </fieldset>
          <fieldset disabled={busy}><legend>2. Dataset</legend><p>{dataset?.display_name || "Choose a ready dataset from your library or the community."}</p>
            <button type="button" onClick={() => setPicker("datasets")}>Choose dataset</button>
            {dataset && <p>{dataset.class_count ?? 0} classes · {dataset.image_count ?? 0} images</p>}
            <small>Only ready, supported datasets can be selected.</small>
          </fieldset>
          <fieldset disabled={busy}><legend>3. Parameters</legend>
            <label className="library-field">Epochs<input type="number" min="1" max="100000" required value={settings.total_epochs} onChange={e => setSettings(s => ({ ...s, total_epochs: e.target.value }))} /></label>
            <label className="library-field">Batch size<input type="number" min="1" max="4096" required value={settings.batch_size} onChange={e => setSettings(s => ({ ...s, batch_size: e.target.value }))} /></label>
            <label className="library-field">Learning rate<input type="number" min="0.000000001" step="any" required value={settings.learning_rate} onChange={e => setSettings(s => ({ ...s, learning_rate: e.target.value }))} /></label>
            <label className="library-field">Optimizer<select value={settings.optimizer} onChange={e => setSettings(s => ({ ...s, optimizer: e.target.value }))}><option value="adam">Adam</option><option value="adamw">AdamW</option><option value="sgd">SGD</option></select></label>
          </fieldset>
        </div><button className="training-start" disabled={busy || !model || !version || !dataset}>{busy ? "Queuing…" : "Start Training"}</button>
      </form>
      <section aria-labelledby="jobs-heading"><h2 id="jobs-heading">My Training Jobs</h2>
        <input type="search" className="library-search" aria-label="Search jobs" placeholder="Search job number, model, dataset or status…" value={jobQuery} onChange={e => { setJobQuery(e.target.value); setJobPage(1); }} />
        <button onClick={reload}>Refresh jobs and weights</button>
        {jobs.error && <p role="alert">{jobs.error}</p>}
        {jobs.loading ? <p>Loading jobs…</p> : <>
          {!jobs.items.length && <p>No training jobs found.</p>}
          {jobs.items.map(job => <button key={job.id} className="training-job-row" aria-label={`View Job #${job.id}`} aria-pressed={String(job.id) === selectedJob} onClick={() => selectJob(job.id)}>
            <strong>Job #{job.id} · {job.model_name} · Version {job.project_version}</strong><span>{job.dataset_name} · {job.status} · Epoch {job.current_epoch || 0}/{job.total_epochs}</span>
          </button>)}<Pagination page={jobPage} total={jobs.total} onChange={setJobPage} />
        </>}
      </section>
      {selectedJob && <JobDetails key={selectedJob} jobId={selectedJob} refresh={refresh} onChanged={reload} />}
      <section aria-labelledby="weights-heading"><h2 id="weights-heading">Trained Weights</h2>
        <p>Share a completed weight to publish its graphs and training settings. This does not share a private dataset or make the source model editable.</p>
        <input type="search" className="library-search" aria-label="Search weights" placeholder="Search weight, owner or dataset…" value={weightQuery} onChange={e => { setWeightQuery(e.target.value); setWeightPage(1); }} />
        <ScopeTabs scope={weightScope} mine="My Weights" onChange={value => { setWeightScope(value); setWeightPage(1); }} />
        {weights.error && <p role="alert">{weights.error}</p>}
        {weights.loading ? <p>Loading weights…</p> : <>{!weights.items.length && <p>No trained weights found in this section.</p>}
          {weights.items.map(weight => <WeightRow key={weight.id} weight={weight} onChanged={reload} onView={() => selectJob(weight.training_job_id)} />)}
          <Pagination page={weightPage} total={weights.total} onChange={setWeightPage} />
        </>}
      </section>
    </>}
  </main>
    {picker && <ResourcePicker resource={picker} onClose={() => setPicker(null)} onSelect={item => { if (picker === "models") { setVersion(""); setModel(item); } else setDataset(item); setPicker(null); }} />}
  </div>;
}

function ResourcePicker({ resource, onClose, onSelect }) {
  const [scope, setScope] = useState("mine"); const [query, setQuery] = useState(""); const [page, setPage] = useState(1); const [retry, setRetry] = useState(0);
  const data = useLibrary(resource, scope, query, page, "&trainable=true", retry);
  const model = resource === "models";
  return <Modal title={model ? "Choose model" : "Choose dataset"} onClose={onClose}>
    <input type="search" className="library-search" aria-label="Search choices" placeholder="Search name, owner or description…" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} />
    <ScopeTabs scope={scope} mine={model ? "My Models" : "My Datasets"} onChange={value => { setScope(value); setPage(1); }} />
    {data.error && <p role="alert">{data.error} <button onClick={() => setRetry(n => n + 1)}>Retry choices</button></p>}
    {data.loading ? <p>Loading choices…</p> : <><div className="training-choices">{!data.items.length && <p>No ready items found.</p>}
      {data.items.map(item => <button className="training-job-row" key={item.id} onClick={() => onSelect(item)}><strong>{item.display_name}</strong><span>{item.description || (model ? `Latest Version ${item.version}` : `${item.class_count} classes · ${item.image_count} images`)}</span></button>)}
    </div><Pagination page={page} total={data.total} onChange={setPage} /></>}
  </Modal>;
}

function JobDetails({ jobId, refresh, onChanged }) {
  const [data, setData] = useState(null); const [error, setError] = useState(""); const [retry, setRetry] = useState(0);
  const changed = useRef(onChanged); changed.current = onChanged;
  useEffect(() => {
    let disposed = false; let timer; let controller; let inFlight = false; let lastStatus;
    async function load() {
      if (disposed || inFlight || document.visibilityState === "hidden") return;
      clearTimeout(timer); inFlight = true; controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      let delay = 3000;
      try {
        const result = await api(`/library/jobs/${jobId}`, { signal: controller.signal, cache: "no-store" });
        if (disposed) return;
        setData(previous => ({ ...result, metrics: reuseUnchangedList(previous?.metrics || [], result.metrics) })); setError("");
        if (lastStatus && lastStatus !== "completed" && result.job.status === "completed") changed.current();
        lastStatus = result.job.status;
        delay = ["queued", "training"].includes(lastStatus) ? 3000 : 30000;
      } catch (cause) { if (!disposed) { setError(cause.message); if ([401, 403, 404].includes(cause.status)) { setData(null); delay = 30000; } } }
      finally { clearTimeout(timeout); inFlight = false; if (!disposed) timer = setTimeout(load, delay); }
    }
    const resume = () => { if (document.visibilityState === "visible") load(); };
    load(); window.addEventListener("online", resume); document.addEventListener("visibilitychange", resume);
    return () => { disposed = true; controller?.abort(); clearTimeout(timer); window.removeEventListener("online", resume); document.removeEventListener("visibilitychange", resume); };
  }, [jobId, retry, refresh]);
  const job = data?.job;
  return <section className="training-result" aria-label={`Job #${jobId} details`}>
    <h2>Job #{jobId} — Training Results</h2>
    {error && <p role="alert">{error} <button onClick={() => setRetry(n => n + 1)}>Retry results</button></p>}
    {!data && !error && <p>Loading saved results…</p>}
    {job && <>
      <dl className="training-facts"><div><dt>Model</dt><dd>{job.model_name} · Version {job.project_version}</dd></div>
        <div><dt>Dataset</dt><dd>{job.dataset_name}</dd></div><div><dt>Status</dt><dd>{job.status} · Epoch {job.current_epoch || 0}/{job.total_epochs}</dd></div>
        <div><dt>Parameters</dt><dd>{job.total_epochs} epochs · Batch {job.batch_size} · LR {job.learning_rate} · {job.optimizer}</dd></div></dl>
      {job.error_message && <p role="alert">{job.error_message}</p>}
      <p>{data.metrics.length} saved epochs · Metrics are stored after each epoch. Live jobs refresh every 3 seconds; return to this page to see the saved history.</p>
      <div className="training-charts__grid"><MetricChart title="Loss Graph" metrics={data.metrics} kind="loss" emptyMessage="No completed epochs yet." /><MetricChart title="Accuracy Graph" metrics={data.metrics} kind="accuracy" emptyMessage="No completed epochs yet." /></div>
      {data.weights.map(weight => <WeightRow key={weight.id} weight={weight} onChanged={() => { setRetry(n => n + 1); onChanged(); }} />)}
    </>}
  </section>;
}

function WeightRow({ weight, onChanged, onView }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function action(work, refresh = true) { if (busy) return; setBusy(true); setError(""); try { await work(); if (refresh) onChanged(); } catch (cause) { setError(cause.message); } finally { setBusy(false); } }
  return <article className="library-row"><div className="library-row-info"><h3>{weight.display_name}</h3><p>Model Version {weight.project_version} · {weight.dataset_name} · Weight #{weight.id}</p>{error && <p role="alert">{error}</p>}</div>
    <div className="library-actions">{onView && <button onClick={onView}>View results</button>}
      <button disabled={busy || !weight.has_pt || weight.allow_download === false} onClick={() => action(() => download(`/library/weights/${weight.id}/download/pt`, `weight-${weight.id}.pt`), false)}>Download PT</button>
      <button disabled={busy || !weight.has_onnx || weight.allow_download === false} onClick={() => action(() => download(`/library/weights/${weight.id}/download/onnx`, `weight-${weight.id}-onnx.zip`), false)}>Download ONNX</button>
      {weight.is_owner && <><VisibilityButton item={weight} disabled={busy} onChange={visibility => action(() => api(`/library/weights/${weight.id}/visibility`, { method: "PATCH", body: JSON.stringify({ visibility }) }))} />
        <button disabled={busy} onClick={() => { if (confirm("Delete this weight from the library? Public access stops. Job history and recoverable files are retained; the model design is not deleted.")) action(() => api(`/library/weights/${weight.id}`, { method: "DELETE" })); }}>Delete Weight</button></>}
    </div>
  </article>;
}
