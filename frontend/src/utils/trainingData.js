// Preserve references for unchanged records so memoized graphs can skip renders.
export function reuseUnchangedList(previous, incoming) {
  const byKey = new Map(previous.map((item) => [item.id ?? item.epoch, item]));
  const next = incoming.map((item) => {
    const old = byKey.get(item.id ?? item.epoch);
    return old && JSON.stringify(old) === JSON.stringify(item) ? old : item;
  });
  return next.length === previous.length && next.every((item, index) => item === previous[index])
    ? previous
    : next;
}

export function completedJobsSignature(jobs) {
  return JSON.stringify(jobs.filter((job) => job.status === "completed")
    .map((job) => [job.id, job.finished_at]).sort((a, b) => a[0] - b[0]));
}
