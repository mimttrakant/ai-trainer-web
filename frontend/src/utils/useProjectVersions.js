import { useCallback, useEffect, useRef, useState } from "react";
import { reuseUnchangedList } from "./trainingData";

export function useProjectVersions(apiUrl, projectId, ownerId) {
  const [versions, setVersions] = useState([]);
  const [error, setError] = useState("");
  const [latest, setLatest] = useState(0);
  const requests = useRef(0);
  const refresh = useCallback(async () => {
    if (!projectId || !ownerId) return;
    const request = ++requests.current;
    try {
      const response = await fetch(`${apiUrl}/projects/${projectId}/versions?owner_id=${ownerId}`, {
        cache: "no-store", signal: AbortSignal.timeout(15000),
      });
      const data = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.versions)) throw new Error("Unable to load Builder versions. Refresh versions to retry.");
      if (request !== requests.current) return;
      setVersions(previous => reuseUnchangedList(previous, data.versions));
      setLatest(data.latest_version);
      setError("");
    } catch (cause) {
      if (request === requests.current) setError(cause.message);
    }
  }, [apiUrl, projectId, ownerId]);

  useEffect(() => {
    let disposed = false;
    let timer;
    const update = async () => {
      clearTimeout(timer);
      if (document.visibilityState === "visible") await refresh();
      if (!disposed) timer = setTimeout(update, 30000);
    };
    update();
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      disposed = true;
      requests.current += 1;
      clearTimeout(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [refresh]);
  return { versions, latest, error, refresh };
}

export function useEditorPresence(apiUrl, projectId, ownerId, enabled) {
  const [presence, setPresence] = useState({ active_editors: 0, latest_version: 0, connected: false });
  useEffect(() => {
    if (!enabled || !ownerId) return;
    const session = crypto.randomUUID();
    const url = `${apiUrl}/projects/${projectId}/editors/${session}?owner_id=${ownerId}`;
    let disposed = false;
    let inFlight = false;
    let timer;
    const update = async () => {
      if (inFlight || disposed) return;
      clearTimeout(timer);
      inFlight = true;
      try {
        if (document.visibilityState === "visible") {
          const response = await fetch(url, { method: "PUT", signal: AbortSignal.timeout(10000) });
          const data = await response.json();
          if (!response.ok || !data.success) throw new Error("Presence unavailable");
          if (!disposed) setPresence(previous => previous.active_editors === data.active_editors
            && previous.latest_version === data.latest_version && previous.connected ? previous
            : { active_editors: data.active_editors, latest_version: data.latest_version, connected: true });
        }
      } catch {
        if (!disposed) setPresence(previous => previous.connected ? { ...previous, connected: false } : previous);
      } finally {
        inFlight = false;
        if (disposed) {
          fetch(url, { method: "DELETE", keepalive: true }).catch(() => {});
        } else timer = setTimeout(update, 20000);
      }
    };
    update();
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
      if (!inFlight) fetch(url, { method: "DELETE", keepalive: true }).catch(() => {});
    };
  }, [apiUrl, projectId, ownerId, enabled]);
  return presence;
}
