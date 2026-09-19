import { useEffect, useRef, useState } from "react";
import "./ModelActions.css";

export default function ModelActions({ apiUrl, ownerId, projectId, model, onDeleted }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const request = useRef(null);
  useEffect(() => () => request.current?.abort(), []);
  const baseUrl = `${apiUrl}/training/projects/${projectId}/models/${model.id}`;

  async function perform(action) {
    if (request.current) return;
    if (action === "delete" && !window.confirm(
      `Remove ${model.name || `Model v${model.version}`} from Trained Models?\n\nThe model files and training graphs will be retained. This does not free disk space.`,
    )) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(action);
    setError("");
    const timeout = setTimeout(() => controller.abort(), 300000);
    try {
      const response = await fetch(
        `${baseUrl}${action === "delete" ? "" : `/download/${action}`}?owner_id=${ownerId}`,
        { method: action === "delete" ? "DELETE" : "GET", signal: controller.signal, cache: "no-store" },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(typeof data.detail === "string" ? data.detail : data.message || "Unable to complete this action. Please try again.");
      }
      if (action === "delete") {
        const data = await response.json();
        if (!data.success) throw new Error(data.message || "Unable to remove this model.");
        onDeleted(model.id);
      } else {
        const blob = await response.blob();
        const disposition = response.headers.get("Content-Disposition") || "";
        const filename = disposition.match(/filename="([^"]+)"/)?.[1]
          || `model-${model.id}.${response.headers.get("Content-Type")?.includes("zip") ? "zip" : action}`;
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        // Give the browser time to start saving before releasing the blob.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (cause) {
      setError(controller.signal.aborted ? "The request was interrupted or timed out. Refresh the list before retrying." : cause.message);
    } finally {
      clearTimeout(timeout);
      request.current = null;
      setBusy("");
    }
  }

  return (
    <div className="model-actions">
      <div className="model-actions__buttons">
        {[["pt", "PT"], ["onnx", "ONNX"], ["json", "JSON"]].map(([format, label]) => (
          <button type="button" key={format}
            disabled={Boolean(busy) || (format === "json" ? !model.has_architecture : !model[`${format}_path`]) || model.allow_download === false}
            onClick={() => perform(format)}>
            {busy === format ? `Downloading ${label}…` : `Download ${label}`}
          </button>
        ))}
        <button type="button" className="model-actions__delete" disabled={Boolean(busy)} onClick={() => perform("delete")}>
          {busy === "delete" ? "Removing…" : "Delete model"}
        </button>
      </div>
      {model.onnx_path && <p className="model-actions__hint">ONNX includes external weights as a ZIP when needed. Extract all files together.</p>}
      {model.has_architecture && <p className="model-actions__hint">JSON contains the Builder design used for this training run, not trained weights. Load it with Import JSON.</p>}
      {error && <p role="alert" className="model-actions__error">{error}</p>}
    </div>
  );
}
