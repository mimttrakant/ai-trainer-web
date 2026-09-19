const COMPLETED_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;

function timestamp(value) {
  if (typeof value !== "string" || !value) return NaN;
  // The API serializes datetime.utcnow() without a timezone suffix.
  // Interpret those timestamps as UTC, not the browser's local timezone.
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  return Date.parse(zoned ? value : `${value}Z`);
}

export function isArchivedTrainingJob(job, now) {
  const finishedAt = timestamp(job.finished_at);
  return job.status === "completed"
    && Number.isFinite(finishedAt)
    && now - finishedAt > COMPLETED_RETENTION_MS;
}

export function visibleTrainingJobs(jobs, showHistory, now) {
  const active = (job) => job.status === "training" || job.status === "queued";
  return jobs.filter((job) => showHistory || !isArchivedTrainingJob(job, now))
    .sort((a, b) => Number(active(b)) - Number(active(a))
      || (timestamp(b.created_at) || 0) - (timestamp(a.created_at) || 0)
      || b.id - a.id);
}
