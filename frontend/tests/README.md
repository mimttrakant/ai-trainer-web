# Training graph checks

`dataset-library.spec.js` checks the Thai preparation/import guide, class/image
summaries, on-demand details, per-split counts, class search and pagination,
processing/unsupported/error states, retries, keyboard focus and mobile bounds.
All API responses are mocked; these tests never upload or delete real datasets.
See `backend/tests/DATASET_DETAILS.md` for the count/cache contract and API tests.

`builder-versioning.spec.js` covers model names, per-save version increments,
reload, failed/concurrent-tab saves, draft JSON export, import into a different
project, legacy JSON, replacement confirmation, and invalid/oversized files.
Builder API calls are mocked; no real project is saved by these browser tests.

`trained-models.spec.js` also verifies PT / ONNX downloads, filenames, deletion
confirmation/cancellation, retained graphs, disabled formats, failures and mobile
layout. Its model bytes and API responses are synthetic. See
`backend/tests/MODEL_ACTIONS.md` for backend checks and soft-delete semantics.

The workflow checks also cover saved-version dropdowns, training a specifically
selected revision, advisory concurrent-editor warnings with retained local
drafts, displayed training datasets, and downloading a trained model's JSON then
importing it into a new Builder project. Backend tests exercise the actual
PostgreSQL save lock / unique row IDs and presence expiry in private schemas.

From `frontend/`, run `npm run test:e2e`. The suite uses installed Google Chrome
in headless mode and starts an isolated Vite server on port 5180. API responses
are simulated; the tests do not create jobs or write to the database.
Set `PLAYWRIGHT_CHANNEL` to use another installed browser channel, such as `msedge`.

The tests cover saved history, reload/navigation/reopening a tab, epoch updates,
completion, connection recovery, switching jobs during a request, missing history,
and the mobile layout. Screenshots and failure traces are written to the ignored
`test-results/` directory.

Job-list checks also cover the 48-hour completion cutoff in the Asia/Bangkok
timezone, preserving historical graphs, five-job pagination, keeping active jobs
first, and returning to the first page after starting a new job. The retention
rule only hides older completed jobs in the default view; it deletes no data.

The graph job picker suggests matches as the user types, ignoring case, spaces
and `#` (for example `j`, `job#`, `Job #7`, `7`, dataset names or statuses).
It initially shows up to ten jobs, with active jobs first. Searching covers all
history, and both search results and View all history use ten-result pages in a
height-limited popup. Tests cover keyboard/mouse selection, dismissal, exact-ID
ranking, no matches, older history, mobile bounds, and no chart redraws or metric
requests while typing. Search uses the already-loaded job list; it does not add
per-keystroke API requests or delete history.

Refresh-performance checks verify 3-second polling while jobs are active and
30-second polling when idle, with an immediate refresh on return to the tab.
They also verify that unchanged charts have no DOM mutations, metrics are fetched
on new epochs/status changes, and model lists reload on completion (with retries
after a failed refresh). Hidden tabs pause job requests until they become visible.

The optional live test reads an existing job from the app on `localhost:5173`
and its API on `localhost:8000`. Supply the IDs of a job with saved metrics:

```powershell
$env:TRAINING_LIVE_OWNER = '<owner ID>'
$env:TRAINING_LIVE_PROJECT = '<project ID>'
$env:TRAINING_LIVE_JOB = '<job ID>'
npm run test:e2e -- tests/training-charts-live.spec.js
Remove-Item Env:TRAINING_LIVE_OWNER, Env:TRAINING_LIVE_PROJECT, Env:TRAINING_LIVE_JOB
```

The live check uses a separate browser context and blocks API write requests.
It verifies that both graphs display the saved database points and reloads the
page to verify history restoration. No training is started.

With the same live environment variables, `tests/builder-live.spec.js` checks the
running Builder's version and JSON export while blocking all API writes. It
verifies the project's saved architecture and version stay unchanged.
