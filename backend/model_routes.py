"""Owner-scoped model downloads and recoverable removal from the model list."""

from datetime import datetime
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Literal
from zipfile import ZIP_STORED, ZipFile

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask

from database import get_db
from models import ModelVersion, Project

router = APIRouter()
STORAGE_ROOT = Path("/app/storage")
DOWNLOAD_HEADERS = {"Cache-Control": "private, no-store"}


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
        if relative.is_absolute() or ".." in relative.parts or "\\" in location or ":" in location:
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
    project_id: int, model_id: int, file_format: Literal["pt", "onnx"],
    owner_id: int, db: Session = Depends(get_db),
):
    model = owned_model(db, model_id, owner_id, project_id)
    if model.allow_download is False:
        raise HTTPException(403, "Downloads are disabled for this model.")
    stored_path = model.pt_path if file_format == "pt" else model.onnx_path
    if not stored_path:
        raise HTTPException(404, "This model format is not available.")
    folder = STORAGE_ROOT / "models" / f"user_{owner_id}" / f"project_{project_id}" / f"version_{model.version}"
    path = checked_file(stored_path, folder)
    filename = f"project-{project_id}-model-{model_id}-v{model.version}"
    if file_format == "onnx":
        return onnx_download(path, folder, filename)
    return FileResponse(path, media_type="application/octet-stream", filename=f"{filename}.pt", headers=DOWNLOAD_HEADERS)


@router.delete("/training/projects/{project_id}/models/{model_id}")
def delete_model(project_id: int, model_id: int, owner_id: int, db: Session = Depends(get_db)):
    model = owned_model(db, model_id, owner_id, project_id)
    # Keep the row for version allocation / lineage and keep files recoverable.
    # Training jobs, checkpoints and metric history are intentionally untouched.
    model.deleted_at = datetime.utcnow()
    db.commit()
    return {"success": True, "message": "Model removed from the list. Files and training history are retained."}
