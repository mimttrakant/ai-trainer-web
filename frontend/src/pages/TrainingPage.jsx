import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import TrainingCharts from "../components/TrainingCharts";

const API_URL = "http://localhost:8000";

function TrainingPage() {
  const { id } = useParams();
  const [, setSearchParams] = useSearchParams();
  const jobsRequestId = useRef(0);

  const user = JSON.parse(localStorage.getItem("user") || "null");
  const ownerId = user?.id;

  const [datasets, setDatasets] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [models, setModels] = useState([]);

  const [datasetId, setDatasetId] = useState("");
  const [epochs, setEpochs] = useState(10);
  const [batchSize, setBatchSize] = useState(32);
  const [learningRate, setLearningRate] = useState(0.001);
  const [optimizer, setOptimizer] = useState("adam");

  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState("");

  // --------------------------------------------------
  // Load Datasets
  // --------------------------------------------------

  const loadDatasets = useCallback(async () => {
    if (!ownerId) return;

    try {
      const response = await fetch(
        `${API_URL}/datasets/${ownerId}`
      );

      const data = await response.json();

      if (data.success) {
        setDatasets(data.datasets || []);

        if (
          !datasetId &&
          data.datasets &&
          data.datasets.length > 0
        ) {
          setDatasetId(
            String(data.datasets[0].id)
          );
        }
      }
    } catch (error) {
      console.error(
        "Load datasets error:",
        error
      );
    }
  }, [ownerId, datasetId]);

  // --------------------------------------------------
  // Load Training Jobs
  // --------------------------------------------------

  const loadJobs = useCallback(async () => {
    if (!ownerId || !id) return;
    const requestId = ++jobsRequestId.current;

    try {
      const response = await fetch(
        `${API_URL}/training/projects/${id}/jobs?owner_id=${ownerId}`
      );

      const data = await response.json();

      if (data.success && requestId === jobsRequestId.current) {
        setJobs(data.jobs || []);
      }
    } catch (error) {
      console.error(
        "Load jobs error:",
        error
      );
    }
  }, [id, ownerId]);

  // --------------------------------------------------
  // Load Trained Models
  // --------------------------------------------------

  const loadModels = useCallback(async () => {
    if (!ownerId || !id) return;

    try {
      const response = await fetch(
        `${API_URL}/training/projects/${id}/models?owner_id=${ownerId}`
      );

      const data = await response.json();

      if (data.success) {
        setModels(data.models || []);
      }
    } catch (error) {
      console.error(
        "Load models error:",
        error
      );
    }
  }, [id, ownerId]);

  // --------------------------------------------------
  // Initial Load
  // --------------------------------------------------

  useEffect(() => {
    const loadPage = async () => {
      setLoading(true);

      await Promise.all([
        loadDatasets(),
        loadJobs(),
        loadModels(),
      ]);

      setLoading(false);
    };

    loadPage();
  }, [
    loadDatasets,
    loadJobs,
    loadModels,
  ]);

  // --------------------------------------------------
  // Poll Training Progress
  // --------------------------------------------------

  useEffect(() => {
    if (!ownerId || !id) return;

    const interval = setInterval(
      async () => {
        await loadJobs();
        await loadModels();
      },
      3000
    );

    return () => {
      clearInterval(interval);
    };
  }, [
    id,
    ownerId,
    loadJobs,
    loadModels,
  ]);

  // --------------------------------------------------
  // Start Training
  // --------------------------------------------------

  const startTraining = async (event) => {
    event.preventDefault();

    if (!ownerId) {
      setMessage(
        "Please login before starting training."
      );
      return;
    }

    if (!datasetId) {
      setMessage(
        "Please select a dataset."
      );
      return;
    }

    setStarting(true);
    setMessage("");

    try {
      const response = await fetch(
        `${API_URL}/training/jobs`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            owner_id: Number(ownerId),
            project_id: Number(id),
            dataset_id: Number(datasetId),

            mode: "new",

            total_epochs:
              Number(epochs),

            batch_size:
              Number(batchSize),

            learning_rate:
              Number(learningRate),

            optimizer,
          }),
        }
      );

      const data = await response.json();

      if (!data.success) {
        setMessage(
          data.message ||
          "Unable to start training."
        );
        return;
      }

      setMessage(
        `Training Job #${data.job.id} added to queue.`
      );

      // Select the newly created job immediately, even if it is still queued.
      // Ignore older list requests that could remove it while refreshing.
      jobsRequestId.current += 1;
      setJobs((previous) => [data.job, ...previous.filter((job) => job.id !== data.job.id)]);
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous);
        next.set("job", String(data.job.id));
        return next;
      }, { replace: true });

      await loadJobs();

    } catch (error) {
      console.error(
        "Start training error:",
        error
      );

      setMessage(
        "Cannot connect to training API."
      );
    } finally {
      setStarting(false);
    }
  };

  // --------------------------------------------------
  // Helpers
  // --------------------------------------------------

  const getStatusColor = (status) => {
    switch (status) {
      case "completed":
        return "#16a34a";

      case "training":
        return "#2563eb";

      case "queued":
        return "#d97706";

      case "failed":
        return "#dc2626";

      default:
        return "#64748b";
    }
  };

  const formatNumber = (
    value,
    digits = 4
  ) => {
    if (
      value === null ||
      value === undefined
    ) {
      return "-";
    }

    const number = Number(value);

    if (Number.isNaN(number)) {
      return "-";
    }

    return number.toFixed(digits);
  };

  const getDatasetName = (
    targetDatasetId
  ) => {
    const dataset = datasets.find(
      (item) =>
        Number(item.id) ===
        Number(targetDatasetId)
    );

    return (
      dataset?.name ||
      `Dataset #${targetDatasetId}`
    );
  };

  // --------------------------------------------------
  // Not Logged In
  // --------------------------------------------------

  if (!ownerId) {
    return (
      <div>
        <Navbar />

        <div style={styles.page}>
          <Link to={`/projects/${id}`}>
            ← Back to Project
          </Link>

          <h1>Training</h1>

          <p>
            Please login before using
            the training system.
          </p>
        </div>
      </div>
    );
  }

  // --------------------------------------------------
  // UI
  // --------------------------------------------------

  return (
    <div style={styles.background}>
      <Navbar />

      <main style={styles.page}>
        <div style={styles.topBar}>
          <div>
            <Link
              to="/projects"
              style={styles.backLink}
            >
              ← Back to Projects
            </Link>

            <h1 style={styles.title}>
              Model Training
            </h1>

            <p style={styles.subtitle}>
              Project ID: {id}
            </p>
          </div>
        </div>

        {message && (
          <div style={styles.message}>
            {message}
          </div>
        )}

        {/* START TRAINING */}

        <section style={styles.card}>
          <div style={styles.cardHeader}>
            <div>
              <h2 style={styles.cardTitle}>
                Start New Training
              </h2>

              <p style={styles.cardDescription}>
                Train the current project
                architecture with one of
                your datasets.
              </p>
            </div>
          </div>

          <form
            onSubmit={startTraining}
            style={styles.form}
          >
            <label style={styles.field}>
              <span style={styles.label}>
                Dataset
              </span>

              <select
                value={datasetId}
                onChange={(event) =>
                  setDatasetId(
                    event.target.value
                  )
                }
                style={styles.input}
              >
                {datasets.length === 0 && (
                  <option value="">
                    No datasets available
                  </option>
                )}

                {datasets.map(
                  (dataset) => (
                    <option
                      key={dataset.id}
                      value={dataset.id}
                    >
                      {dataset.name} (#
                      {dataset.id})
                    </option>
                  )
                )}
              </select>
            </label>

            <label style={styles.field}>
              <span style={styles.label}>
                Epochs
              </span>

              <input
                type="number"
                min="1"
                value={epochs}
                onChange={(event) =>
                  setEpochs(
                    event.target.value
                  )
                }
                style={styles.input}
              />
            </label>

            <label style={styles.field}>
              <span style={styles.label}>
                Batch Size
              </span>

              <input
                type="number"
                min="1"
                value={batchSize}
                onChange={(event) =>
                  setBatchSize(
                    event.target.value
                  )
                }
                style={styles.input}
              />
            </label>

            <label style={styles.field}>
              <span style={styles.label}>
                Learning Rate
              </span>

              <input
                type="number"
                min="0.000001"
                step="any"
                value={learningRate}
                onChange={(event) =>
                  setLearningRate(
                    event.target.value
                  )
                }
                style={styles.input}
              />
            </label>

            <label style={styles.field}>
              <span style={styles.label}>
                Optimizer
              </span>

              <select
                value={optimizer}
                onChange={(event) =>
                  setOptimizer(
                    event.target.value
                  )
                }
                style={styles.input}
              >
                <option value="adam">
                  Adam
                </option>

                <option value="adamw">
                  AdamW
                </option>

                <option value="sgd">
                  SGD
                </option>
              </select>
            </label>

            <button
              type="submit"
              disabled={
                starting ||
                datasets.length === 0
              }
              style={{
                ...styles.startButton,

                opacity:
                  starting ||
                    datasets.length === 0
                    ? 0.6
                    : 1,
              }}
            >
              {starting
                ? "Adding to Queue..."
                : "Start Training"}
            </button>
          </form>
        </section>

        <TrainingCharts
          key={`${ownerId}:${id}`}
          apiUrl={API_URL}
          ownerId={ownerId}
          jobs={jobs}
          datasets={datasets}
          loading={loading}
        />

        {/* TRAINING JOBS */}

        <section style={styles.card}>
          <div style={styles.cardHeader}>
            <div>
              <h2 style={styles.cardTitle}>
                Training Jobs
              </h2>

              <p style={styles.cardDescription}>
                Progress refreshes
                automatically every
                3 seconds.
              </p>
            </div>

            <button
              onClick={loadJobs}
              style={styles.secondaryButton}
            >
              Refresh
            </button>
          </div>

          {loading ? (
            <p>Loading...</p>
          ) : jobs.length === 0 ? (
            <div style={styles.empty}>
              No training jobs yet.
            </div>
          ) : (
            <div style={styles.jobList}>
              {jobs.map((job) => {
                const progress =
                  job.total_epochs > 0
                    ? Math.min(
                      100,
                      (job.current_epoch /
                        job.total_epochs) *
                      100
                    )
                    : 0;

                return (
                  <article
                    key={job.id}
                    style={styles.job}
                  >
                    <div
                      style={
                        styles.jobTop
                      }
                    >
                      <div>
                        <strong>
                          Job #{job.id}
                        </strong>

                        <div
                          style={
                            styles.muted
                          }
                        >
                          {getDatasetName(
                            job.dataset_id
                          )}
                        </div>
                      </div>

                      <span
                        style={{
                          ...styles.status,

                          background:
                            getStatusColor(
                              job.status
                            ),
                        }}
                      >
                        {job.status}
                      </span>
                    </div>

                    <div
                      style={
                        styles.progressInfo
                      }
                    >
                      <span>
                        Epoch{" "}
                        {job.current_epoch} /{" "}
                        {job.total_epochs}
                      </span>

                      <span>
                        {progress.toFixed(0)}%
                      </span>
                    </div>

                    <div
                      style={
                        styles.progressTrack
                      }
                    >
                      <div
                        style={{
                          ...styles.progressBar,
                          width: `${progress}%`,
                        }}
                      />
                    </div>

                    <div
                      style={
                        styles.metricsGrid
                      }
                    >
                      <Metric
                        label="Train Loss"
                        value={formatNumber(
                          job.train_loss
                        )}
                      />

                      <Metric
                        label="Val Loss"
                        value={formatNumber(
                          job.val_loss
                        )}
                      />

                      <Metric
                        label="Train Accuracy"
                        value={
                          job.train_accuracy ==
                            null
                            ? "-"
                            : `${formatNumber(
                              job.train_accuracy,
                              2
                            )}%`
                        }
                      />

                      <Metric
                        label="Val Accuracy"
                        value={
                          job.val_accuracy ==
                            null
                            ? "-"
                            : `${formatNumber(
                              job.val_accuracy,
                              2
                            )}%`
                        }
                      />
                    </div>

                    {job.error_message && (
                      <div
                        style={
                          styles.errorBox
                        }
                      >
                        {job.error_message}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* TRAINED MODELS */}

        <section style={styles.card}>
          <div style={styles.cardHeader}>
            <div>
              <h2 style={styles.cardTitle}>
                Trained Models
              </h2>

              <p style={styles.cardDescription}>
                Model versions generated
                from completed training
                jobs.
              </p>
            </div>

            <button
              onClick={loadModels}
              style={styles.secondaryButton}
            >
              Refresh
            </button>
          </div>

          {models.length === 0 ? (
            <div style={styles.empty}>
              No trained models yet.
            </div>
          ) : (
            <div style={styles.modelGrid}>
              {models.map((model) => (
                <article
                  key={model.id}
                  style={styles.modelCard}
                >
                  <div
                    style={
                      styles.modelHeader
                    }
                  >
                    <div>
                      <h3
                        style={{
                          margin: 0,
                        }}
                      >
                        {model.name ||
                          `Model v${model.version}`}
                      </h3>

                      <div
                        style={
                          styles.muted
                        }
                      >
                        Version{" "}
                        {model.version}
                      </div>
                    </div>

                    <span
                      style={
                        styles.versionBadge
                      }
                    >
                      v{model.version}
                    </span>
                  </div>

                  <div
                    style={
                      styles.modelMetrics
                    }
                  >
                    <Metric
                      label="Best Accuracy"
                      value={
                        model.best_accuracy ==
                          null
                          ? "-"
                          : `${formatNumber(
                            model.best_accuracy,
                            2
                          )}%`
                      }
                    />

                    <Metric
                      label="Best Loss"
                      value={formatNumber(
                        model.best_loss
                      )}
                    />

                    <Metric
                      label="Best Epoch"
                      value={
                        model.epoch ?? "-"
                      }
                    />

                    <Metric
                      label="Classes"
                      value={
                        model.class_count ??
                        "-"
                      }
                    />
                  </div>

                  <div
                    style={
                      styles.fileInfo
                    }
                  >
                    <div>
                      <strong>PT:</strong>{" "}
                      {model.pt_path
                        ? "Available"
                        : "Not available"}
                    </div>

                    <div>
                      <strong>ONNX:</strong>{" "}
                      {model.onnx_path
                        ? "Available"
                        : "Not available"}
                    </div>
                  </div>

                  <div
                    style={styles.tags}
                  >
                    {(
                      model.class_names || []
                    ).map(
                      (className) => (
                        <span
                          key={className}
                          style={
                            styles.tag
                          }
                        >
                          {className}
                        </span>
                      )
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function Metric({
  label,
  value,
}) {
  return (
    <div style={styles.metric}>
      <span style={styles.metricLabel}>
        {label}
      </span>

      <strong style={styles.metricValue}>
        {value}
      </strong>
    </div>
  );
}

const styles = {
  background: {
    minHeight: "100vh",
    background:
      "radial-gradient(circle at top left, rgba(102, 126, 234, 0.16), transparent 30%), radial-gradient(circle at top right, rgba(139, 92, 246, 0.10), transparent 28%), #111319",
    color: "#f4f6fb",
  },

  page: {
    width: "min(1250px, calc(100% - 40px))",
    margin: "0 auto",
    padding: "56px 0 90px",
  },

  topBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "30px",
  },

  backLink: {
    textDecoration: "none",
    color: "#9da9ff",
    fontWeight: 700,
    fontSize: "14px",
  },

  title: {
    margin: "14px 0 6px",
    fontSize: "clamp(34px, 5vw, 54px)",
    lineHeight: 1.05,
    letterSpacing: "-0.04em",
    color: "#f4f6fb",
  },

  subtitle: {
    margin: 0,
    color: "#8f98ad",
    fontSize: "15px",
  },

  message: {
    padding: "14px 18px",
    marginBottom: "22px",
    borderRadius: "12px",
    border: "1px solid rgba(129, 140, 248, 0.32)",
    background: "rgba(99, 102, 241, 0.12)",
    color: "#c7d2fe",
  },

  card: {
    background: "rgba(23, 26, 35, 0.88)",
    borderRadius: "22px",
    padding: "26px",
    marginBottom: "24px",
    border: "1px solid rgba(255,255,255,0.09)",
    boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
    backdropFilter: "blur(12px)",
  },

  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "16px",
    marginBottom: "22px",
  },

  cardTitle: {
    margin: 0,
    fontSize: "22px",
    color: "#f4f6fb",
    letterSpacing: "-0.02em",
  },

  cardDescription: {
    margin: "7px 0 0",
    color: "#8f98ad",
    lineHeight: 1.6,
  },

  form: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "16px",
    alignItems: "end",
  },

  field: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },

  label: {
    fontSize: "13px",
    fontWeight: 800,
    color: "#c7cbe0",
    letterSpacing: "0.02em",
  },

  input: {
    height: "44px",
    borderRadius: "11px",
    border: "1px solid rgba(255,255,255,0.12)",
    padding: "0 13px",
    fontSize: "14px",
    background: "#181b24",
    color: "#f4f6fb",
    outline: "none",
  },

  startButton: {
    height: "44px",
    border: "1px solid rgba(151, 162, 255, 0.45)",
    borderRadius: "11px",
    padding: "0 20px",
    background:
      "linear-gradient(135deg, #6b74f7, #8b5cf6)",
    color: "#ffffff",
    fontWeight: 800,
    fontSize: "14px",
    cursor: "pointer",
    boxShadow:
      "0 10px 28px rgba(107, 116, 247, 0.20)",
  },

  secondaryButton: {
    border: "1px solid rgba(151, 162, 255, 0.30)",
    background: "rgba(107, 116, 247, 0.08)",
    color: "#c9ceff",
    borderRadius: "10px",
    padding: "9px 15px",
    cursor: "pointer",
    fontWeight: 700,
  },

  empty: {
    padding: "30px",
    textAlign: "center",
    borderRadius: "12px",
    border: "1px dashed rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.025)",
    color: "#81899b",
  },

  jobList: {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
  },

  job: {
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "16px",
    padding: "20px",
    background: "rgba(14, 16, 22, 0.54)",
  },

  jobTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "12px",
    marginBottom: "18px",
  },

  muted: {
    color: "#81899b",
    fontSize: "13px",
    marginTop: "5px",
  },

  status: {
    alignSelf: "flex-start",
    padding: "6px 11px",
    borderRadius: "999px",
    color: "#ffffff",
    fontSize: "11px",
    fontWeight: 900,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  },

  progressInfo: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: "13px",
    color: "#aeb5c6",
    marginBottom: "8px",
  },

  progressTrack: {
    width: "100%",
    height: "8px",
    background: "#272b37",
    borderRadius: "999px",
    overflow: "hidden",
  },

  progressBar: {
    height: "100%",
    background:
      "linear-gradient(90deg, #6b74f7, #a855f7)",
    borderRadius: "999px",
    transition: "width 0.3s ease",
  },

  metricsGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(130px, 1fr))",
    gap: "10px",
    marginTop: "18px",
  },

  metric: {
    background: "rgba(255,255,255,0.035)",
    border: "1px solid rgba(255,255,255,0.055)",
    padding: "13px",
    borderRadius: "11px",
  },

  metricLabel: {
    display: "block",
    color: "#7f8799",
    fontSize: "11px",
    fontWeight: 700,
    marginBottom: "6px",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },

  metricValue: {
    color: "#eef0ff",
    fontSize: "16px",
  },

  errorBox: {
    marginTop: "14px",
    padding: "13px",
    borderRadius: "10px",
    border: "1px solid rgba(248,113,113,0.22)",
    background: "rgba(127,29,29,0.18)",
    color: "#fca5a5",
  },

  modelGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(300px, 1fr))",
    gap: "16px",
  },

  modelCard: {
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "16px",
    padding: "20px",
    background:
      "linear-gradient(145deg, rgba(27,30,41,0.95), rgba(18,20,28,0.95))",
  },

  modelHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "12px",
    marginBottom: "16px",
  },

  versionBadge: {
    height: "fit-content",
    background: "rgba(107,116,247,0.15)",
    color: "#aeb6ff",
    border: "1px solid rgba(151,162,255,0.25)",
    padding: "6px 10px",
    borderRadius: "8px",
    fontWeight: 900,
  },

  modelMetrics: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: "8px",
  },

  fileInfo: {
    marginTop: "15px",
    paddingTop: "15px",
    borderTop: "1px solid rgba(255,255,255,0.07)",
    color: "#9ba3b5",
    fontSize: "13px",
    lineHeight: 1.9,
  },

  tags: {
    display: "flex",
    flexWrap: "wrap",
    gap: "7px",
    marginTop: "13px",
  },

  tag: {
    padding: "5px 9px",
    borderRadius: "7px",
    background: "rgba(139, 92, 246, 0.12)",
    border: "1px solid rgba(139,92,246,0.18)",
    color: "#c4b5fd",
    fontSize: "12px",
    fontWeight: 600,
  },
};

export default TrainingPage;
