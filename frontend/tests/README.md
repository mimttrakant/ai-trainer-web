# Training graph checks

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
