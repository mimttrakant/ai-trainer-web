"""Run once after upgrade: docker compose exec backend python -m backfill_dataset_counts."""
import json
from database import SessionLocal
from dataset_details import cached_counts
from dataset_scanner import scan_dataset
from dataset_service import get_dataset_folder
from models import Dataset


def backfill():
    failures = 0
    with SessionLocal() as db:
        ids = [row.id for row in db.query(Dataset.id).filter(Dataset.status.in_(["ready", "unsupported"]))]
    for dataset_id in ids:
        with SessionLocal() as db:
            row = db.query(Dataset).filter_by(id=dataset_id).with_for_update().first()
            if row is None or cached_counts(row.class_counts_json) is not None:
                continue
            folder = get_dataset_folder(row.owner_id, row.id) / "files"
            try:
                if not folder.is_dir() or folder.resolve() != folder.absolute():
                    raise ValueError("Dataset files unavailable")
                row.class_counts_json = json.dumps(scan_dataset(folder).class_counts, ensure_ascii=False)
                db.commit()
                print(f"Dataset {dataset_id}: statistics stored")
            except (OSError, ValueError) as error:
                failures += 1
                print(f"Dataset {dataset_id}: {error}")
    return failures


if __name__ == "__main__":
    raise SystemExit(1 if backfill() else 0)
