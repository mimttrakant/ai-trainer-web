# Training worker

`docker compose up -d` starts the `worker` service automatically, after the API is
healthy. View its output with `docker compose logs -f worker`. Configure its
concurrency using `TRAINING_WORKER_THREADS` in [compose.yaml](../../compose.yaml),
then run `docker compose up -d worker` to apply changes.

The commands below start an additional foreground worker. Stop the automatic
worker first with `docker compose stop worker` if you only want one worker process.

From the repository root on Windows:

```powershell
.\worker.bat                  # one job at a time (default)
.\worker.bat 2                # up to two jobs at once
.\worker.bat 3 --torch-threads 1
```

Equivalent Docker commands:

```powershell
docker compose exec backend python -m training.worker --threads 2
docker compose exec -e TRAINING_WORKER_THREADS=2 -e TRAINING_TORCH_THREADS=1 backend python -m training.worker
```

`--threads` / `TRAINING_WORKER_THREADS` controls the maximum number of concurrent
training jobs **per worker process**. Set it to `1` for sequential training.
`--torch-threads` / `TRAINING_TORCH_THREADS` separately controls native CPU threads
per PyTorch operation. If omitted, the worker divides PyTorch's current CPU thread
count by the job concurrency, with a minimum of one. CLI options override the
environment. Values must be positive integers. Restart the worker to change them.

Each job gets its own model, optimizer, data loaders and database sessions.
PostgreSQL `FOR UPDATE SKIP LOCKED` claims a queued job and marks it `training`
in one transaction, so another consumer cannot claim it. Workers share a database
project-row lock while allocating a model version and publishing its files.
Exports run one at a time within a worker process; the training loops can overlap.
The database connection is released during training; epoch history is committed
through short separate sessions, as before.

Use only `python -m training.worker` for this queue. The old
`backend/training_worker.py` is a mock worker and does not implement these locks.
Stop an already-running old worker before starting this updated version.

Ctrl+C or SIGTERM stops new claims and waits for active jobs to save their results.
Force-killing the process or losing power can still leave jobs marked `training`;
there is no automatic crash recovery/requeue in this phase. A Python job failure
is recorded on that job and does not stop other consumers.

Multiple threads share the machine's RAM and the currently selected GPU/VRAM.
More concurrent jobs can use more memory or reduce throughput; benchmark your
own model before increasing the limit. This does not split one model across
multiple GPUs, and it does not implement continue/fine-tune training. The default
remains one concurrent job. PyTorch native parallelism also needs to be bounded
to avoid CPU oversubscription:
[PyTorch guidance](https://docs.pytorch.org/docs/stable/notes/multiprocessing.html#cpu-oversubscription).
Database sessions stay local to each thread, following
[SQLAlchemy's concurrency guidance](https://docs.sqlalchemy.org/en/20/orm/contextual.html#thread-local-scope).

## Tests

```powershell
docker compose exec -T -e WORKER_TEST_POSTGRES=1 backend python -m unittest discover -s tests -p test_training_worker.py -v
```

Tests create a random `worker_test_<uuid>` PostgreSQL schema, synthetic images and
temporary model files. Only that schema and temporary directory are removed at
the end; application tables and stored models are not modified. The database role
must be allowed to create schemas. Optionally set `WORKER_TEST_DATABASE_URL` to a
separate PostgreSQL database. Without `WORKER_TEST_POSTGRES=1`, database integration
tests are skipped and configuration/scheduling tests still run.

Coverage includes concurrency limits, graceful shutdown, transient claim errors,
atomic queue claims, skipping locked jobs, version allocation without a shared
Python lock, and two real CPU training jobs producing separate epoch histories,
PyTorch checkpoints and validated ONNX exports.
