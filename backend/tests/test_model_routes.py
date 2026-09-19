"""Model API checks use an in-memory database and temporary, synthetic files only."""

from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from zipfile import ZipFile

from fastapi import FastAPI
from fastapi.testclient import TestClient
import onnx
from onnx import TensorProto, helper
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database import get_db
import model_routes
from models import Base, ModelVersion, Project, TrainingJob, TrainingMetric


class ModelRoutesTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.folder = self.root / "models/user_2/project_1/version_3"
        self.folder.mkdir(parents=True)
        self.pt = self.folder / "model.pt"
        self.pt.write_bytes(b"synthetic PT fixture")
        self.onnx = self.folder / "model.onnx"
        graph = helper.make_graph([], "test", [], [])
        onnx.save(helper.make_model(graph), self.onnx)
        patcher = patch.object(model_routes, "STORAGE_ROOT", self.root)
        patcher.start()
        self.addCleanup(patcher.stop)
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        self.addCleanup(engine.dispose)
        Base.metadata.create_all(engine)
        self.session = sessionmaker(bind=engine)
        with self.session() as db:
            db.add(Project(id=1, owner_id=2, name="Test project"))
            db.add(TrainingJob(id=4, owner_id=2, project_id=1, dataset_id=5, status="completed"))
            db.add(TrainingMetric(training_job_id=4, epoch=1, train_loss=0.5))
            db.add(ModelVersion(id=9, owner_id=2, project_id=1, dataset_id=5,
                                training_job_id=4, name="Model v3", version=3,
                                pt_path=str(self.pt), onnx_path=str(self.onnx)))
            db.commit()

        def get_test_db():
            with self.session() as db:
                yield db

        app = FastAPI()
        app.include_router(model_routes.router)
        app.dependency_overrides[get_db] = get_test_db
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.base = "/training/projects/1/models/9"

    def download(self, file_format="pt", owner=2):
        return self.client.get(f"{self.base}/download/{file_format}?owner_id={owner}")

    def change_model(self, **changes):
        with self.session() as db:
            model = db.get(ModelVersion, 9)
            for key, value in changes.items():
                setattr(model, key, value)
            db.commit()

    def external_graph(self, location="model.onnx.data"):
        tensor = TensorProto(name="weights", data_type=TensorProto.FLOAT, dims=[1], data_location=TensorProto.EXTERNAL)
        tensor.external_data.add(key="location", value=location)
        graph = helper.make_graph([], "test", [], [], initializer=[tensor])
        # Serialize without asking ONNX to read or write the synthetic sidecar.
        self.onnx.write_bytes(helper.make_model(graph).SerializeToString())

    def test_download_pt_and_self_contained_onnx(self):
        response = self.download()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, self.pt.read_bytes())
        self.assertIn('filename="project-1-model-9-v3.pt"', response.headers["content-disposition"])
        response = self.download("onnx")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, self.onnx.read_bytes())
        self.assertIn(".onnx", response.headers["content-disposition"])

    def test_external_onnx_download_contains_all_weights_and_cleans_temporary_archive(self):
        self.external_graph("weights/part.data")
        weights = self.folder / "weights/part.data"
        weights.parent.mkdir()
        weights.write_bytes(b"\x00\x00\x80\x3f")
        archives = []
        original = model_routes.NamedTemporaryFile

        def temporary_archive(**kwargs):
            file = original(**kwargs)
            archives.append(Path(file.name))
            return file

        with patch.object(model_routes, "NamedTemporaryFile", temporary_archive):
            response = self.download("onnx")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "application/zip")
        with ZipFile(BytesIO(response.content)) as archive:
            self.assertEqual(set(archive.namelist()), {"model.onnx", "weights/part.data"})
            self.assertEqual(archive.read("weights/part.data"), weights.read_bytes())
        self.assertTrue(archives)
        self.assertTrue(all(not path.exists() for path in archives))

    def test_wrong_owner_project_or_model_cannot_download_or_delete(self):
        self.assertEqual(self.download(owner=3).status_code, 404)
        self.assertEqual(self.client.delete(f"{self.base}?owner_id=3").status_code, 404)
        for base in ["/training/projects/2/models/9", "/training/projects/1/models/999"]:
            self.assertEqual(self.client.get(f"{base}/download/pt?owner_id=2").status_code, 404)
            self.assertEqual(self.client.delete(f"{base}?owner_id=2").status_code, 404)
        self.assertEqual(self.download("checkpoint").status_code, 422)
        self.assertEqual(self.client.get(f"{self.base}/download/pt").status_code, 422)

    def test_missing_disabled_and_outside_storage_files_are_rejected(self):
        self.change_model(allow_download=False)
        self.assertEqual(self.download().status_code, 403)
        self.change_model(allow_download=True, pt_path=None)
        self.assertEqual(self.download().status_code, 404)
        self.change_model(pt_path=str(self.folder / "missing.pt"))
        self.assertEqual(self.download().status_code, 404)
        other = self.root / "private.pt"
        other.write_bytes(b"must not be served")
        self.change_model(pt_path=str(other))
        self.assertEqual(self.download().status_code, 404)
        link = self.folder / "redirect.pt"
        link.symlink_to(other)
        self.change_model(pt_path=str(link))
        self.assertEqual(self.download().status_code, 404)

    def test_external_onnx_missing_weights_and_traversal_are_rejected(self):
        self.external_graph()
        self.assertEqual(self.download("onnx").status_code, 404)
        self.external_graph("../private.data")
        self.assertEqual(self.download("onnx").status_code, 409)
        self.external_graph("/etc/passwd")
        self.assertEqual(self.download("onnx").status_code, 409)
        self.onnx.write_bytes(b"invalid ONNX")
        self.assertEqual(self.download("onnx").status_code, 409)

    def test_delete_is_recoverable_and_preserves_training_history_and_version(self):
        response = self.client.delete(f"{self.base}?owner_id=2")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["success"])
        self.assertEqual(self.download().status_code, 404)
        self.assertEqual(self.client.delete(f"{self.base}?owner_id=2").status_code, 404)
        with self.session() as db:
            model = db.get(ModelVersion, 9)
            self.assertIsNotNone(model.deleted_at)
            self.assertEqual(model.version, 3)
            self.assertEqual(db.query(ModelVersion).filter(ModelVersion.deleted_at.is_(None)).count(), 0)
            self.assertEqual(db.query(TrainingJob).count(), 1)
            self.assertEqual(db.query(TrainingMetric).count(), 1)
        self.assertTrue(self.pt.is_file())
        self.assertTrue(self.onnx.is_file())


if __name__ == "__main__":
    unittest.main()
