"""Immutable Builder saves and architecture snapshots at job submission."""

import json

from fastapi import HTTPException
from sqlalchemy import text

from models import Project, ProjectVersion


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
    project.architecture_json = data.architecture_json
    db.add(ProjectVersion(
        project_id=project.id, owner_id=project.owner_id, version=project.version,
        model_name=name, architecture_json=data.architecture_json,
    ))
    db.commit()
    db.refresh(project)
    return {"success": True, "message": "Architecture saved", "version": project.version, "model_name": project.model_name}


def snapshot_project(project):
    # Called while the project's row lock is held. Save and Train cannot see
    # mismatched name/version/architecture from concurrent Builder saves.
    return {
        "project_version": project.version or None,
        "model_name": project.model_name or project.name,
        "architecture_json": project.architecture_json,
    }
