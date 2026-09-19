"""Lazy class-count details for an owned dataset; no image contents are exposed."""

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from dataset_scanner import scan_dataset
from dataset_service import get_dataset_folder
from models import Dataset

router = APIRouter()


def cached_counts(value):
    try:
        rows = json.loads(value)
        if not isinstance(rows, list):
            return None
        if all(isinstance(row, dict) and isinstance(row.get("name"), str)
               and type(row.get("image_count")) is int and row["image_count"] >= 0
               and isinstance(row.get("splits"), dict)
               and all(key in {"train", "val", "test"} and type(count) is int and count >= 0
                       for key, count in row["splits"].items()) for row in rows):
            return rows
    except (ValueError, TypeError):
        pass
    return None


@router.get("/datasets/{dataset_id}/details")
def dataset_details(dataset_id: int, owner_id: int, db: Session = Depends(get_db)):
    dataset = db.query(Dataset).filter_by(id=dataset_id, owner_id=owner_id).first()
    if dataset is None:
        raise HTTPException(404, "Dataset not found or access denied.")
    if dataset.status in {"uploading", "processing"}:
        raise HTTPException(409, "Dataset is still processing. Try again when scanning finishes.")
    if dataset.status == "failed":
        raise HTTPException(409, "Dataset import failed. Class counts are not available.")

    counts = cached_counts(dataset.class_counts_json)
    if counts is None:
        # Serialize the first backfill for this dataset, not every Library GET.
        dataset = db.query(Dataset).filter_by(id=dataset_id, owner_id=owner_id).with_for_update().populate_existing().first()
        if dataset is None:
            raise HTTPException(404, "Dataset not found or access denied.")
        if dataset.status in {"uploading", "processing", "failed"}:
            raise HTTPException(409, "Dataset is not available for class counting yet.")
        counts = cached_counts(dataset.class_counts_json)
        if counts is None:
            # Construct the owned directory; never scan an arbitrary DB path.
            folder = get_dataset_folder(owner_id, dataset_id) / "files"
            if folder.resolve() != folder.absolute() or not folder.is_dir():
                raise HTTPException(404, "Dataset files are unavailable. Per-class counts could not be calculated.")
            try:
                counts = scan_dataset(folder).class_counts
            except OSError as exc:
                raise HTTPException(503, "Unable to read dataset files. Please try again.") from exc
            dataset.class_counts_json = json.dumps(counts, ensure_ascii=False)
            db.commit()
    classified = sum(row["image_count"] for row in counts)
    return {
        "success": True, "dataset_id": dataset.id, "classes": counts,
        "detected_class_count": len(counts), "classified_image_count": classified,
        "unassigned_image_count": max(0, (dataset.image_count or 0) - classified),
        "count_basis": "supported_image_extensions",
    }
