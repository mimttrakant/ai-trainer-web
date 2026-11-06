# AI Trainer — local Docker setup

Install Docker Desktop with the WSL 2 backend and Linux containers, then start
Docker Desktop. Python, Node.js, PostgreSQL and application dependencies are
installed inside the containers; no separate host installation is required.

## Start

Double-click [start.bat](./start.bat), or run from this directory:

```powershell
docker compose up --build -d --wait --wait-timeout 180
```

The first build downloads dependencies and can take several minutes. The stack
starts PostgreSQL, the API, the training worker, the frontend and Adminer. The API
creates/migrates its tables automatically. The worker waits for the API to finish
startup and processes one training job at a time.

| Service | Address |
| --- | --- |
| Web app | http://127.0.0.1:5173 |
| API documentation | http://127.0.0.1:8000/docs |
| Adminer | http://127.0.0.1:8080 |
| PostgreSQL from Windows | 127.0.0.1:5433 |

Use `127.0.0.1` if `localhost` times out: on some Windows Docker setups,
`localhost` resolves to IPv6 while the working port forwarding uses IPv4.

Register an account in the web app to begin. In Adminer, select PostgreSQL,
server `db`, username `postgres`, password `postgres`, database `ai_trainer`.
These are the existing local development credentials in [compose.yaml](./compose.yaml).

The default image installs **CPU PyTorch**. NVIDIA GPU training needs a compatible
CUDA PyTorch build and Docker GPU access; the default stack does not enable it.

## Daily use

```powershell
docker compose ps
docker compose logs --tail 100 backend worker frontend
docker compose stop
docker compose up -d --wait --wait-timeout 180
```

The containers restart when Docker starts unless you explicitly stopped them.
PostgreSQL data persists in the `postgres_data` Docker volume. Datasets and model
files persist in the bind-mounted `storage/` directory. Do not use
`docker compose down -v` unless you intend to delete the database volume.

Training is already running in the `worker` service. There is no need to launch
[worker.bat](./worker.bat) as well. Change `TRAINING_WORKER_THREADS` in
[compose.yaml](./compose.yaml) and run `docker compose up -d worker` to change
concurrency. See [worker documentation](./backend/training/README.md) for details.

When frontend dependencies change, refresh the persistent `node_modules` volume:

```powershell
docker compose stop frontend
docker compose run --rm --no-deps frontend npm ci
docker compose up -d frontend
```

## Verify

```powershell
docker compose exec -T frontend npm run build
docker compose exec -T -e WORKER_TEST_POSTGRES=1 backend python -m unittest discover -s tests -p test_training_worker.py -v
```

The worker integration tests use temporary schemas and synthetic images, including
real CPU training and model export, without changing application records.
