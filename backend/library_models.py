"""Shared architecture catalogue. Public designs are read-only; cloning is explicit."""
from datetime import datetime
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session
from access import current_user
from database import get_db
from library_datasets import VisibilityUpdate
from models import Project, ProjectVersion, User
from project_versioning import validate_architecture

router = APIRouter()


class NewModel(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    description: str = Field(default="", max_length=1000)


class CloneModel(BaseModel):
    version: int = Field(gt=0)
    name: str | None = Field(default=None, min_length=1, max_length=150)


def visible_model(db, model_id, user, write=False, lock=False):
    query = db.query(Project).filter_by(id=model_id, deleted_at=None)
    if lock:
        query = query.with_for_update().populate_existing()
    item = query.first()
    if item is None or (item.owner_id != user.id and (write or item.visibility != "public")):
        raise HTTPException(404, "Model not found or access denied.")
    return item


def model_summary(item, username, user_id):
    name = item.model_name or item.name
    return {"id": item.id, "name": name, "display_name": f"{username}/{name}",
            "description": item.description, "owner_username": username, "owner_id": item.owner_id,
            "visibility": item.visibility, "version": item.version, "is_owner": item.owner_id == user_id}


@router.get("/library/models")
def list_models(scope: Literal["mine", "public"] = "mine", q: str = Query("", max_length=150),
                page: int = Query(1, ge=1), page_size: int = Query(10, ge=1, le=10),
                trainable: bool = False, user=Depends(current_user), db: Session = Depends(get_db)):
    query = db.query(Project, User.username).join(User, User.id == Project.owner_id).filter(Project.deleted_at.is_(None))
    query = query.filter(Project.owner_id == user.id) if scope == "mine" else query.filter(Project.visibility == "public", Project.version > 0)
    if trainable:
        query = query.filter(Project.version > 0)
    if q.strip():
        query = query.filter(or_(Project.model_name.icontains(q.strip(), autoescape=True),
                                 Project.description.icontains(q.strip(), autoescape=True), User.username.icontains(q.strip(), autoescape=True)))
    total = query.count()
    rows = query.order_by(Project.id.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"success": True, "total": total, "items": [model_summary(row, name, user.id) for row, name in rows]}


@router.post("/library/models")
def create_model(body: NewModel, user=Depends(current_user), db: Session = Depends(get_db)):
    if not body.name.strip():
        raise HTTPException(422, "Model name cannot be blank.")
    item = Project(owner_id=user.id, name=body.name.strip(), model_name=body.name.strip(),
                   description=body.description.strip(), version=0, architecture_json="{}", visibility="private")
    db.add(item); db.commit(); db.refresh(item)
    return {"success": True, "model": model_summary(item, user.username, user.id)}


@router.get("/library/models/{model_id}/versions")
def versions(model_id: int, user=Depends(current_user), db: Session = Depends(get_db)):
    item = visible_model(db, model_id, user)
    rows = db.query(ProjectVersion).filter_by(project_id=item.id).order_by(ProjectVersion.version.desc()).all()
    return {"success": True, "versions": [{"id": row.id, "version": row.version, "model_name": row.model_name,
                                           "created_at": row.created_at} for row in rows]}


@router.post("/library/models/{model_id}/clone")
def clone_model(model_id: int, body: CloneModel, user=Depends(current_user), db: Session = Depends(get_db)):
    original = visible_model(db, model_id, user, lock=True)
    source = db.query(ProjectVersion).filter_by(project_id=model_id, version=body.version).first()
    if source is None:
        raise HTTPException(404, "Selected version does not exist.")
    validate_architecture(source.architecture_json)
    name = (body.name if body.name is not None else source.model_name).strip()
    if not name:
        raise HTTPException(422, "Model name cannot be blank.")
    copy = Project(owner_id=user.id, name=name, model_name=name, description=original.description,
                   version=1, architecture_json=source.architecture_json, visibility="private")
    db.add(copy); db.flush()
    db.add(ProjectVersion(project_id=copy.id, owner_id=user.id, version=1, model_name=name, architecture_json=source.architecture_json))
    db.commit(); db.refresh(copy)
    return {"success": True, "model": model_summary(copy, user.username, user.id)}


@router.patch("/library/models/{model_id}/visibility")
def visibility(model_id: int, body: VisibilityUpdate, user=Depends(current_user), db: Session = Depends(get_db)):
    item = visible_model(db, model_id, user, write=True, lock=True)
    if body.visibility == "public" and item.version < 1:
        raise HTTPException(409, "Save at least one Builder version before sharing.")
    item.visibility = body.visibility
    db.commit()
    return {"success": True, "visibility": item.visibility}


@router.delete("/library/models/{model_id}")
def delete_model(model_id: int, user=Depends(current_user), db: Session = Depends(get_db)):
    item = visible_model(db, model_id, user, write=True, lock=True)
    item.deleted_at = datetime.utcnow(); item.visibility = "private"
    db.commit()
    return {"success": True}
