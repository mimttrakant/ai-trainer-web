import math
import time
from datetime import datetime

from database import SessionLocal
from models import TrainingJob


POLL_INTERVAL_SECONDS = 3
EPOCH_DELAY_SECONDS = 2


def get_next_queued_job(db):
    """ค้นหางาน Train ที่กำลังรออยู่ตัวแรก"""
    return (
        db.query(TrainingJob)
        .filter(TrainingJob.status == "queued")
        .order_by(TrainingJob.created_at.asc())
        .first()
    )


def calculate_mock_metrics(current_epoch: int, total_epochs: int):
    """
    สร้างค่า Loss และ Accuracy จำลอง
    ตอนนี้ยังไม่ใช่ผลจาก PyTorch จริง
    """
    progress = current_epoch / max(total_epochs, 1)

    train_loss = max(
        0.05,
        1.2 * math.exp(-3 * progress),
    )
    val_loss = max(
        0.08,
        1.35 * math.exp(-2.7 * progress),
    )

    train_accuracy = min(
        99.0,
        45.0 + (progress * 50.0),
    )
    val_accuracy = min(
        97.0,
        40.0 + (progress * 50.0),
    )

    return {
        "train_loss": round(train_loss, 4),
        "val_loss": round(val_loss, 4),
        "train_accuracy": round(train_accuracy, 2),
        "val_accuracy": round(val_accuracy, 2),
    }


def process_training_job(job_id: int):
    db = SessionLocal()

    try:
        job = (
            db.query(TrainingJob)
            .filter(TrainingJob.id == job_id)
            .first()
        )

        if not job:
            print(f"[Worker] Job {job_id} not found")
            return

        job.status = "training"
        job.error_message = None
        db.commit()

        print(
            f"[Worker] Started Job {job.id} "
            f"({job.total_epochs} epochs)"
        )

        for epoch in range(1, job.total_epochs + 1):
            metrics = calculate_mock_metrics(
                epoch,
                job.total_epochs,
            )

            job.current_epoch = epoch
            job.train_loss = metrics["train_loss"]
            job.val_loss = metrics["val_loss"]
            job.train_accuracy = metrics["train_accuracy"]
            job.val_accuracy = metrics["val_accuracy"]

            db.commit()

            print(
                f"[Worker] Job {job.id} | "
                f"Epoch {epoch}/{job.total_epochs} | "
                f"Train Loss: {job.train_loss} | "
                f"Val Accuracy: {job.val_accuracy}%"
            )

            time.sleep(EPOCH_DELAY_SECONDS)

        job.status = "completed"
        job.finished_at = datetime.utcnow()
        db.commit()

        print(f"[Worker] Job {job.id} completed")

    except Exception as error:
        db.rollback()

        job = (
            db.query(TrainingJob)
            .filter(TrainingJob.id == job_id)
            .first()
        )

        if job:
            job.status = "failed"
            job.error_message = str(error)
            job.finished_at = datetime.utcnow()
            db.commit()

        print(f"[Worker] Job {job_id} failed: {error}")

    finally:
        db.close()


def run_worker():
    print("[Worker] Training worker started")
    print("[Worker] Waiting for queued jobs...")

    while True:
        db = SessionLocal()

        try:
            job = get_next_queued_job(db)

            if job:
                job_id = job.id
                db.close()

                process_training_job(job_id)
            else:
                db.close()
                time.sleep(POLL_INTERVAL_SECONDS)

        except KeyboardInterrupt:
            db.close()
            print("\n[Worker] Worker stopped")
            break

        except Exception as error:
            db.close()
            print(f"[Worker] Database error: {error}")
            time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    run_worker()