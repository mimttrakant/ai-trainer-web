"""Verified sessions and protection for the legacy owner_id-based routes."""
import hashlib
import secrets
from datetime import datetime, timedelta

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session
from database import get_db
from models import Dataset, ModelVersion, Project, TrainingJob, User, UserSession


def issue_session(db, user_id):
    token = secrets.token_urlsafe(32)
    db.query(UserSession).filter(UserSession.expires_at < datetime.utcnow()).delete()
    db.add(UserSession(token_hash=hashlib.sha256(token.encode()).hexdigest(), user_id=user_id,
                       expires_at=datetime.utcnow() + timedelta(days=7)))
    db.commit()
    return token


def current_user(request: Request, db: Session = Depends(get_db)):
    authorization = request.headers.get("authorization", "")
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Please log in again to access your private library.")
    digest = hashlib.sha256(authorization[7:].encode()).hexdigest()
    session = db.get(UserSession, digest)
    if session is None or session.expires_at <= datetime.utcnow():
        raise HTTPException(401, "Session expired. Please log in again.")
    user = db.get(User, session.user_id)
    if user is None:
        raise HTTPException(401, "Account no longer exists.")
    return user


async def protect_legacy(request: Request, db: Session = Depends(get_db)):
    path = request.url.path
    if path in {"/", "/login", "/register"}:
        return
    user = current_user(request, db)
    if path.startswith("/library/") or path == "/logout":
        return  # Library routes enforce visibility/ownership using the session.
    if path.startswith("/admin/"):
        if user.role != "admin":
            raise HTTPException(403, "Administrator access required.")
        return
    for value in (request.path_params.get("owner_id"), request.query_params.get("owner_id")):
        if value is not None and str(value) != str(user.id):
            raise HTTPException(403, "Owner does not match the signed-in account.")
    if request.method in {"POST", "PUT", "PATCH"}:
        content_type = request.headers.get("content-type", "")
        payload = await request.json() if "application/json" in content_type else (
            await request.form() if "multipart/form-data" in content_type else {})
        if isinstance(payload, dict) or hasattr(payload, "get"):
            owner = payload.get("owner_id")
            if owner is not None and str(owner) != str(user.id):
                raise HTTPException(403, "Owner does not match the signed-in account.")
    for parameter, model in (("project_id", Project), ("dataset_id", Dataset),
                             ("job_id", TrainingJob), ("model_id", ModelVersion)):
        value = request.path_params.get(parameter)
        if value is not None:
            try:
                record = db.get(model, int(value))
            except (TypeError, ValueError):
                raise HTTPException(422, "Invalid resource ID.")
            if record is None or record.owner_id != user.id:
                raise HTTPException(404, "Resource not found or access denied.")
            if isinstance(record, Project) and record.deleted_at is not None:
                raise HTTPException(404, "Model was deleted.")
