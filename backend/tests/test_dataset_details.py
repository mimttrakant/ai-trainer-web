"""Dataset counts use synthetic files and an isolated in-memory database only."""

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database import get_db
import dataset_details
from dataset_scanner import scan_dataset
import dataset_service
from models import Base, Dataset


class DatasetDetailsTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.folder = self.root / "user_2/dataset_7/files"
        self.folder.mkdir(parents=True)
        patcher = patch.object(dataset_service, "STORAGE_ROOT", self.root)
        patcher.start()
        self.addCleanup(patcher.stop)
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        self.addCleanup(engine.dispose)
        Base.metadata.create_all(engine)
        self.session = sessionmaker(bind=engine)
        with self.session() as db:
            db.add(Dataset(id=7, owner_id=2, name="Fruit", source_type="upload", status="ready",
                           image_count=3, class_count=2, split_type="auto_split", supported=True))
            db.commit()

        def get_test_db():
            with self.session() as db:
                yield db

        app = FastAPI()
        app.include_router(dataset_details.router)
        app.dependency_overrides[get_db] = get_test_db
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def files(self, *names):
        for name in names:
            path = self.folder / name
            path.parent.mkdir(parents=True, exist_ok=True)
            # Scanner counts extensions; it must not claim to decode these bytes.
            path.write_bytes(b"synthetic fixture")

    def change(self, **fields):
        with self.session() as db:
            row = db.get(Dataset, 7)
            for name, value in fields.items():
                setattr(row, name, value)
            db.commit()

    def details(self, owner=2):
        return self.client.get(f"/datasets/7/details?owner_id={owner}")

    def test_wrapped_class_counts_include_nested_images_and_supported_extensions_only(self):
        self.files("fruit/apple/one.JPG", "fruit/apple/nested/two.webp", "fruit/apple/notes.txt",
                   "fruit/banana/three.png", "fruit/.ignored/notaclass.jpg", "__MACOSX/metadata.jpg")
        result = scan_dataset(self.folder)
        self.assertTrue(result.supported)
        self.assertEqual(result.image_count, 3)
        self.assertEqual(result.class_count, 2)
        self.assertEqual(result.class_counts, [
            {"name": "apple", "image_count": 2, "splits": {}},
            {"name": "banana", "image_count": 1, "splits": {}},
        ])

    def test_split_counts_aggregate_aliases_and_leave_loose_images_unassigned(self):
        self.files("fruit/training/apple/a.jpg", "fruit/training/apple/b.jpg", "fruit/training/banana/a.png",
                   "fruit/validation/apple/a.jpg", "fruit/validation/banana/a.jpg",
                   "fruit/testing/apple/a.bmp", "fruit/testing/banana/a.jpeg", "fruit/training/loose.jpg")
        result = scan_dataset(self.folder)
        self.assertTrue(result.supported)
        self.assertEqual(result.image_count, 8)
        self.assertEqual(result.class_counts, [
            {"name": "apple", "image_count": 4, "splits": {"train": 2, "val": 1, "test": 1}},
            {"name": "banana", "image_count": 3, "splits": {"train": 1, "val": 1, "test": 1}},
        ])
        self.change(image_count=8, split_type="pre_split")
        data = self.details().json()
        self.assertEqual(data["classified_image_count"], 7)
        self.assertEqual(data["unassigned_image_count"], 1)

    def test_inconsistent_splits_remain_unsupported_but_explain_all_detected_classes(self):
        self.files("train/apple/a.jpg", "train/banana/a.jpg", "val/apple/a.jpg", "val/orange/a.jpg")
        result = scan_dataset(self.folder)
        self.assertFalse(result.supported)
        self.assertIn("inconsistent", result.unsupported_reason)
        self.assertEqual([row["name"] for row in result.class_counts], ["apple", "banana", "orange"])
        self.assertEqual(sum(row["image_count"] for row in result.class_counts), 4)

    def test_unlabeled_and_annotation_only_have_no_invented_classes(self):
        self.files("labels.json")
        result = scan_dataset(self.folder)
        self.assertFalse(result.supported)
        self.assertEqual(result.class_counts, [])
        self.files("loose.jpg")
        result = scan_dataset(self.folder)
        self.assertEqual(result.image_count, 1)
        self.assertEqual(result.class_counts, [])

    def test_import_scan_persists_counts_with_other_summary_fields(self):
        self.files("apple/a.jpg", "apple/b.jpg", "banana/a.jpg")
        with self.session() as db:
            row = db.get(Dataset, 7)
            dataset_service.apply_scan_result(row, self.folder)
            db.commit()
            self.assertEqual(row.status, "ready")
            self.assertEqual(row.class_count, 2)
            self.assertEqual(sum(item["image_count"] for item in json.loads(row.class_counts_json)), 3)

    def test_legacy_details_backfill_once_and_preserve_existing_metadata(self):
        self.files("apple/a.jpg", "apple/b.jpg", "banana/a.jpg")
        with patch.object(dataset_details, "scan_dataset", wraps=scan_dataset) as scanner:
            first = self.details()
            self.assertEqual(first.status_code, 200)
            self.assertEqual(first.json()["detected_class_count"], 2)
            self.assertEqual(first.json()["classified_image_count"], 3)
            self.assertEqual(self.details().json(), first.json())
            self.assertEqual(scanner.call_count, 1)
        with self.session() as db:
            row = db.get(Dataset, 7)
            self.assertIsNotNone(row.class_counts_json)
            self.assertTrue(row.supported)
            self.assertEqual((row.status, row.class_count, row.image_count), ("ready", 2, 3))

    def test_cached_and_empty_counts_do_not_scan_files(self):
        for rows in [[], [{"name": "apple", "image_count": 3, "splits": {}}]]:
            self.change(class_counts_json=json.dumps(rows))
            with patch.object(dataset_details, "scan_dataset") as scanner:
                self.assertEqual(self.details().json()["classes"], rows)
                scanner.assert_not_called()

    def test_invalid_cached_shape_is_rebuilt(self):
        self.files("apple/a.jpg", "banana/a.jpg")
        for value in ["broken json", '{}', '[{"name":"apple"}]', '[{"name":"apple","image_count":-1,"splits":{}}]']:
            self.change(class_counts_json=value)
            self.assertEqual(self.details().json()["detected_class_count"], 2)

    def test_wrong_owner_missing_and_unfinished_datasets_do_not_scan(self):
        with patch.object(dataset_details, "scan_dataset") as scanner:
            self.assertEqual(self.details(owner=3).status_code, 404)
            self.assertEqual(self.client.get("/datasets/999/details?owner_id=2").status_code, 404)
            self.assertEqual(self.client.get("/datasets/7/details").status_code, 422)
            for status in ["processing", "uploading", "failed"]:
                self.change(status=status)
                self.assertEqual(self.details().status_code, 409)
            scanner.assert_not_called()

    def test_unsupported_dataset_still_has_useful_details(self):
        self.files("loose.jpg")
        self.change(status="unsupported", supported=False, image_count=1, class_count=0)
        result = self.details()
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["classes"], [])
        self.assertEqual(result.json()["unassigned_image_count"], 1)

    def test_missing_or_redirected_root_is_not_scanned(self):
        self.folder.rmdir()  # Only this test's empty temporary directory.
        self.change(storage_path="/some/arbitrary/directory")
        self.assertEqual(self.details().status_code, 404)
        other = self.root / "other_owner_files"
        other.mkdir()
        self.folder.symlink_to(other, target_is_directory=True)
        self.assertEqual(self.details().status_code, 404)

    def test_scan_failure_does_not_cache_incomplete_counts(self):
        with patch.object(dataset_details, "scan_dataset", side_effect=OSError("temporary failure")):
            self.assertEqual(self.details().status_code, 503)
        with self.session() as db:
            self.assertIsNone(db.get(Dataset, 7).class_counts_json)


if __name__ == "__main__":
    unittest.main()
