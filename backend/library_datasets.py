"""Dataset community: no filesystem scanning during list/detail requests."""
import hashlib
import json
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Literal
from zipfile import ZIP_STORED, ZipFile

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask

from access import current_user
from database import get_db
from dataset_details import cached_counts
from dataset_service import get_dataset_folder
from models import Dataset, TrainingJob, User, UserSession

router = APIRouter()


class VisibilityUpdate(BaseModel):
    visibility: Literal["private", "public"]


def dataset_summary(item, username, own=False):
    return {"id": item.id, "owner_id": item.owner_id, "owner_username": username,
            "name": item.name, "display_name": f"{username}/{item.name}", "description": item.description,
            "visibility": item.visibility, "status": item.status, "source_type": item.source_type,
            "split_type": item.split_type, "image_count": item.image_count, "class_count": item.class_count,
            "supported": item.supported, "size_bytes": item.size_bytes, "is_owner": own,
            "created_at": item.created_at, "unsupported_reason": item.unsupported_reason,
            "error_message": item.error_message if own else None}


def visible_dataset(db, dataset_id, user, write=False):
    item = db.get(Dataset, dataset_id)
    if item is None or (item.owner_id != user.id and (write or item.visibility != "public")):
        raise HTTPException(404, "Dataset not found or access denied.")
    return item


@router.post("/logout")
def logout(request: Request, user=Depends(current_user), db: Session = Depends(get_db)):
    digest = hashlib.sha256(request.headers["authorization"][7:].encode()).hexdigest()
    db.query(UserSession).filter_by(token_hash=digest, user_id=user.id).delete()
    db.commit()
    return {"success": True}


@router.get("/library/datasets")
def list_datasets(scope: Literal["mine", "public"] = "mine", q: str = Query("", max_length=150),
                  page: int = Query(1, ge=1), page_size: int = Query(10, ge=1, le=10),
                  trainable: bool = False, user=Depends(current_user), db: Session = Depends(get_db)):
    query = db.query(Dataset, User.username).join(User, User.id == Dataset.owner_id)
    query = query.filter(Dataset.owner_id == user.id) if scope == "mine" else query.filter(
        Dataset.visibility == "public", Dataset.status.in_(["ready", "unsupported"]))
    if trainable:
        query = query.filter(Dataset.supported.is_(True), Dataset.status == "ready")
    if q.strip():
        query = query.filter(or_(Dataset.name.icontains(q.strip(), autoescape=True),
                                 Dataset.description.icontains(q.strip(), autoescape=True),
                                 User.username.icontains(q.strip(), autoescape=True)))
    total = query.count()
    rows = query.order_by(Dataset.created_at.desc(), Dataset.id.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"success": True, "total": total, "page": page, "page_size": page_size,
            "items": [dataset_summary(item, name, item.owner_id == user.id) for item, name in rows]}


@router.get("/library/datasets/{dataset_id}/details")
def details(dataset_id: int, user=Depends(current_user), db: Session = Depends(get_db)):
    item = visible_dataset(db, dataset_id, user)
    if item.status not in {"ready", "unsupported"}:
        raise HTTPException(409, "Dataset is not ready for class details.")
    counts = cached_counts(item.class_counts_json)
    if counts is None:
        raise HTTPException(409, "Legacy statistics not prepared. Ask the administrator to run python -m backfill_dataset_counts.")
    total = sum(row["image_count"] for row in counts)
    return {"success": True, "dataset_id": item.id, "classes": counts,
            "detected_class_count": len(counts), "classified_image_count": total,
            "unassigned_image_count": max(0, (item.image_count or 0) - total)}


@router.patch("/library/datasets/{dataset_id}/visibility")
def visibility(dataset_id: int, body: VisibilityUpdate, user=Depends(current_user), db: Session = Depends(get_db)):
    item = visible_dataset(db, dataset_id, user, write=True)
    if body.visibility == "public" and item.status not in {"ready", "unsupported"}:
        raise HTTPException(409, "Wait until dataset import finishes before sharing.")
    item.visibility = body.visibility
    db.commit()
    return {"success": True, "visibility": item.visibility}


@router.get("/library/datasets/{dataset_id}/download")
def download_dataset(dataset_id: int, user=Depends(current_user), db: Session = Depends(get_db)):
    item = visible_dataset(db, dataset_id, user)
    if item.status not in {"ready", "unsupported"}:
        raise HTTPException(409, "Dataset import has not completed.")
    root = get_dataset_folder(item.owner_id, item.id) / "files"
    if not root.is_dir() or root.resolve() != root.absolute():
        raise HTTPException(404, "Dataset files are unavailable.")
    with NamedTemporaryFile(prefix="dataset-download-", suffix=".zip", delete=False) as temporary:
        target = Path(temporary.name)
    try:
        with ZipFile(target, "w", compression=ZIP_STORED) as archive:
            for path in root.rglob("*"):
                if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
                    raise HTTPException(409, "Dataset contains an unsafe link.")
                if path.is_file():
                    archive.write(path, path.relative_to(root).as_posix())
        return FileResponse(target, filename=f"dataset-{item.id}.zip", media_type="application/zip",
                            headers={"Cache-Control": "private, no-store"},
                            background=BackgroundTask(target.unlink, missing_ok=True))
    except Exception:
        target.unlink(missing_ok=True)
        raise
