# Library and Training checks

Run `npm run test:e2e` from `frontend/`. Playwright uses installed headless Chrome
and an isolated Vite server on port 5180. API responses, sessions, uploads and
downloads are synthetic; the default suite does not modify real user data.
Set `PLAYWRIGHT_CHANNEL` to another installed browser channel if needed.

- `dataset-library.spec.js`: My/Public scope, username prefixes, URL provider,
  privacy controls, ZIP download, cached class details and mobile preparation guide.
- `models-library.spec.js`: row-based library, Edit versus Clone permissions,
  selecting an old version for a private Version 1 clone, create-to-Builder flow.
- `builder-versioning.spec.js`: names, immutable saves, reload, concurrent edits,
  saved-version selection, JSON import/export validation and retained local drafts.
- `training-charts.spec.js`: saved/live graphs, reload and navigation, stable chart
  DOM on unchanged epochs, final completion, transient errors, revoked access,
  job switching, exact-version submission, new-job selection, model/version reset,
  bounded searchable pagination and mobile layout.
- `trained-models.spec.js`: PT/ONNX download, no Training JSON action, Delete Job
  confirmation/cancellation, selected-result cleanup, public result access, owner-only
  controls, failures, disabled formats, concurrent-action guards and mobile layout.
- `training-logs.spec.js`: per-account browser log hiding, pagination after hiding,
  clearing all pages despite search, persistence across reload, new jobs after
  clearing, CSV contents/errors, and deletion of failed jobs without weights.

The new job list displays ten results per page; all history is searchable instead
of the old 48-hour cutoff. Graphs poll at 3 seconds active / 30 seconds completed.
Hidden tabs pause polling. Screenshots and failure traces are ignored under
`test-results/`. Existing backend tests separately exercise PostgreSQL row locks,
real threaded CPU training, protected downloads and immutable model snapshots.
See `backend/tests/COMMUNITY.md` for sharing and admission behavior.

Optional read-only live checks require `TRAINING_LIVE_OWNER`,
`TRAINING_LIVE_PROJECT` (Builder), `TRAINING_LIVE_JOB` (graphs), and
`TRAINING_LIVE_TOKEN` (an existing valid session). Never commit the token. They
read the local app on port 5173, block API writes, and are skipped unless explicitly
configured. Normal verification intentionally uses no real account credentials.
