"""Train immutable own/public designs; weights belong to the submitting user."""
from datetime import datetime
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from access import current_user
from database import get_db
from library_datasets import VisibilityUpdate, visible_dataset
from library_models import visible_model
import model_routes
from models import Dataset, ModelVersion, ProjectVersion, TrainingJob, TrainingMetric, User
from project_versioning import validate_architecture

router = APIRouter()


class StartTraining(BaseModel):
    model_id: int = Field(gt=0)
    version: int = Field(gt=0)
    dataset_id: int = Field(gt=0)
    total_epochs: int = Field(default=10, ge=1, le=100000)
    batch_size: int = Field(default=32, ge=1, le=4096)
    learning_rate: float = Field(default=0.001, gt=0, allow_inf_nan=False)
    optimizer: Literal["adam", "adamw", "sgd"] = "adam"


def job_summary(job):
    return {key: getattr(job, key) for key in (
        "id", "owner_id", "project_id", "project_version", "model_name", "dataset_id", "dataset_name", "status",
        "current_epoch", "total_epochs", "batch_size", "learning_rate", "optimizer", "created_at", "finished_at",
        "train_loss", "val_loss", "train_accuracy", "val_accuracy", "error_message")}


def weight_summary(weight, username, user_id):
    return {"id": weight.id, "name": weight.name, "display_name": f"{username}/{weight.name.rsplit('/', 1)[-1]}",
            "owner_username": username, "is_owner": weight.owner_id == user_id, "visibility": weight.visibility,
            "training_job_id": weight.training_job_id, "project_version": weight.project_version,
            "dataset_name": weight.dataset_name, "version": weight.version, "best_accuracy": weight.best_accuracy,
            "best_loss": weight.best_loss, "epoch": weight.epoch, "has_pt": bool(weight.pt_path),
            "has_onnx": bool(weight.onnx_path), "allow_download": weight.allow_download, "created_at": weight.created_at}


def visible_weight(db, weight_id, user, write=False):
    weight = db.query(ModelVersion).filter_by(id=weight_id, deleted_at=None).first()
    if weight is None or (weight.owner_id != user.id and (write or weight.visibility != "public")):
        raise HTTPException(404, "Weight not found or access denied.")
    job = db.get(TrainingJob, weight.training_job_id)
    if job is None or job.status != "completed":
        raise HTTPException(409, "Training has not completed.")
    return weight


@router.post("/library/jobs")
def start_training(body: StartTraining, user=Depends(current_user), db: Session = Depends(get_db)):
    project = visible_model(db, body.model_id, user, lock=True)
    # Lock both source records until the admission snapshot is committed.
    dataset = db.query(Dataset).filter_by(id=body.dataset_id).with_for_update().populate_existing().first()
    dataset = visible_dataset(db, body.dataset_id, user)
    if not dataset.supported or dataset.status != "ready":
        raise HTTPException(409, "Choose a ready, supported dataset.")
    revision = db.query(ProjectVersion).filter_by(project_id=project.id, version=body.version).first()
    if revision is None:
        raise HTTPException(404, "Selected model version is unavailable. Refresh versions.")
    validate_architecture(revision.architecture_json)
    model_owner = db.get(User, project.owner_id)
    dataset_owner = db.get(User, dataset.owner_id)
    if not model_owner or not dataset_owner:
        raise HTTPException(404, "Source owner is unavailable.")
    job = TrainingJob(owner_id=user.id, project_id=project.id, dataset_id=dataset.id,
                      project_version=revision.version, architecture_json=revision.architecture_json,
                      model_name=f"{model_owner.username}/{revision.model_name}",
                      dataset_name=f"{dataset_owner.username}/{dataset.name}",
                      source_project_owner_id=project.owner_id, source_dataset_owner_id=dataset.owner_id,
                      mode="new", status="queued", total_epochs=body.total_epochs, batch_size=body.batch_size,
                      learning_rate=body.learning_rate, optimizer=body.optimizer)
    db.add(job); db.commit(); db.refresh(job)
    return {"success": True, "job": job_summary(job)}


@router.get("/library/jobs")
def list_jobs(scope: str = "mine", q: str = Query("", max_length=150), page: int = Query(1, ge=1),
              page_size: int = Query(10, ge=1, le=10), user=Depends(current_user), db: Session = Depends(get_db)):
    query = db.query(TrainingJob).filter_by(owner_id=user.id)
    if q.strip():
        number = q.strip().lower().removeprefix("job").strip().removeprefix("#").strip()
        conditions = [TrainingJob.model_name.icontains(q.strip(), autoescape=True),
                      TrainingJob.dataset_name.icontains(q.strip(), autoescape=True),
                      TrainingJob.status.icontains(q.strip(), autoescape=True)]
        if number.isdecimal() and len(number) < 10:
            conditions.append(TrainingJob.id == int(number))
        query = query.filter(or_(*conditions))
    total = query.count()
    jobs = query.order_by(TrainingJob.id.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"success": True, "total": total, "items": [job_summary(job) for job in jobs]}


@router.get("/library/jobs/{job_id}")
def job_details(job_id: int, user=Depends(current_user), db: Session = Depends(get_db)):
    job = db.get(TrainingJob, job_id)
    public = db.query(ModelVersion.id).filter_by(training_job_id=job_id, visibility="public", deleted_at=None).first()
    if job is None or (job.owner_id != user.id and (job.status != "completed" or not public)):
        raise HTTPException(404, "Training result is private or unavailable.")
    metrics = db.query(TrainingMetric).filter_by(training_job_id=job_id).order_by(TrainingMetric.epoch, TrainingMetric.id).all()
    weights = db.query(ModelVersion, User.username).join(User, User.id == ModelVersion.owner_id).filter(
        ModelVersion.training_job_id == job_id, ModelVersion.deleted_at.is_(None))
    if job.owner_id != user.id:
        weights = weights.filter(ModelVersion.visibility == "public")
    return {"success": True, "job": job_summary(job), "metrics": [
        {key: getattr(row, key) for key in ("epoch", "train_loss", "val_loss", "train_accuracy", "val_accuracy")} for row in metrics],
        "weights": [weight_summary(row, name, user.id) for row, name in weights] if job.status == "completed" else []}


@router.get("/library/weights")
def list_weights(scope: Literal["mine", "public"] = "mine", q: str = Query("", max_length=150),
                 page: int = Query(1, ge=1), page_size: int = Query(10, ge=1, le=10),
                 user=Depends(current_user), db: Session = Depends(get_db)):
    query = db.query(ModelVersion, User.username).join(User, User.id == ModelVersion.owner_id).join(
        TrainingJob, TrainingJob.id == ModelVersion.training_job_id).filter(
        ModelVersion.deleted_at.is_(None), TrainingJob.status == "completed")
    query = query.filter(ModelVersion.owner_id == user.id) if scope == "mine" else query.filter(ModelVersion.visibility == "public")
    if q.strip():
        query = query.filter(or_(ModelVersion.name.icontains(q.strip(), autoescape=True),
                                 ModelVersion.dataset_name.icontains(q.strip(), autoescape=True),
                                 User.username.icontains(q.strip(), autoescape=True)))
    total = query.count()
    rows = query.order_by(ModelVersion.id.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"success": True, "total": total, "items": [weight_summary(row, name, user.id) for row, name in rows]}


@router.patch("/library/weights/{weight_id}/visibility")
def visibility(weight_id: int, body: VisibilityUpdate, user=Depends(current_user), db: Session = Depends(get_db)):
    weight = visible_weight(db, weight_id, user, write=True)
    weight.visibility = body.visibility
    db.commit()
    return {"success": True}


@router.delete("/library/weights/{weight_id}")
def delete_weight(weight_id: int, user=Depends(current_user), db: Session = Depends(get_db)):
    weight = visible_weight(db, weight_id, user, write=True)
    weight.deleted_at = datetime.utcnow(); weight.visibility = "private"
    db.commit()
    return {"success": True, "message": "Weight removed. Job history and recoverable files are retained."}


@router.get("/library/weights/{weight_id}/download/{file_format}")
def download_weight(weight_id: int, file_format: Literal["pt", "onnx"], user=Depends(current_user), db: Session = Depends(get_db)):
    weight = visible_weight(db, weight_id, user)
    if weight.allow_download is False:
        raise HTTPException(403, "Downloads are disabled for this weight.")
    stored_path = weight.pt_path if file_format == "pt" else weight.onnx_path
    if not stored_path:
        raise HTTPException(404, "This weight format is unavailable.")
    folder = model_routes.STORAGE_ROOT / "models" / f"user_{weight.owner_id}" / f"project_{weight.project_id}" / f"version_{weight.version}"
    path = model_routes.checked_file(stored_path, folder)
    filename = f"weight-{weight.id}-v{weight.version}"
    if file_format == "onnx":
        return model_routes.onnx_download(path, folder, filename)
    return FileResponse(path, filename=f"{filename}.pt", media_type="application/octet-stream", headers=model_routes.DOWNLOAD_HEADERS)
