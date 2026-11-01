"""Owner-scoped model downloads and recoverable removal from the model list."""

from datetime import datetime
import json
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Literal
from zipfile import ZIP_STORED, ZipFile
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask

from database import get_db
from models import ModelVersion, Project
from project_versioning import validate_architecture

router = APIRouter()
STORAGE_ROOT = Path("/app/storage")
DOWNLOAD_HEADERS = {"Cache-Control": "private, no-store"}
PT_EXPORT_LOCK = Lock()


def full_pt_download(model, path, folder):
    from training.pt_export import FULL_PT_FILENAME, write_full_model
    import torch

    if path.name == FULL_PT_FILENAME:
        return FileResponse(path, filename="model.pt", media_type="application/octet-stream", headers=DOWNLOAD_HEADERS)
    target = folder / FULL_PT_FILENAME
    # Legacy state_dict files remain untouched. Prepare once, reuse on later downloads.
    with PT_EXPORT_LOCK:
        if target.exists():
            target = checked_file(target, folder)
        else:
            try:
                architecture = model.architecture_json
                validate_architecture(architecture)  # Never use the current project head.
                class_names = json.loads(model.class_names_json or "[]")
                count = model.class_count or len(class_names)
                state = torch.load(path, map_location="cpu", weights_only=True)
                if not isinstance(state, dict):
                    raise ValueError("Expected a legacy state_dict.")
                write_full_model(state, architecture, class_names, count, target)
            except OSError as exc:
                raise HTTPException(503, "Cannot prepare model.pt: server storage could not be read or written. Check available disk space and permissions, then retry.") from exc
            except Exception as exc:
                raise HTTPException(409, "Cannot prepare the full PT model: saved architecture, class information or weights are missing/incompatible. Original files are unchanged.") from exc
    return FileResponse(target, filename="model.pt", media_type="application/octet-stream", headers=DOWNLOAD_HEADERS)


def owned_model(db, model_id, owner_id, project_id):
    model = db.query(ModelVersion).join(Project, Project.id == ModelVersion.project_id).filter(
        ModelVersion.id == model_id,
        ModelVersion.owner_id == owner_id,
        ModelVersion.project_id == project_id,
        Project.owner_id == owner_id,
        ModelVersion.deleted_at.is_(None),
    ).first()
    if model is None:
        raise HTTPException(404, "Model not found or access denied.")
    return model


def checked_file(path, folder):
    """Never serve paths outside this particular owner's model version folder."""
    root = STORAGE_ROOT.resolve()
    expected = folder.resolve()
    target = Path(path).resolve()
    if not expected.is_relative_to(root) or expected == root or not target.is_relative_to(expected):
        raise HTTPException(404, "Model file is unavailable.")
    # Disallow a version folder redirected into a different owner's storage.
    if expected != folder.absolute():
        raise HTTPException(404, "Model file is unavailable.")
    if not target.is_file():
        raise HTTPException(404, "Model file is missing from storage.")
    return target


def external_locations(message):
    """Find external tensors, including tensors in nested ONNX subgraphs."""
    import onnx

    if isinstance(message, onnx.TensorProto):
        if message.data_location == onnx.TensorProto.EXTERNAL:
            location = next((entry.value for entry in message.external_data if entry.key == "location"), None)
            if not location:
                raise ValueError("External tensor has no location")
            yield location
        return
    for field, value in message.ListFields():
        if field.message_type is not None:
            for child in value if field.is_repeated else [value]:
                yield from external_locations(child)


def onnx_download(path, folder, filename):
    import onnx

    try:
        graph = onnx.load(str(path), load_external_data=False)
        locations = set(external_locations(graph))
    except Exception as exc:
        raise HTTPException(409, "The saved ONNX model cannot be read.") from exc
    if not locations:
        return FileResponse(path, media_type="application/octet-stream", filename=f"{filename}.onnx", headers=DOWNLOAD_HEADERS)

    files = []
    for location in sorted(locations):
        relative = Path(location)
        if relative.is_absolute() or location.startswith("/") or ".." in relative.parts or "\\" in location or ":" in location:
            raise HTTPException(409, "The ONNX model references an unsafe external file.")
        files.append((checked_file(path.parent / relative, folder), relative.as_posix()))

    # Disk-backed archive: no copy of the weights is buffered in API memory.
    with NamedTemporaryFile(prefix="model-download-", suffix=".zip", delete=False) as temporary:
        archive_path = Path(temporary.name)
    try:
        with ZipFile(archive_path, "w", compression=ZIP_STORED) as archive:
            archive.write(path, path.name)
            for file_path, name in files:
                archive.write(file_path, name)
        return FileResponse(
            archive_path, media_type="application/zip", filename=f"{filename}-onnx.zip",
            headers=DOWNLOAD_HEADERS,
            background=BackgroundTask(archive_path.unlink, missing_ok=True),
        )
    except Exception:
        archive_path.unlink(missing_ok=True)
        raise


@router.get("/training/projects/{project_id}/models/{model_id}/download/{file_format}")
def download_model(
    project_id: int, model_id: int, file_format: Literal["pt", "onnx", "json"],
    owner_id: int, db: Session = Depends(get_db),
):
    model = owned_model(db, model_id, owner_id, project_id)
    if model.allow_download is False:
        raise HTTPException(403, "Downloads are disabled for this model.")
    filename = f"project-{project_id}-model-{model_id}-v{model.version}"
    if file_format == "json":
        # Only the actual trained model snapshot, never today's project head.
        if not model.architecture_json or model.architecture_json.strip() in ("", "{}"):
            raise HTTPException(404, "No Builder architecture was saved for this model.")
        try:
            architecture = validate_architecture(model.architecture_json)
        except HTTPException as exc:
            raise HTTPException(409, "The saved Builder architecture cannot be read.") from exc
        payload = {
            "format": "ai-trainer-builder", "schema_version": 1,
            "model_name": model.name, "source_version": model.project_version,
            "draft": False, "exported_at": datetime.utcnow().isoformat() + "Z",
            "architecture": architecture,
            "training": {"model_id": model.id, "training_job_id": model.training_job_id,
                         "training_run": model.version, "dataset_id": model.dataset_id,
                         "dataset_name": model.dataset_name},
        }
        return Response(json.dumps(payload, ensure_ascii=False, indent=2), media_type="application/json",
            headers={**DOWNLOAD_HEADERS, "Content-Disposition": f'attachment; filename="{filename}-builder.json"'})
    stored_path = model.pt_path if file_format == "pt" else model.onnx_path
    if not stored_path:
        raise HTTPException(404, "This model format is not available.")
    folder = STORAGE_ROOT / "models" / f"user_{owner_id}" / f"project_{project_id}" / f"version_{model.version}"
    path = checked_file(stored_path, folder)
    if file_format == "onnx":
        return onnx_download(path, folder, filename)
    return full_pt_download(model, path, folder)


@router.delete("/training/projects/{project_id}/models/{model_id}")
def delete_model(project_id: int, model_id: int, owner_id: int, db: Session = Depends(get_db)):
    model = owned_model(db, model_id, owner_id, project_id)
    # Keep the row for version allocation / lineage and keep files recoverable.
    # Training jobs, checkpoints and metric history are intentionally untouched.
    model.deleted_at = datetime.utcnow()
    db.commit()
    return {"success": True, "message": "Model removed from the list. Files and training history are retained."}
