"""Synthetic, isolated privacy/community regression tests (no real user data)."""
import json
from contextlib import contextmanager
import httpx
from PIL import Image
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile
import unittest
from unittest.mock import patch

from fastapi import FastAPI, Depends, Form, UploadFile, File
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from access import issue_session, protect_legacy
from database import get_db
import dataset_service
import library_datasets
import library_models
import library_training
import model_routes
from models import Base, Dataset, ModelVersion, Project, ProjectVersion, TrainingJob, TrainingMetric, User


class LibraryTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        self.addCleanup(engine.dispose)
        Base.metadata.create_all(engine)
        self.sessions = sessionmaker(bind=engine)
        with self.sessions() as db:
            db.add_all([User(id=1, username="alice"), User(id=2, username="bob")])
            self.graph = json.dumps({"nodes": [{"id": "input", "data": {"layerType": "Input", "properties": {"channels": 3}}}], "edges": []})
            db.add_all([Project(id=1, owner_id=1, name="Mine", model_name="Mine", version=1, architecture_json=self.graph),
                        Project(id=2, owner_id=2, name="Shared", model_name="Shared", version=2, visibility="public", architecture_json=self.graph),
                        Project(id=3, owner_id=2, name="Hidden", model_name="Hidden", version=1, architecture_json=self.graph)])
            db.add_all([ProjectVersion(project_id=owner_project, owner_id=1 if owner_project == 1 else 2, version=version, model_name=f"Design {version}", architecture_json=self.graph)
                        for owner_project, version in [(1, 1), (2, 1), (2, 2), (3, 1)]])
            db.add_all([Dataset(id=1, owner_id=1, name="Private fruit", source_type="zip", status="ready", supported=True, image_count=2, class_count=2,
                                class_counts_json=json.dumps([{"name": "apple", "image_count": 1, "splits": {}}, {"name": "banana", "image_count": 1, "splits": {}}])),
                        Dataset(id=2, owner_id=2, name="Public fruit", source_type="url", status="ready", supported=True, visibility="public", class_counts_json="[]")])
            db.commit()
            self.tokens = {i: issue_session(db, i) for i in [1, 2]}
        def get_test_db():
            with self.sessions() as db:
                yield db
        self.app = FastAPI(dependencies=[Depends(protect_legacy)])
        self.app.dependency_overrides[get_db] = get_test_db
        self.app.include_router(library_datasets.router)
        self.app.include_router(library_models.router)
        self.app.include_router(library_training.router)
        @self.app.post("/datasets/upload")
        async def legacy_upload(owner_id: int = Form(...), file: UploadFile = File(...)):
            return {"owner_id": owner_id, "content": (await file.read()).decode()}
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
        patcher = patch.object(model_routes, "STORAGE_ROOT", self.root)
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

    def test_direct_url_redirect_import_persists_counts_and_zip_download_roundtrips(self):
        image = BytesIO(); Image.new("RGB", (8, 8), "red").save(image, format="PNG")
        payload = BytesIO()
        with ZipFile(payload, "w") as archive:
            for label in ["apple", "banana"]:
                archive.writestr(f"{label}/sample.png", image.getvalue())
        visited = []
        @contextmanager
        def stream(method, url, **kwargs):
            visited.append(url)
            self.assertFalse(kwargs["follow_redirects"])
            yield httpx.Response(302 if len(visited) == 1 else 200,
                                 headers={"location": "/files/dataset.zip"} if len(visited) == 1 else {},
                                 content=b"" if len(visited) == 1 else payload.getvalue(), request=httpx.Request(method, url))
        with self.sessions() as db:
            db.get(Dataset, 2).source_url = "https://example.com/download"; db.commit()
        with patch.object(dataset_service, "SessionLocal", self.sessions), patch.object(dataset_service.httpx, "stream", stream), patch.object(
                dataset_service.socket, "getaddrinfo", return_value=[(None, None, None, None, ("8.8.8.8", 443))]):
            dataset_service.process_url_dataset(2)
        self.assertEqual(visited, ["https://example.com/download", "https://example.com/files/dataset.zip"])
        with self.sessions() as db:
            dataset = db.get(Dataset, 2)
            self.assertEqual((dataset.status, dataset.image_count, dataset.class_count), ("ready", 2, 2))
            self.assertEqual([row["image_count"] for row in json.loads(dataset.class_counts_json)], [1, 1])
        with patch("dataset_scanner.scan_dataset", side_effect=AssertionError("Do not rescan imported data")):
            self.assertEqual(self.get("/library/datasets/2/details").json()["classified_image_count"], 2)
        with ZipFile(BytesIO(self.get("/library/datasets/2/download").content)) as archive:
            self.assertEqual(set(archive.namelist()), {"apple/sample.png", "banana/sample.png"})

    def test_direct_url_rechecks_redirect_target_before_connecting(self):
        visited = []
        @contextmanager
        def stream(method, url, **kwargs):
            visited.append(url)
            yield httpx.Response(302, headers={"location": "http://127.0.0.1/private.zip"}, request=httpx.Request(method, url))
        def addresses(host, port):
            return [(None, None, None, None, ("127.0.0.1" if host == "127.0.0.1" else "8.8.8.8", port))]
        from fastapi import HTTPException
        with patch.object(dataset_service.httpx, "stream", stream), patch.object(dataset_service.socket, "getaddrinfo", addresses):
            with self.assertRaises(HTTPException):
                dataset_service.download_direct_url("https://example.com/download", self.root / "target.zip")
        self.assertEqual(len(visited), 1)

    def test_logout_revokes_token(self):
        self.assertEqual(self.client.post("/logout", headers=self.headers()).status_code, 200)
        self.assertEqual(self.get("/library/datasets").status_code, 401)

    def test_legacy_multipart_auth_preserves_upload_and_rejects_forged_owner(self):
        for owner, status in [(1, 200), (2, 403)]:
            result = self.client.post("/datasets/upload", data={"owner_id": str(owner)},
                                      files={"file": ("test.zip", b"fixture", "application/zip")}, headers=self.headers())
            self.assertEqual(result.status_code, status)
            if status == 200:
                self.assertEqual(result.json()["content"], "fixture")

    def submit(self, **overrides):
        return self.client.post("/library/jobs", json={"model_id": 2, "version": 1, "dataset_id": 2, **overrides}, headers=self.headers())

    def complete(self, job_id, visibility="private"):
        folder = self.root / "models/user_1/project_2/version_1"
        folder.mkdir(parents=True, exist_ok=True)
        pt = folder / "model.pt"; pt.write_bytes(b"synthetic weight")
        with self.sessions() as db:
            job = db.get(TrainingJob, job_id); job.status = "completed"
            db.add(TrainingMetric(training_job_id=job_id, epoch=1, train_loss=1.5, val_loss=1.2, train_accuracy=50, val_accuracy=60))
            weight = ModelVersion(owner_id=1, project_id=2, dataset_id=job.dataset_id, training_job_id=job_id,
                                  name=job.model_name, dataset_name=job.dataset_name, project_version=job.project_version,
                                  version=1, visibility=visibility, pt_path=str(pt))
            db.add(weight); db.commit(); return weight.id

    def test_training_uses_selected_public_revision_and_submitter_owns_job(self):
        response = self.submit()
        self.assertEqual(response.status_code, 200, response.text)
        job_id = response.json()["job"]["id"]
        with self.sessions() as db:
            job = db.get(TrainingJob, job_id)
            self.assertEqual((job.owner_id, job.project_version, job.source_project_owner_id, job.source_dataset_owner_id), (1, 1, 2, 2))
            self.assertEqual((job.model_name, job.dataset_name, job.architecture_json), ("bob/Design 1", "bob/Public fruit", self.graph))
            self.assertEqual(db.get(Project, 2).version, 2)
            self.assertEqual(db.query(Project).count(), 3)
        self.assertEqual(self.get(f"/library/jobs?q=job%23{job_id}").json()["total"], 1)
        self.assertEqual(self.get("/library/jobs", 2).json()["total"], 0)
        self.assertEqual(self.get(f"/library/jobs/{job_id}", 2).status_code, 404)

    def test_training_rejects_private_sources_missing_versions_and_invalid_settings(self):
        self.assertEqual(self.submit(model_id=3).status_code, 404)
        self.assertEqual(self.submit(version=999).status_code, 404)
        self.assertEqual(self.submit(total_epochs=0).status_code, 422)
        self.assertEqual(self.submit(batch_size=0).status_code, 422)
        self.assertEqual(self.submit(learning_rate=-1).status_code, 422)
        self.assertEqual(self.submit(optimizer="unknown").status_code, 422)
        with self.sessions() as db:
            db.get(Dataset, 2).visibility = "private"; db.commit()
        self.assertEqual(self.submit().status_code, 404)
        with self.sessions() as db:
            db.get(Dataset, 1).supported = False; db.commit()
        self.assertEqual(self.submit(dataset_id=1).status_code, 409)

    def test_public_weight_shares_graphs_not_private_source_files_and_can_be_revoked(self):
        job_id = self.submit(dataset_id=1).json()["job"]["id"]
        weight_id = self.complete(job_id)
        self.assertEqual(self.get(f"/library/jobs/{job_id}", 2).status_code, 404)
        self.assertEqual(self.get(f"/library/weights/{weight_id}/download/pt", 2).status_code, 404)
        self.assertEqual(self.client.patch(f"/library/weights/{weight_id}/visibility", json={"visibility": "public"}, headers=self.headers(2)).status_code, 404)
        self.assertEqual(self.client.patch(f"/library/weights/{weight_id}/visibility", json={"visibility": "public"}, headers=self.headers()).status_code, 200)
        result = self.get(f"/library/jobs/{job_id}", 2).json()
        self.assertEqual(result["metrics"][0]["val_accuracy"], 60)
        self.assertNotIn("architecture_json", result["job"])
        self.assertNotIn("pt_path", result["weights"][0])
        self.assertEqual(result["weights"][0]["display_name"], "alice/Design 1")
        self.assertEqual(self.get(f"/library/weights/{weight_id}/download/pt", 2).content, b"synthetic weight")
        self.assertEqual(self.get("/library/datasets/1/download", 2).status_code, 404)
        self.assertEqual(self.get("/library/weights?scope=public", 2).json()["total"], 1)
        self.client.patch(f"/library/weights/{weight_id}/visibility", json={"visibility": "private"}, headers=self.headers())
        self.assertEqual(self.get(f"/library/jobs/{job_id}", 2).status_code, 404)
        self.assertEqual(self.get(f"/library/weights/{weight_id}/download/pt", 2).status_code, 404)

    def test_delete_weight_keeps_model_job_metrics_and_file_but_removes_public_access(self):
        job_id = self.submit().json()["job"]["id"]
        weight_id = self.complete(job_id, "public")
        self.assertEqual(self.client.delete(f"/library/weights/{weight_id}", headers=self.headers(2)).status_code, 404)
        self.assertEqual(self.client.delete(f"/library/weights/{weight_id}", headers=self.headers()).status_code, 200)
        self.assertEqual(self.get("/library/weights").json()["total"], 0)
        self.assertEqual(self.get(f"/library/jobs/{job_id}", 2).status_code, 404)
        self.assertEqual(len(self.get(f"/library/jobs/{job_id}").json()["metrics"]), 1)
        with self.sessions() as db:
            weight = db.get(ModelVersion, weight_id)
            self.assertTrue(Path(weight.pt_path).is_file())
            self.assertIsNotNone(weight.deleted_at)
            self.assertIsNone(db.get(Project, 2).deleted_at)

    def test_weight_download_rejects_path_escape_and_unsupported_json(self):
        job_id = self.submit().json()["job"]["id"]
        weight_id = self.complete(job_id, "public")
        with self.sessions() as db:
            db.get(ModelVersion, weight_id).pt_path = str(self.root / "private.pt"); db.commit()
        self.assertEqual(self.get(f"/library/weights/{weight_id}/download/pt").status_code, 404)
        self.assertEqual(self.get(f"/library/weights/{weight_id}/download/json").status_code, 422)

    def test_model_versions_are_newest_first_and_private_models_are_hidden(self):
        self.assertEqual(self.get("/library/models?scope=public").json()["total"], 1)
        self.assertEqual([row["version"] for row in self.get("/library/models/2/versions").json()["versions"]], [2, 1])
        self.assertEqual(self.get("/library/models/3/versions").status_code, 404)

    def test_clone_selected_version_creates_independent_private_version_one(self):
        result = self.client.post("/library/models/2/clone", json={"version": 1, "name": "My copy"}, headers=self.headers())
        self.assertEqual(result.status_code, 200)
        model = result.json()["model"]
        self.assertEqual((model["version"], model["display_name"], model["visibility"]), (1, "alice/My copy", "private"))
        with self.sessions() as db:
            self.assertEqual(db.get(Project, 2).version, 2)
            revision = db.query(ProjectVersion).filter_by(project_id=model["id"]).one()
            self.assertEqual((revision.owner_id, revision.version, revision.architecture_json), (1, 1, self.graph))
        self.assertEqual(self.client.post("/library/models/3/clone", json={"version": 1}, headers=self.headers()).status_code, 404)
        self.assertEqual(self.client.post("/library/models/2/clone", json={"version": 999}, headers=self.headers()).status_code, 404)

    def test_public_model_cannot_be_deleted_or_republished_by_another_user(self):
        self.assertEqual(self.client.delete("/library/models/2", headers=self.headers()).status_code, 404)
        self.assertEqual(self.client.patch("/library/models/2/visibility", json={"visibility": "private"}, headers=self.headers()).status_code, 404)
        self.assertEqual(self.client.patch("/library/models/2/visibility", json={"visibility": "private"}, headers=self.headers(2)).status_code, 200)
        self.assertEqual(self.get("/library/models/2/versions").status_code, 404)

    def test_create_and_delete_model_preserve_existing_history(self):
        created = self.client.post("/library/models", json={"name": "New", "description": "Design"}, headers=self.headers()).json()["model"]
        self.assertEqual((created["version"], created["owner_id"], created["visibility"]), (0, 1, "private"))
        self.assertEqual(self.client.patch(f'/library/models/{created["id"]}/visibility', json={"visibility": "public"}, headers=self.headers()).status_code, 409)
        self.assertEqual(self.client.delete("/library/models/1", headers=self.headers()).status_code, 200)
        self.assertEqual(self.get("/library/models/1/versions").status_code, 404)
        with self.sessions() as db:
            self.assertIsNotNone(db.get(Project, 1).deleted_at)
            self.assertEqual(db.query(ProjectVersion).filter_by(project_id=1).count(), 1)
