import { memo, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import "./TrainingCharts.css";
import { reuseUnchangedList } from "../utils/trainingData";
import TrainingJobPicker from "./TrainingJobPicker";

const POLL_INTERVAL = 3000;
const isActive = (status) => status === "queued" || status === "training";

const TrainingCharts = memo(function TrainingCharts({ apiUrl, ownerId, jobs, datasets, loading }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedJob = jobs.find((job) => String(job.id) === searchParams.get("job"))
    || jobs.find((job) => isActive(job.status))
    || jobs[0];

  function selectJob(jobId) {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set("job", String(jobId));
      return next;
    }, { replace: true });
  }

  return (
    <section className="training-charts" aria-labelledby="training-charts-title">
      <div className="training-charts__header">
        <div>
          <h2 id="training-charts-title">Training Graphs</h2>
          <p>View saved training history or follow a training job in progress.</p>
        </div>
        {selectedJob && (
          <TrainingJobPicker
            key={selectedJob.id}
            jobs={jobs}
            datasets={datasets}
            selectedJob={selectedJob}
            onSelect={selectJob}
          />
        )}
      </div>
      {selectedJob ? (
        <JobCharts key={`${ownerId}:${selectedJob.id}`} apiUrl={apiUrl} ownerId={ownerId} job={selectedJob} />
      ) : (
        <p className="training-charts__empty">
          {loading ? "Loading training jobs…" : "Start a training job to see Loss and Accuracy graphs."}
        </p>
      )}
    </section>
  );
});

export default TrainingCharts;

const JobCharts = memo(function JobCharts({ apiUrl, ownerId, job }) {
  const [metrics, setMetrics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);
  const active = isActive(job.status);

  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let timer;
    let requestController;

    async function refresh() {
      if (disposed || inFlight) return;
      clearTimeout(timer);
      inFlight = true;
      requestController = new AbortController();
      const timeout = setTimeout(() => requestController.abort(), 15000);
      let retry = false;

      try {
        const response = await fetch(
          `${apiUrl}/training/job/${job.id}/metrics?owner_id=${ownerId}`,
          { signal: requestController.signal, cache: "no-store" },
        );
        if (!response.ok) throw new Error("Unable to load training history.");
        const data = await response.json();
        if (!data.success || !Array.isArray(data.metrics)) {
          throw new Error(data.message || "Unable to load training history.");
        }
        if (disposed) return;
        // Each response contains the full database history, including epochs
        // recorded while this page was closed. Replace it rather than append.
        setMetrics((previous) => reuseUnchangedList(previous, [...data.metrics].sort((a, b) => a.epoch - b.epoch)));
        setUpdatedAt(new Date());
        setError("");
      } catch {
        if (disposed) return;
        retry = true;
        setError("Cannot refresh training history. Showing the last loaded data; retrying automatically.");
      } finally {
        clearTimeout(timeout);
        inFlight = false;
        if (!disposed) {
          setLoading(false);
          if (retry) timer = setTimeout(refresh, POLL_INTERVAL);
        }
      }
    }

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };

    refresh();
    window.addEventListener("focus", refreshWhenVisible);
    window.addEventListener("online", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      disposed = true;
      clearTimeout(timer);
      requestController?.abort();
      window.removeEventListener("focus", refreshWhenVisible);
      window.removeEventListener("online", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
    // The job endpoint is the clock: fetch history only on a new epoch/status,
    // on return to the tab, or after an error. Completion always gets a final fetch.
  }, [apiUrl, ownerId, job.id, job.status, job.current_epoch]);

  const emptyMessage = loading
    ? "Loading saved metrics…"
    : error
      ? "Training history is temporarily unavailable."
      : active
        ? "Waiting for the first completed epoch…"
        : "No epoch history was saved for this job.";

  return (
    <>
      <div className="training-charts__summary" aria-live="polite">
        <span className={`training-charts__badge${active ? " training-charts__badge--live" : ""}`}>
          {active ? "Live · refreshes every 3 seconds" : "Saved history"}
        </span>
        <span>Job #{job.id} · {metrics.length} saved epochs</span>
        {job.project_version && <span>{job.model_name} · Builder Version {job.project_version}</span>}
        {updatedAt && <span>Last updated {updatedAt.toLocaleTimeString()}</span>}
      </div>
      <p className="training-charts__hint">
        Metrics are saved after each epoch. You can leave this page and return to view the history.
      </p>
      {error && <p className="training-charts__error" role="alert">{error}</p>}
      <div className="training-charts__grid">
        <MetricChart title="Loss Graph" metrics={metrics} kind="loss" emptyMessage={emptyMessage} />
        <MetricChart title="Accuracy Graph" metrics={metrics} kind="accuracy" emptyMessage={emptyMessage} />
      </div>
    </>
  );
});

const MetricChart = memo(function MetricChart({ title, metrics, kind, emptyMessage }) {
  const accuracy = kind === "accuracy";
  return (
    <article className="training-charts__plot" aria-label={title}>
      <h3>{title}</h3>
      {metrics.length === 0 ? (
        <div className="training-charts__placeholder">{emptyMessage}</div>
      ) : (
        <ResponsiveContainer width="100%" height={290} minWidth={0}>
          <LineChart data={metrics} margin={{ top: 12, right: 18, left: 0, bottom: 20 }} accessibilityLayer>
            <CartesianGrid stroke="#303545" strokeDasharray="3 3" />
            <XAxis
              dataKey="epoch"
              type="number"
              domain={[1, (maximum) => Math.max(2, maximum)]}
              allowDecimals={false}
              stroke="#9ba3b5"
              fontSize={12}
              label={{ value: "Epoch", position: "insideBottom", offset: -12, fill: "#9ba3b5" }}
            />
            <YAxis
              domain={accuracy ? [0, 100] : [0, "auto"]}
              tickFormatter={(value) => accuracy ? `${value}%` : Number(value.toFixed(4))}
              stroke="#9ba3b5"
              fontSize={12}
              width={62}
            />
            <Tooltip
              labelFormatter={(epoch) => `Epoch ${epoch}`}
              formatter={(value) => value == null ? "—" : `${Number(value).toFixed(accuracy ? 2 : 4)}${accuracy ? "%" : ""}`}
              contentStyle={{ background: "#181b24", border: "1px solid #454c65", borderRadius: 10 }}
              labelStyle={{ color: "#f4f6fb" }}
            />
            <Legend verticalAlign="top" height={36} />
            <Line
              type="linear"
              dataKey={`train_${kind}`}
              name="Train"
              stroke="#9da9ff"
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
              connectNulls={false}
            />
            <Line
              type="linear"
              dataKey={`val_${kind}`}
              name="Validation"
              stroke="#34d399"
              strokeWidth={2}
              strokeDasharray="5 3"
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </article>
  );
});
