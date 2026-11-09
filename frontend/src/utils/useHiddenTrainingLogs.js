import { useEffect, useState } from "react";

export function useHiddenTrainingLogs(userId) {
  const key = `ai-trainer:hidden-logs:${userId}`;
  const read = () => {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return {
        through: Number.isSafeInteger(value?.through) && value.through >= 0 ? value.through : 0,
        ids: Array.isArray(value?.ids) ? value.ids.filter(id => Number.isSafeInteger(id) && id > 0) : [],
      };
    } catch { return { through: 0, ids: [] }; }
  };
  const [hidden, setHidden] = useState(read);
  useEffect(() => {
    const sync = event => { if (event.key === key || event.key === null) setHidden(read()); };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
    // The workspace remounts whenever the signed-in account changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  function save(value) {
    if (value.ids.join(",").length > 10000) throw new Error("Use Delete log to clear all logs before hiding more jobs.");
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch { throw new Error("Unable to save hidden logs in this browser. Enable site storage and retry."); }
    setHidden(value);
  }
  return {
    extra: `&hidden_through=${hidden.through}&hidden_ids=${encodeURIComponent(hidden.ids.join(","))}`,
    hide: id => { const current = read(); save({ ...current, ids: [...new Set([...current.ids, id])] }); },
    clear: through => { const current = read(); const cutoff = Math.max(current.through, through);
      save({ through: cutoff, ids: current.ids.filter(id => id > cutoff) }); },
  };
}
