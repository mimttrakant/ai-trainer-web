"""Immutable Builder saves and architecture snapshots at job submission."""

import json
from datetime import datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from database import get_db
from models import Project, ProjectEditorSession, ProjectVersion

router = APIRouter()


def migrate_project_versions(engine):
    # Additive and repeatable. Existing history is not attributed to a guessed
    # revision; only the current saved design becomes the initial baseline.
    statements = [
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS model_name VARCHAR",
        "ALTER TABLE training_jobs ADD COLUMN IF NOT EXISTS project_version INTEGER",
        "ALTER TABLE training_jobs ADD COLUMN IF NOT EXISTS model_name VARCHAR",
        "ALTER TABLE training_jobs ADD COLUMN IF NOT EXISTS architecture_json TEXT",
        "ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS project_version INTEGER",
        "ALTER TABLE training_jobs ADD COLUMN IF NOT EXISTS dataset_name VARCHAR",
        "ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS dataset_name VARCHAR",
        "UPDATE projects SET model_name = COALESCE(NULLIF(name, ''), 'Untitled model') WHERE model_name IS NULL",
        "UPDATE projects SET version = 1 WHERE version = 0 AND architecture_json IS NOT NULL AND TRIM(architecture_json) NOT IN ('', '{}')",
        """INSERT INTO project_versions (project_id, owner_id, version, model_name, architecture_json, created_at)
           SELECT id, owner_id, version, model_name, architecture_json, CURRENT_TIMESTAMP
           FROM projects WHERE version > 0
           ON CONFLICT (project_id, version) DO NOTHING""",
    ]
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def validate_architecture(raw):
    try:
        graph = json.loads(raw)
    except (ValueError, TypeError) as exc:
        raise HTTPException(422, "Architecture must be valid JSON.") from exc
    if not isinstance(graph, dict) or not isinstance(graph.get("nodes"), list) or not isinstance(graph.get("edges"), list):
        raise HTTPException(422, "Architecture must contain nodes and edges arrays.")
    if not 1 <= len(graph["nodes"]) <= 500 or len(graph["edges"]) > 2000:
        raise HTTPException(422, "Architecture must contain 1–500 nodes and at most 2000 edges.")
    ids = set()
    for node in graph["nodes"]:
        if not isinstance(node, dict) or not isinstance(node.get("id"), str) or not node["id"] or node["id"] in ids:
            raise HTTPException(422, "Every node must have a unique string ID.")
        if not isinstance(node.get("data"), dict) or not isinstance(node["data"].get("layerType"), str):
            raise HTTPException(422, "Every node must specify its layer type.")
        ids.add(node["id"])
    for edge in graph["edges"]:
        if not isinstance(edge, dict) or not isinstance(edge.get("source"), str) or not isinstance(edge.get("target"), str) or edge["source"] not in ids or edge["target"] not in ids:
            raise HTTPException(422, "Each edge must connect existing nodes.")
    return graph


def save_project_version(db, project_id, data):
    validate_architecture(data.architecture_json)
    name = data.model_name.strip()
    if not name:
        raise HTTPException(422, "Model name cannot be blank.")
    project = db.query(Project).filter(
        Project.id == project_id, Project.owner_id == data.owner_id,
    ).with_for_update().populate_existing().first()
    if project is None:
        raise HTTPException(404, "Project not found or access denied.")
    if project.version != data.expected_version:
        raise HTTPException(409, "This project was saved elsewhere. Export your draft before reloading the latest version.")
    project.version += 1
    project.model_name = name
    project.name = name
    project.architecture_json = data.architecture_json
    revision = ProjectVersion(
        project_id=project.id, owner_id=project.owner_id, version=project.version,
        model_name=name, architecture_json=data.architecture_json,
    )
    db.add(revision)
    db.commit()
    # Return this immutable row, not the mutable project head, which another
    # editor could advance immediately after this transaction commits.
    db.refresh(revision)
    return {"success": True, "message": "Architecture saved", "revision_id": revision.id,
            "version": revision.version, "model_name": revision.model_name}


def snapshot_project(project, db=None, requested_version=None):
    # Called while the project's row lock is held. Save and Train cannot see
    # mismatched name/version/architecture from concurrent Builder saves.
    if requested_version is not None:
        revision = db.query(ProjectVersion).filter_by(
            project_id=project.id, owner_id=project.owner_id, version=requested_version,
        ).first()
        if revision is None:
            raise HTTPException(404, "The selected Builder version was not found in this project.")
        return {"project_version": revision.version, "model_name": revision.model_name,
                "architecture_json": revision.architecture_json}
    return {
        "project_version": project.version or None,
        "model_name": project.model_name or project.name,
        "architecture_json": project.architecture_json,
    }


def owned_project(db, project_id, owner_id):
    project = db.query(Project).filter_by(id=project_id, owner_id=owner_id).first()
    if project is None:
        raise HTTPException(404, "Project not found or access denied.")
    return project


@router.get("/projects/{project_id}/versions")
def list_project_versions(project_id: int, owner_id: int, db: Session = Depends(get_db)):
    project = owned_project(db, project_id, owner_id)
    # List lightweight metadata only; fetch a graph only when the user selects it.
    rows = db.query(ProjectVersion.id, ProjectVersion.version, ProjectVersion.model_name, ProjectVersion.created_at).filter_by(
        project_id=project_id, owner_id=owner_id,
    ).order_by(ProjectVersion.version.desc()).all()
    return {"success": True, "latest_version": project.version, "versions": [
        {"id": row.id, "version": row.version, "model_name": row.model_name, "created_at": row.created_at}
        for row in rows
    ]}


@router.get("/projects/{project_id}/versions/{version}")
def get_project_version(project_id: int, version: int, owner_id: int, db: Session = Depends(get_db)):
    project = owned_project(db, project_id, owner_id)
    revision = db.query(ProjectVersion).filter_by(project_id=project_id, owner_id=owner_id, version=version).first()
    if revision is None:
        raise HTTPException(404, "Builder version not found.")
    return {"success": True, "latest_version": project.version, "revision": {
        "id": revision.id, "version": revision.version, "model_name": revision.model_name,
        "architecture_json": revision.architecture_json,
    }}


@router.put("/projects/{project_id}/editors/{session_id}")
def editor_heartbeat(project_id: int, session_id: UUID, owner_id: int, db: Session = Depends(get_db)):
    project = owned_project(db, project_id, owner_id)
    now = datetime.utcnow()
    cutoff = now - timedelta(seconds=60)
    # Presence is advisory; row locking + expected_version protect every Save
    # even when a tab is offline, asleep or has no registered heartbeat.
    db.query(ProjectEditorSession).filter(ProjectEditorSession.project_id == project_id,
        ProjectEditorSession.last_seen < cutoff).delete(synchronize_session=False)
    statement = insert(ProjectEditorSession).values(session_id=str(session_id), project_id=project_id,
                                                   owner_id=owner_id, last_seen=now)
    db.execute(statement.on_conflict_do_update(index_elements=[ProjectEditorSession.session_id],
        set_={"last_seen": now}, where=(ProjectEditorSession.project_id == project_id) & (ProjectEditorSession.owner_id == owner_id)))
    db.commit()
    count = db.query(ProjectEditorSession).filter(ProjectEditorSession.project_id == project_id,
        ProjectEditorSession.last_seen >= cutoff).count()
    return {"success": True, "active_editors": count, "latest_version": project.version}


@router.delete("/projects/{project_id}/editors/{session_id}")
def leave_editor(project_id: int, session_id: UUID, owner_id: int, db: Session = Depends(get_db)):
    owned_project(db, project_id, owner_id)
    db.query(ProjectEditorSession).filter_by(project_id=project_id, owner_id=owner_id, session_id=str(session_id)).delete()
    db.commit()
    return {"success": True}
