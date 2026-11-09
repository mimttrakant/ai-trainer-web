from __future__ import annotations

import argparse
import json
import os
import signal
import traceback
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from threading import Event, Lock, current_thread

import torch

from database import SessionLocal
from models import (
    Dataset,
    ModelVersion,
    Project,
    TrainingJob,
    TrainingMetric,
)

from training.dataset_loader import build_classification_dataloaders
from training.exporter import export_trained_model
from training.model_builder import build_classification_model
from training.trainer import EpochMetrics, train_classification_model


POLL_INTERVAL_SECONDS = 3
# Exporters use process-wide PyTorch tracing/compiler state. Keep exports serial
# while independent models are trained concurrently.
EXPORT_LOCK = Lock()


def get_next_version(
    db,
    project_id: int,
) -> int:
    latest = (
        db.query(ModelVersion)
        .filter(
            ModelVersion.project_id == project_id
        )
        .order_by(
            ModelVersion.version.desc()
        )
        .first()
    )

    reserved = db.query(Project.weight_version).filter(Project.id == project_id).scalar() or 0
    return max(reserved, latest.version if latest else 0) + 1


def resolve_dataset_path(
    dataset: Dataset,
) -> str:
    if not dataset.storage_path:
        raise ValueError(
            "Dataset has no storage_path."
        )

    path = Path(dataset.storage_path)

    # ถ้า DB เก็บเป็น Windows path หรือ relative path
    # ให้หา dataset จากโครงสร้าง storage มาตรฐาน
    if not str(path).startswith("/app/storage"):
        path = (
            Path("/app/storage")
            / "datasets"
            / f"user_{dataset.owner_id}"
            / f"dataset_{dataset.id}"
            / "files"
        )

    if not path.exists():
        fallback = (
            Path("/app/storage")
            / "datasets"
            / f"user_{dataset.owner_id}"
            / f"dataset_{dataset.id}"
            / "files"
        )

        if fallback.exists():
            path = fallback
        else:
            raise FileNotFoundError(
                f"Dataset folder not found: {path}"
            )

    return str(path)


def update_job_started(
    db,
    job: TrainingJob,
) -> None:
    job.status = "training"
    job.current_epoch = 0
    job.error_message = None

    db.commit()


def update_epoch(
    job_id: int,
    metrics: EpochMetrics,
) -> None:
    """
    อัปเดตค่าล่าสุดใน training_jobs
    และเก็บประวัติแต่ละ Epoch ใน training_metrics
    """

    db = SessionLocal()

    try:
        job = (
            db.query(TrainingJob)
            .filter(
                TrainingJob.id == job_id
            )
            .first()
        )

        if job is None:
            return

        # -----------------------------
        # อัปเดตค่าล่าสุดของ Job
        # -----------------------------

        job.current_epoch = metrics.epoch
        job.train_loss = metrics.train_loss
        job.val_loss = metrics.val_loss
        job.train_accuracy = metrics.train_accuracy
        job.val_accuracy = metrics.val_accuracy

        # -----------------------------
        # เก็บ History ของ Epoch
        # -----------------------------

        old_metric = (
            db.query(TrainingMetric)
            .filter(
                TrainingMetric.training_job_id == job_id,
                TrainingMetric.epoch == metrics.epoch,
            )
            .first()
        )

        if old_metric:
            old_metric.train_loss = metrics.train_loss
            old_metric.val_loss = metrics.val_loss
            old_metric.train_accuracy = metrics.train_accuracy
            old_metric.val_accuracy = metrics.val_accuracy

        else:
            history = TrainingMetric(
                training_job_id=job_id,
                epoch=metrics.epoch,
                train_loss=metrics.train_loss,
                val_loss=metrics.val_loss,
                train_accuracy=metrics.train_accuracy,
                val_accuracy=metrics.val_accuracy,
            )

            db.add(history)

        db.commit()

    finally:
        db.close()


def create_model_version(
    db,
    job: TrainingJob,
    project: Project,
    dataset: Dataset,
    version: int,
    paths: dict,
    class_names: list[str],
    best_accuracy: float,
    best_loss: float,
    best_epoch: int,
) -> ModelVersion:

    model_version = ModelVersion(
        owner_id=job.owner_id,
        project_id=job.project_id,
        dataset_id=job.dataset_id,
        dataset_name=job.dataset_name or dataset.name,
        training_job_id=job.id,

        name=(
            job.model_name or project.model_name or project.name
        ),

        description=(
            f"Trained from dataset: "
            f"{dataset.name}"
        ),

        version=version,
        project_version=job.project_version,

        pt_path=paths["pt_path"],
        checkpoint_path=(
            paths["checkpoint_path"]
        ),
        onnx_path=paths["onnx_path"],

        architecture_json=(
            project.architecture_json
        ),

        class_names_json=json.dumps(
            class_names,
            ensure_ascii=False,
        ),

        class_count=len(class_names),

        best_accuracy=best_accuracy,
        best_loss=best_loss,
        epoch=best_epoch,

        visibility="private",
        allow_download=True,
    )

    db.add(model_version)
    db.commit()
    db.refresh(model_version)

    return model_version


def process_training_job(
    job_id: int | None = None,
) -> bool:
    """Claim and train one queued job; return False when no work is available.

    Each invocation owns its SQLAlchemy sessions, model, optimizer and loaders.
    Passing an ID still performs the atomic claim, so an already-running or
    completed job cannot accidentally be trained twice.
    """
    job_id = claim_queued_job(job_id)
    if job_id is None:
        return False

    db = SessionLocal()

    try:
        job = (
            db.query(TrainingJob)
            .filter(
                TrainingJob.id == job_id
            )
            .first()
        )

        if job is None:
            raise ValueError(
                f"Training job {job_id} not found."
            )

        print(
            f"[Worker:{current_thread().name}] Processing job {job.id}"
        )

        # ---------------------------------
        # Version แรกทำ New Training ก่อน
        # ---------------------------------

        if job.mode != "new":
            raise ValueError(
                "This worker currently supports "
                "mode='new' only. "
                "Continue/Fine-tune will be added next."
            )

        project = (
            db.query(Project)
            .filter(
                Project.id == job.project_id
            )
            .first()
        )

        if project is None:
            raise ValueError(
                f"Project {job.project_id} "
                "not found."
            )

        dataset = (
            db.query(Dataset)
            .filter(
                Dataset.id == job.dataset_id
            )
            .first()
        )

        if dataset is None:
            raise ValueError(
                f"Dataset {job.dataset_id} "
                "not found."
            )

        if dataset.owner_id != job.owner_id and job.source_dataset_owner_id != dataset.owner_id:
            raise ValueError(
                "Dataset does not belong "
                "to this user."
            )

        if project.owner_id != job.owner_id and (job.source_project_owner_id != project.owner_id or not job.architecture_json):
            raise ValueError(
                "Project does not belong "
                "to this user."
            )

        if not (job.architecture_json or project.architecture_json):
            raise ValueError(
                "Project has no architecture."
            )

        # Retain a snapshot of this job's configuration, but return the database
        # connection to the pool during training. Epoch callbacks use short,
        # independent sessions, so many jobs cannot exhaust the pool by holding
        # idle connections for the entire training run.
        db.expunge_all()
        db.rollback()

        # New jobs carry an immutable snapshot from submission time. Legacy
        # jobs without one retain the old behavior, with unknown source version.
        if job.architecture_json:
            project.architecture_json = job.architecture_json
        if job.model_name:
            project.model_name = job.model_name

        # ---------------------------------
        # Dataset
        # ---------------------------------

        dataset_path = resolve_dataset_path(
            dataset
        )

        print(
            f"[Worker] Dataset: {dataset_path}"
        )

        # เราต้องรู้จำนวน class ก่อน
        # จึงโหลดรอบแรกด้วย image_size ชั่วคราว
        initial_data = (
            build_classification_dataloaders(
                dataset_path=dataset_path,
                batch_size=job.batch_size,
                image_size=128,
            )
        )

        num_classes = len(
            initial_data.class_names
        )

        print(
            f"[Worker] Classes: "
            f"{initial_data.class_names}"
        )

        # ---------------------------------
        # Build Model
        # ---------------------------------

        built = build_classification_model(
            architecture_json=(
                project.architecture_json
            ),
            num_classes=num_classes,
        )

        print(
            f"[Worker] Input: "
            f"{built.input_channels} x "
            f"{built.input_height} x "
            f"{built.input_width}"
            f"{built}"
        )

        # ---------------------------------
        # โหลด Dataset ใหม่ตาม Input Model
        # ---------------------------------

        data = (
            build_classification_dataloaders(
                dataset_path=dataset_path,
                batch_size=job.batch_size,
                image_size=built.input_height,
            )
        )

        # ---------------------------------
        # Train
        # ---------------------------------

        result = train_classification_model(
            model=built.model,

            train_loader=data.train_loader,
            val_loader=data.val_loader,

            total_epochs=job.total_epochs,

            learning_rate=(
                job.learning_rate
            ),

            optimizer_name=(
                job.optimizer
            ),

            epoch_callback=lambda metrics: (
                update_epoch(
                    job.id,
                    metrics,
                )
            ),
        )

        # ---------------------------------
        # Model Version
        # ---------------------------------

        paths, model_version = publish_model_version(
            db, job, project, dataset, built, data, result,
        )

        # ---------------------------------
        # Complete
        # ---------------------------------

        job.status = "completed"
        job.current_epoch = (
            job.total_epochs
        )

        job.train_loss = (
            result.final_train_loss
        )

        job.train_accuracy = (
            result.final_train_accuracy
        )

        job.val_loss = (
            result.final_val_loss
        )

        job.val_accuracy = (
            result.final_val_accuracy
        )

        job.finished_at = datetime.utcnow()

        db.add(job)
        db.commit()

        print(
            f"[Worker] Job {job.id} completed."
        )

        print(
            f"[Worker] ModelVersion ID: "
            f"{model_version.id}"
        )

        print(
            f"[Worker] PT: "
            f"{paths['pt_path']}"
        )

        print(
            f"[Worker] ONNX: "
            f"{paths['onnx_path']}"
        )

    except Exception as exc:
        db.rollback()

        print(
            f"[Worker] Job {job_id} failed:"
        )

        print(exc)

        traceback.print_exc()

        # ใช้ session ใหม่ เผื่อ transaction เดิมเสีย
        error_db = SessionLocal()

        try:
            failed_job = (
                error_db.query(TrainingJob)
                .filter(
                    TrainingJob.id == job_id
                )
                .first()
            )

            if failed_job is not None:
                failed_job.status = "failed"
                failed_job.error_message = str(exc)
                failed_job.finished_at = (
                    datetime.utcnow()
                )

                error_db.commit()

        finally:
            error_db.close()

    finally:
        db.close()

    return True


def publish_model_version(db, job, project, dataset, built, data, result):
    with EXPORT_LOCK:
        # Serialize version allocation for this project across worker processes
        # as well as threads. Hold the row lock until create_model_version commits.
        # Use a scalar query to preserve the architecture snapshot used to train.
        existing_project = (
            db.query(Project.id)
            .filter(Project.id == project.id)
            .with_for_update()
            .first()
        )
        if existing_project is None:
            raise ValueError(f"Project {project.id} was deleted during training.")

        version = get_next_version(db, project.id)
        db.query(Project).filter(Project.id == project.id).update(
            {Project.weight_version: version}, synchronize_session=False,
        )
        print(f"[Worker] Job {job.id}: exporting model version {version}")
        paths = export_trained_model(
            project_version=job.project_version,
            model_name=job.model_name or project.model_name or project.name,
            model=built.model,
            optimizer=None,
            owner_id=job.owner_id,
            project_id=job.project_id,
            training_job_id=job.id,
            version=version,
            epoch=result.best_epoch,
            architecture_json=project.architecture_json,
            class_names=data.class_names,
            best_val_accuracy=result.best_val_accuracy,
            best_val_loss=result.best_val_loss,
            input_channels=built.input_channels,
            input_height=built.input_height,
            input_width=built.input_width,
        )
        model_version = create_model_version(
            db=db,
            job=job,
            project=project,
            dataset=dataset,
            version=version,
            paths=paths,
            class_names=data.class_names,
            best_accuracy=result.best_val_accuracy,
            best_loss=result.best_val_loss,
            best_epoch=result.best_epoch,
        )
        return paths, model_version


def claim_queued_job(job_id: int | None = None) -> int | None:
    """Atomically reserve a queued job before any training starts (PostgreSQL)."""
    with SessionLocal() as db:
        query = (
            db.query(TrainingJob)
            .filter(TrainingJob.status == "queued")
            .order_by(TrainingJob.created_at.asc(), TrainingJob.id.asc())
            .with_for_update(skip_locked=True)
        )
        if job_id is not None:
            query = query.filter(TrainingJob.id == job_id)
        job = query.first()
        if job is None:
            return None
        claimed_id = job.id
        update_job_started(db, job)
        return claimed_id


def consume_jobs(stop_event: Event) -> None:
    while not stop_event.is_set():
        try:
            if not process_training_job():
                stop_event.wait(POLL_INTERVAL_SECONDS)
        except Exception:
            # A failed claim/connection must not terminate a consumer thread.
            traceback.print_exc()
            stop_event.wait(POLL_INTERVAL_SECONDS)


def positive_int(value) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        raise argparse.ArgumentTypeError("must be a positive integer") from None
    if parsed < 1 or str(parsed) != str(value):
        raise argparse.ArgumentTypeError("must be a positive integer")
    return parsed


def run_worker(
    max_threads: int = 1,
    torch_threads: int | None = None,
    stop_event: Event | None = None,
) -> None:
    max_threads = positive_int(max_threads)
    if torch_threads is None:
        torch_threads = max(1, torch.get_num_threads() // max_threads)
    torch_threads = positive_int(torch_threads)
    # Configure native CPU parallelism once, before any model is built.
    torch.set_num_threads(torch_threads)
    stop_event = stop_event if stop_event is not None else Event()
    print(
        f"[Worker] Started: {max_threads} concurrent job(s), "
        f"{torch_threads} PyTorch CPU thread(s) per operation, "
        f"poll interval {POLL_INTERVAL_SECONDS}s."
    )
    with ThreadPoolExecutor(
        max_workers=max_threads,
        thread_name_prefix="training",
    ) as executor:
        futures = [executor.submit(consume_jobs, stop_event) for _ in range(max_threads)]
        try:
            while not stop_event.wait(0.5):
                for future in futures:
                    if future.done():
                        future.result()
                        raise RuntimeError("A training consumer stopped unexpectedly.")
        except KeyboardInterrupt:
            print("\n[Worker] Stop requested; finishing active jobs before exit.")
        finally:
            # Stop claiming work; executor waits for active jobs to save results.
            stop_event.set()
    print("[Worker] Stopped.")


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="Train queued jobs with a configurable thread pool.")
    parser.add_argument(
        "--threads", type=positive_int,
        default=os.getenv("TRAINING_WORKER_THREADS", "1"),
        help="maximum concurrent jobs (env TRAINING_WORKER_THREADS; default: 1)",
    )
    parser.add_argument(
        "--torch-threads", type=positive_int,
        default=os.getenv("TRAINING_TORCH_THREADS"),
        help="PyTorch CPU threads per operation (env TRAINING_TORCH_THREADS; default: automatic)",
    )
    return parser.parse_args(argv)


if __name__ == "__main__":
    args = parse_args()
    shutdown = Event()

    def request_shutdown(signum, frame):
        print(f"[Worker] Signal {signum}: finishing active jobs before exit.")
        shutdown.set()

    signal.signal(signal.SIGINT, request_shutdown)
    signal.signal(signal.SIGTERM, request_shutdown)
    run_worker(args.threads, args.torch_threads, shutdown)
