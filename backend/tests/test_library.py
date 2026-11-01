"""Synthetic, isolated privacy/community regression tests (no real user data)."""
import json
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile
import unittest
from unittest.mock import patch

from fastapi import FastAPI, Depends
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from access import issue_session, protect_legacy
from database import get_db
import dataset_service
import library_datasets
from models import Base, Dataset, Project, User


class LibraryTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        self.addCleanup(engine.dispose)
        Base.metadata.create_all(engine)
        self.sessions = sessionmaker(bind=engine)
        with self.sessions() as db:
            db.add_all([User(id=1, username="alice"), User(id=2, username="bob")])
            db.add_all([Dataset(id=1, owner_id=1, name="Private fruit", source_type="zip", status="ready", image_count=2, class_count=2,
                                class_counts_json=json.dumps([{"name": "apple", "image_count": 1, "splits": {}}, {"name": "banana", "image_count": 1, "splits": {}}])),
                        Dataset(id=2, owner_id=2, name="Public fruit", source_type="url", status="ready", visibility="public", class_counts_json="[]")])
            db.commit()
            self.tokens = {i: issue_session(db, i) for i in [1, 2]}
        def get_test_db():
            with self.sessions() as db:
                yield db
        self.app = FastAPI(dependencies=[Depends(protect_legacy)])
        self.app.dependency_overrides[get_db] = get_test_db
        self.app.include_router(library_datasets.router)
        @self.app.get("/datasets/{owner_id}")
        def legacy_list(owner_id: int):
            return {"success": True}
        @self.app.get("/dataset/{dataset_id}")
        def legacy_detail(dataset_id: int):
            return {"success": True}
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)
        temp = TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        patcher = patch.object(dataset_service, "STORAGE_ROOT", self.root)
        patcher.start(); self.addCleanup(patcher.stop)

    def headers(self, user=1):
        return {"Authorization": f"Bearer {self.tokens[user]}"}

    def get(self, path, user=1):
        return self.client.get(path, headers=self.headers(user))

    def test_verified_session_cannot_be_replaced_by_owner_id(self):
        self.assertEqual(self.client.get("/library/datasets?owner_id=1").status_code, 401)
        self.assertEqual(self.get("/datasets/2").status_code, 403)
        self.assertEqual(self.get("/dataset/1", 2).status_code, 404)
        self.assertEqual(self.get("/dataset/1").status_code, 200)

    def test_dataset_scopes_names_search_and_page_bounds(self):
        mine = self.get("/library/datasets").json()
        self.assertEqual([row["display_name"] for row in mine["items"]], ["alice/Private fruit"])
        public = self.get("/library/datasets?scope=public&q=bob").json()
        self.assertEqual(public["total"], 1)
        self.assertNotIn("storage_path", public["items"][0])
        self.assertNotIn("source_url", public["items"][0])
        self.assertEqual(self.get("/library/datasets?scope=public&q=alice").json()["total"], 0)
        self.assertEqual(self.get("/library/datasets?page_size=100").status_code, 422)

    def test_visibility_is_owner_only_and_revocation_is_immediate(self):
        path = "/library/datasets/1/visibility"
        self.assertEqual(self.client.patch(path, json={"visibility": "public"}, headers=self.headers(2)).status_code, 404)
        for visibility, expected in [("public", 200), ("private", 404)]:
            result = self.client.patch(path, json={"visibility": visibility}, headers=self.headers())
            self.assertEqual(result.status_code, 200)
            self.assertEqual(self.get("/library/datasets/1/details", 2).status_code, expected)

    def test_details_read_database_even_when_files_are_absent(self):
        with patch("dataset_scanner.scan_dataset", side_effect=AssertionError("No live scan")):
            result = self.get("/library/datasets/1/details")
        self.assertEqual(result.json()["classified_image_count"], 2)
        with self.sessions() as db:
            db.get(Dataset, 1).class_counts_json = None
            db.commit()
        self.assertEqual(self.get("/library/datasets/1/details").status_code, 409)

    def test_zip_download_owner_public_private_and_safe_paths(self):
        for owner, dataset in [(1, 1), (2, 2)]:
            folder = self.root / f"user_{owner}/dataset_{dataset}/files/apple"
            folder.mkdir(parents=True)
            (folder / "a.jpg").write_bytes(b"fixture")
        response = self.get("/library/datasets/1/download")
        with ZipFile(BytesIO(response.content)) as archive:
            self.assertEqual(archive.read("apple/a.jpg"), b"fixture")
        self.assertEqual(self.get("/library/datasets/1/download", 2).status_code, 404)
        self.assertEqual(self.get("/library/datasets/2/download").status_code, 200)
        (self.root / "user_1/dataset_1/files/outside").symlink_to(self.root / "user_2", target_is_directory=True)
        self.assertEqual(self.get("/library/datasets/1/download").status_code, 409)

    def test_source_validation_rejects_internal_network_and_wrong_provider(self):
        from fastapi import HTTPException
        with patch.object(dataset_service.socket, "getaddrinfo", return_value=[(None, None, None, None, ("127.0.0.1", 80))]):
            with self.assertRaises(HTTPException):
                dataset_service.validate_source_url("http://localhost/a.zip")
        with self.assertRaises(HTTPException):
            dataset_service.validate_source_url("https://example.com/a.zip", "google_drive")
        with patch.object(dataset_service.socket, "getaddrinfo", return_value=[(None, None, None, None, ("8.8.8.8", 443))]):
            dataset_service.validate_source_url("https://example.com/a.zip", "other")

    def test_logout_revokes_token(self):
        self.assertEqual(self.client.post("/logout", headers=self.headers()).status_code, 200)
        self.assertEqual(self.get("/library/datasets").status_code, 401)
