from __future__ import annotations

import json
import time
import traceback
from datetime import datetime
from pathlib import Path

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

    if latest is None:
        return 1

    return latest.version + 1


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
        training_job_id=job.id,

        name=(
            f"{project.name} v{version}"
        ),

        description=(
            f"Trained from dataset: "
            f"{dataset.name}"
        ),

        version=version,

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
    job_id: int,
) -> None:
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
            f"[Worker] Processing job {job.id}"
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

        if dataset.owner_id != job.owner_id:
            raise ValueError(
                "Dataset does not belong "
                "to this user."
            )

        if project.owner_id != job.owner_id:
            raise ValueError(
                "Project does not belong "
                "to this user."
            )

        if not project.architecture_json:
            raise ValueError(
                "Project has no architecture."
            )

        update_job_started(
            db,
            job,
        )

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

        version = get_next_version(
            db,
            project_id=project.id,
        )

        print(
            f"[Worker] Exporting "
            f"model version {version}"
        )

        paths = export_trained_model(
            model=built.model,

            # ตอนนี้ trainer ยังไม่คืน optimizer
            # รอบ Continue Training
            # เราจะปรับส่วนนี้อีกครั้ง
            optimizer=None,

            owner_id=job.owner_id,
            project_id=job.project_id,
            training_job_id=job.id,

            version=version,

            epoch=result.best_epoch,

            architecture_json=(
                project.architecture_json
            ),

            class_names=(
                data.class_names
            ),

            best_val_accuracy=(
                result.best_val_accuracy
            ),

            best_val_loss=(
                result.best_val_loss
            ),

            input_channels=(
                built.input_channels
            ),

            input_height=(
                built.input_height
            ),

            input_width=(
                built.input_width
            ),
        )

        model_version = create_model_version(
            db=db,
            job=job,
            project=project,
            dataset=dataset,
            version=version,
            paths=paths,
            class_names=data.class_names,
            best_accuracy=(
                result.best_val_accuracy
            ),
            best_loss=(
                result.best_val_loss
            ),
            best_epoch=(
                result.best_epoch
            ),
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


def get_next_queued_job_id() -> int | None:
    db = SessionLocal()

    try:
        job = (
            db.query(TrainingJob)
            .filter(
                TrainingJob.status == "queued"
            )
            .order_by(
                TrainingJob.created_at.asc()
            )
            .first()
        )

        if job is None:
            return None

        return job.id

    finally:
        db.close()


def run_worker() -> None:
    print(
        "[Worker] Training worker started."
    )

    print(
        f"[Worker] Poll interval: "
        f"{POLL_INTERVAL_SECONDS}s"
    )

    while True:
        try:
            job_id = (
                get_next_queued_job_id()
            )

            if job_id is None:
                time.sleep(
                    POLL_INTERVAL_SECONDS
                )

                continue

            process_training_job(
                job_id
            )

        except KeyboardInterrupt:
            print(
                "\n[Worker] Stopped."
            )

            break

        except Exception:
            traceback.print_exc()

            time.sleep(
                POLL_INTERVAL_SECONDS
            )


if __name__ == "__main__":
    run_worker()
