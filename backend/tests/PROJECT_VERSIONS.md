# Builder versions and training provenance

`projects.version` is a per-project counter: a new project starts at 0 (unsaved),
and each successful Save creates 1, 2, 3, ... even if the design is unchanged.
`projects.model_name` is independent from the project title. `project_versions`
stores an immutable name/architecture snapshot for every Save. Save requires
`owner_id`, `model_name`, `architecture_json`, and `expected_version`; row locking
and a unique (project_id, version) constraint protect concurrent saves. A stale
tab gets HTTP 409 without overwriting the newer design.

Job submission locks the project and copies its current saved name, architecture
and version onto `training_jobs`. Workers train that snapshot, not whatever the
Builder contains when a queued job eventually starts. `model_versions` and
exported `metadata.json` record `project_version`. The older `model_versions.version`
is still the sequential training-run/export number; two runs can share one
Builder version. Never reset that export number: it names stored weight folders.

The additive migration makes the existing current architecture Version 1 and
preserves it as a baseline. Past jobs/models remain NULL/unknown: the system did
not historically record the Builder version and must not invent one. Old queued
jobs without snapshots retain the previous worker behavior, also marked unknown.

Restart existing `worker.bat` processes after deployment so they load snapshot
support. Do not interrupt running training jobs; let them finish before restart.
The API reload applies the additive database migration. Git rollbacks do not
automatically revert database schemas, revision rows or model files.

Tests use private PostgreSQL schemas and synthetic data only:

```powershell
docker compose exec -T -e WORKER_TEST_POSTGRES=1 backend python -m unittest discover -s tests -p test_project_versioning.py -v
docker compose exec -T -e WORKER_TEST_POSTGRES=1 backend python -m unittest discover -s tests -p test_training_worker.py -v
```

As with existing APIs, ownership is checked against the supplied `owner_id`, not
a server-authenticated identity. Production authentication is a separate task.
