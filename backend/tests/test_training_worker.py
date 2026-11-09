"""Worker regression tests; PostgreSQL tests use a disposable, private schema."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from contextlib import nullcontext
from datetime import datetime
import json
import os
from pathlib import Path
import re
from tempfile import TemporaryDirectory
from threading import Barrier, Event, Lock
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from uuid import uuid4

from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.schema import CreateSchema, DropSchema
import torch

from models import Base, Dataset, ModelVersion, Project, TrainingJob, TrainingMetric
from training import exporter, trainer, worker


class WorkerConfigurationTests(unittest.TestCase):
    def test_defaults_environment_and_cli_override(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(worker.parse_args([]).threads, 1)
            self.assertIsNone(worker.parse_args([]).torch_threads)
        with patch.dict(os.environ, {"TRAINING_WORKER_THREADS": "3", "TRAINING_TORCH_THREADS": "2"}):
            self.assertEqual(worker.parse_args([]).threads, 3)
            args = worker.parse_args(["--threads", "4", "--torch-threads", "1"])
            self.assertEqual((args.threads, args.torch_threads), (4, 1))

    def test_invalid_limits_are_rejected_before_starting(self):
        for value in [0, -1, "0", "-2", "abc", "1.5", True]:
            with self.subTest(value=value), self.assertRaises(argparse.ArgumentTypeError):
                worker.positive_int(value)

    def test_pool_never_exceeds_configured_concurrency(self):
        for limit in [1, 2, 3]:
            stop = Event()
            lock = Lock()
            pending = list(range(6))
            completed = []
            active = 0
            peak = 0

            def process():
                nonlocal active, peak
                with lock:
                    if not pending:
                        stop.set()
                        return False
                    item = pending.pop()
                    active += 1
                    peak = max(peak, active)
                time.sleep(0.05)
                with lock:
                    completed.append(item)
                    active -= 1
                return True

            with self.subTest(limit=limit), patch.object(worker, "process_training_job", process):
                worker.run_worker(limit, torch_threads=1, stop_event=stop)
                self.assertEqual(peak, limit)
                self.assertEqual(sorted(completed), list(range(6)))

    def test_shutdown_drains_active_jobs_without_claiming_more(self):
        stop = Event()
        release = Event()
        started = Barrier(3)
        calls = []
        lock = Lock()

        def process():
            with lock:
                calls.append(1)
            started.wait(timeout=5)
            release.wait(timeout=5)
            return True

        with patch.object(worker, "process_training_job", process), ThreadPoolExecutor(1) as control:
            future = control.submit(worker.run_worker, 2, 1, stop)
            try:
                started.wait(timeout=5)
                stop.set()
                self.assertFalse(future.done())
            finally:
                release.set()
                stop.set()
            future.result(timeout=5)
        self.assertEqual(len(calls), 2)

    def test_consumer_survives_a_claim_connection_error(self):
        stop = Event()
        calls = []

        def process():
            calls.append(1)
            if len(calls) == 1:
                raise ConnectionError("simulated temporary failure")
            stop.set()
            return False

        with patch.object(worker, "process_training_job", process), patch.object(worker, "POLL_INTERVAL_SECONDS", 0.01):
            worker.consume_jobs(stop)
        self.assertEqual(len(calls), 2)


@unittest.skipUnless(os.getenv("WORKER_TEST_POSTGRES") == "1", "Set WORKER_TEST_POSTGRES=1 for isolated PostgreSQL integration tests.")
class WorkerPostgresTests(unittest.TestCase):
    def setUp(self):
        url = os.getenv("WORKER_TEST_DATABASE_URL") or os.environ["DATABASE_URL"]
        self.admin_engine = create_engine(url)
        self.addCleanup(self.admin_engine.dispose)
        if self.admin_engine.dialect.name != "postgresql":
            self.skipTest("PostgreSQL is required to exercise SKIP LOCKED and row locks.")
        self.schema = "worker_test_" + uuid4().hex
        with self.admin_engine.begin() as connection:
            connection.execute(CreateSchema(self.schema))
        self.addCleanup(self.drop_test_schema)
        self.engine = create_engine(url, connect_args={"options": f"-csearch_path={self.schema}"})
        self.addCleanup(self.engine.dispose)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine)
        self.addCleanup(patch.stopall)
        patch.object(worker, "SessionLocal", self.sessions).start()
        self.temp = TemporaryDirectory(prefix="worker_test_")
        self.addCleanup(self.temp.cleanup)
        patch.object(exporter, "STORAGE_ROOT", Path(self.temp.name) / "storage").start()
        patch.object(trainer, "get_device", lambda: torch.device("cpu")).start()
        torch.set_num_threads(1)
        self.dataset_path = Path(self.temp.name) / "dataset"
        for split in ["train", "val"]:
            for label, color in [("red", (255, 0, 0)), ("blue", (0, 0, 255))]:
                folder = self.dataset_path / split / label
                folder.mkdir(parents=True)
                for index in range(4):
                    Image.new("RGB", (32, 32), color).save(folder / f"{index}.png")
        patch.object(worker, "resolve_dataset_path", lambda dataset: str(self.dataset_path)).start()
        architecture = {
            "nodes": [
                {"id": "input", "data": {"layerType": "Input", "properties": {"channels": 3, "height": 32, "width": 32}}},
                {"id": "flatten", "data": {"layerType": "Flatten", "properties": {}}},
                {"id": "output", "data": {"layerType": "Output", "properties": {}}},
            ],
            "edges": [{"source": "input", "target": "flatten"}, {"source": "flatten", "target": "output"}],
        }
        with self.sessions() as db:
            db.add(Project(id=1, owner_id=1, name="Thread test", architecture_json=json.dumps(architecture)))
            db.add(Dataset(id=1, owner_id=1, name="Synthetic colors", source_type="upload", supported=True))
            db.commit()

    def drop_test_schema(self):
        if not re.fullmatch(r"worker_test_[0-9a-f]{32}", self.schema):
            raise RuntimeError("Refusing to remove an unrecognized test schema.")
        with self.admin_engine.begin() as connection:
            connection.execute(DropSchema(self.schema, cascade=True))

    def add_jobs(self, count):
        with self.sessions() as db:
            for job_id in range(1, count + 1):
                db.add(TrainingJob(
                    id=job_id, owner_id=1, project_id=1, dataset_id=1,
                    status="queued", mode="new", total_epochs=2, batch_size=4,
                    created_at=datetime(2026, 1, 1),
                ))
            db.commit()

    def test_atomic_claims_never_take_the_same_job(self):
        self.add_jobs(12)
        barrier = Barrier(4)

        def consume():
            barrier.wait(timeout=5)
            ids = []
            while True:
                job_id = worker.claim_queued_job()
                if job_id is None:
                    return ids
                ids.append(job_id)

        with ThreadPoolExecutor(4) as pool:
            claimed = [job_id for group in pool.map(lambda _: consume(), range(4)) for job_id in group]
        self.assertEqual(sorted(claimed), list(range(1, 13)))
        self.assertIsNone(worker.claim_queued_job(1))
        with self.sessions() as db:
            self.assertEqual(db.query(TrainingJob).filter_by(status="training").count(), 12)

    def test_locked_oldest_job_is_skipped_and_completed_jobs_are_not_restarted(self):
        self.add_jobs(3)
        with self.sessions() as db:
            db.query(TrainingJob).filter_by(id=3).update({"status": "completed"})
            db.commit()
        with self.sessions() as locked, ThreadPoolExecutor(1) as pool:
            locked.query(TrainingJob).filter_by(id=1).with_for_update().one()
            self.assertEqual(pool.submit(worker.claim_queued_job).result(timeout=5), 2)
        self.assertEqual(worker.claim_queued_job(), 1)
        self.assertFalse(worker.process_training_job(3))

    def test_real_training_overlaps_and_saves_separate_metrics_and_exports(self):
        self.add_jobs(3)
        with self.sessions() as db:
            db.query(TrainingJob).filter_by(id=3).update({"mode": "unsupported"})
            db.commit()
        # Both models must reach the trainer before either can proceed. Also
        # verify neither thread holds a database connection during training.
        barrier = Barrier(2, action=lambda: self.assertEqual(self.engine.pool.checkedout(), 0))
        real_train = worker.train_classification_model
        models = []
        models_lock = Lock()

        def concurrent_train(**kwargs):
            with models_lock:
                models.append(kwargs["model"])
            barrier.wait(timeout=15)
            return real_train(**kwargs)

        with patch.object(worker, "train_classification_model", concurrent_train), ThreadPoolExecutor(2) as pool:
            results = list(pool.map(worker.process_training_job, [1, 2]))
        self.assertEqual(results, [True, True])
        self.assertIsNot(models[0], models[1])
        self.assertTrue(worker.process_training_job(3))
        with self.sessions() as db:
            jobs = db.query(TrainingJob).order_by(TrainingJob.id).all()
            self.assertEqual([job.status for job in jobs], ["completed", "completed", "failed"])
            self.assertIsNotNone(jobs[2].error_message)
            for job in jobs[:2]:
                metrics = db.query(TrainingMetric).filter_by(training_job_id=job.id).order_by(TrainingMetric.epoch).all()
                self.assertEqual([metric.epoch for metric in metrics], [1, 2])
                self.assertEqual(job.current_epoch, 2)
                self.assertEqual(job.train_loss, metrics[-1].train_loss)
                self.assertEqual(job.val_accuracy, metrics[-1].val_accuracy)
            versions = db.query(ModelVersion).order_by(ModelVersion.version).all()
            self.assertEqual([version.version for version in versions], [1, 2])
            self.assertEqual({version.training_job_id for version in versions}, {1, 2})
            for version in versions:
                for path in [version.pt_path, version.onnx_path, version.checkpoint_path]:
                    self.assertTrue(Path(path).is_file(), path)
                checkpoint = torch.load(version.checkpoint_path, weights_only=True)
                self.assertEqual(checkpoint["class_names"], ["blue", "red"])
                import onnx
                onnx.checker.check_model(version.onnx_path)

    def test_project_lock_protects_versions_without_a_shared_python_lock(self):
        self.add_jobs(2)
        rendezvous = Barrier(2)

        def fake_export(**kwargs):
            time.sleep(0.1)
            path = f"/temporary-test/version_{kwargs['version']}"
            return {"pt_path": path + ".pt", "checkpoint_path": path + ".checkpoint", "onnx_path": path + ".onnx"}

        def publish(job_id):
            with self.sessions() as db:
                job = db.get(TrainingJob, job_id)
                project = db.get(Project, 1)
                dataset = db.get(Dataset, 1)
                db.expunge_all()
                db.rollback()
                rendezvous.wait(timeout=5)
                _, version = worker.publish_model_version(
                    db, job, project, dataset,
                    SimpleNamespace(model=None, input_channels=3, input_height=32, input_width=32),
                    SimpleNamespace(class_names=["blue", "red"]),
                    SimpleNamespace(best_epoch=1, best_val_accuracy=75, best_val_loss=0.3),
                )
                return version.version

        # Separate worker processes do not share EXPORT_LOCK. Disable only that
        # lock to verify PostgreSQL alone prevents duplicate version allocation.
        with patch.object(worker, "EXPORT_LOCK", nullcontext()), patch.object(worker, "export_trained_model", fake_export), ThreadPoolExecutor(2) as pool:
            self.assertEqual(sorted(pool.map(publish, [1, 2])), [1, 2])
        with self.sessions() as db:
            db.query(ModelVersion).delete(); db.commit()
            self.assertEqual(worker.get_next_version(db, 1), 3)

    def test_job_deletion_excludes_concurrent_worker_claims(self):
        from library_training import delete_job
        self.add_jobs(1)
        deleting = Event(); release = Event()

        def remove():
            with self.sessions() as db:
                commit = db.commit
                def hold_commit():
                    db.flush()
                    deleting.set()
                    if not release.wait(timeout=10):
                        raise TimeoutError("Deletion was not released.")
                    commit()
                with patch.object(db, "commit", hold_commit):
                    return delete_job(1, SimpleNamespace(id=1), db)

        with ThreadPoolExecutor(1) as pool:
            future = pool.submit(remove)
            try:
                self.assertTrue(deleting.wait(timeout=5))
                self.assertIsNone(worker.claim_queued_job(1))
            finally:
                release.set()
            self.assertTrue(future.result(timeout=5)["success"])
        with self.sessions() as db:
            self.assertIsNone(db.get(TrainingJob, 1))

    def test_queued_job_trains_submission_snapshot_after_builder_changes(self):
        self.add_jobs(1)
        with self.sessions() as db:
            project = db.get(Project, 1)
            snapshot = project.architecture_json
            job = db.get(TrainingJob, 1)
            job.architecture_json = snapshot
            job.project_version = 3
            job.model_name = "Original model"
            job.dataset_name = "Dataset at submission"
            db.get(Dataset, 1).name = "Renamed dataset"
            project.architecture_json = "{}"  # Must never be used by this job.
            project.version = 4
            project.model_name = "New design"
            db.commit()
        self.assertTrue(worker.process_training_job(1))
        with self.sessions() as db:
            self.assertEqual(db.get(TrainingJob, 1).status, "completed")
            model = db.query(ModelVersion).one()
            self.assertEqual(model.project_version, 3)
            self.assertEqual(model.name, "Original model")
            self.assertEqual(model.dataset_name, "Dataset at submission")
            self.assertEqual(model.architecture_json, snapshot)
            metadata = json.loads((Path(model.pt_path).parent / "metadata.json").read_text())
            self.assertEqual(metadata["project_version"], 3)
            self.assertEqual(metadata["model_name"], "Original model")

    def test_accepted_community_job_keeps_snapshot_and_publishes_private_weights_for_submitter(self):
        self.add_jobs(2)
        with self.sessions() as db:
            project = db.get(Project, 1)
            for job_id in [1, 2]:
                job = db.get(TrainingJob, job_id)
                job.owner_id = 2
                job.architecture_json = project.architecture_json
                job.project_version = 7
                job.model_name = "alice/Shared design"
            # Job 1 was admitted with verified sharing; a legacy forged job is not.
            job = db.get(TrainingJob, 1)
            job.source_project_owner_id = 1
            job.source_dataset_owner_id = 1
            project.visibility = "private"  # Revocation affects future submissions only.
            db.commit()
        self.assertTrue(worker.process_training_job(1))
        self.assertTrue(worker.process_training_job(2))
        with self.sessions() as db:
            self.assertEqual(db.get(TrainingJob, 1).status, "completed")
            self.assertEqual(db.get(TrainingJob, 2).status, "failed")
            weight = db.query(ModelVersion).one()
            self.assertEqual((weight.owner_id, weight.project_version, weight.visibility), (2, 7, "private"))
            self.assertIn("user_2", weight.pt_path)
            self.assertTrue(Path(weight.pt_path).is_file())


if __name__ == "__main__":
    unittest.main()
