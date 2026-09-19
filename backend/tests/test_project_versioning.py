"""Actual API / migration checks in a disposable PostgreSQL schema, never public."""

from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
import os
from pathlib import Path
import re
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.schema import CreateSchema, DropSchema

import database
from models import Base, Dataset, ModelVersion, Project, ProjectVersion, TrainingJob, User
from project_versioning import migrate_project_versions


@unittest.skipUnless(os.getenv("WORKER_TEST_POSTGRES") == "1", "Requires disposable PostgreSQL schema tests.")
class ProjectVersioningTests(unittest.TestCase):
    def setUp(self):
        self.admin = create_engine(os.environ["DATABASE_URL"])
        self.addCleanup(self.admin.dispose)
        self.schema = "version_test_" + uuid4().hex
        with self.admin.begin() as connection:
            connection.execute(CreateSchema(self.schema))
        self.addCleanup(self.drop_schema)
        self.engine = create_engine(os.environ["DATABASE_URL"], connect_args={"options": f"-csearch_path={self.schema}"})
        self.addCleanup(self.engine.dispose)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine)
        # Execute main's real route definitions/migrations against this private
        # schema. No module-global database writes target the public schema.
        spec = importlib.util.spec_from_file_location("version_test_main", Path(__file__).parents[1] / "main.py")
        main = importlib.util.module_from_spec(spec)
        with patch.object(database, "engine", self.engine):
            spec.loader.exec_module(main)

        def test_db():
            with self.sessions() as db:
                yield db

        main.app.dependency_overrides[database.get_db] = test_db
        self.client = TestClient(main.app)
        self.addCleanup(self.client.close)
        with self.sessions() as db:
            db.add(User(id=1, username="Version test", email="version@example.com"))
            db.add(Dataset(id=1, owner_id=1, name="Synthetic", source_type="upload", supported=True))
            db.commit()
        self.project = self.client.post("/projects", json={"name": "Test project", "description": "", "owner_id": 1}).json()["project"]
        self.id = self.project["id"]
        self.graph = json.dumps({"nodes": [{"id": "input", "data": {"layerType": "Input"}}], "edges": []})

    def drop_schema(self):
        if not re.fullmatch(r"version_test_[0-9a-f]{32}", self.schema):
            raise RuntimeError("Invalid disposable schema")
        with self.admin.begin() as connection:
            connection.execute(DropSchema(self.schema, cascade=True))

    def save(self, expected, name="My classifier", graph=None, owner=1):
        return self.client.put(f"/projects/{self.id}/architecture", json={
            "owner_id": owner, "expected_version": expected, "model_name": name,
            "architecture_json": graph if graph is not None else self.graph,
        })

    def test_each_save_increments_and_preserves_history(self):
        self.assertEqual(self.project["version"], 0)
        for previous in range(3):
            result = self.save(previous, name=f"Classifier {previous + 1}")
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.json()["version"], previous + 1)
        project = self.client.get(f"/project/{self.id}").json()["project"]
        self.assertEqual(project["version"], 3)
        self.assertEqual(project["model_name"], "Classifier 3")
        with self.sessions() as db:
            versions = db.query(ProjectVersion).order_by(ProjectVersion.version).all()
            self.assertEqual([v.version for v in versions], [1, 2, 3])
            self.assertEqual([v.model_name for v in versions], ["Classifier 1", "Classifier 2", "Classifier 3"])

    def test_failed_invalid_and_unauthorized_saves_do_not_increment(self):
        for graph in ["invalid", "[]", "{}", '{"nodes": [], "edges": []}', '{"nodes": [{"id": "x"}], "edges": []}']:
            self.assertEqual(self.save(0, graph=graph).status_code, 422)
        self.assertEqual(self.save(0, name=" ").status_code, 422)
        self.assertEqual(self.save(0, owner=999).status_code, 404)
        self.assertEqual(self.save(3).status_code, 409)
        self.assertEqual(self.client.get(f"/project/{self.id}").json()["project"]["version"], 0)

    def test_concurrent_tabs_cannot_overwrite_or_allocate_duplicate_versions(self):
        with ThreadPoolExecutor(2) as pool:
            responses = list(pool.map(lambda _: self.save(0), range(2)))
        self.assertEqual(sorted(response.status_code for response in responses), [200, 409])
        self.assertEqual(self.save(1).json()["version"], 2)
        with self.sessions() as db:
            self.assertEqual(db.query(ProjectVersion).count(), 2)

    def test_queued_job_keeps_its_original_name_version_and_architecture(self):
        self.save(0, "Original classifier")
        result = self.client.post("/training/jobs", json={"owner_id": 1, "project_id": self.id, "dataset_id": 1})
        self.assertTrue(result.json()["success"])
        job = result.json()["job"]
        self.assertEqual(job["project_version"], 1)
        new_graph = json.dumps({"nodes": [{"id": "different", "data": {"layerType": "Input"}}], "edges": []})
        self.save(1, "Changed classifier", new_graph)
        with self.sessions() as db:
            queued = db.get(TrainingJob, job["id"])
            self.assertEqual(queued.project_version, 1)
            self.assertEqual(queued.model_name, "Original classifier")
            self.assertEqual(queued.architecture_json, self.graph)
            db.add(ModelVersion(owner_id=1, project_id=self.id, dataset_id=1, training_job_id=queued.id,
                                name=queued.model_name, version=1, project_version=queued.project_version))
            db.commit()
        models = self.client.get(f"/training/projects/{self.id}/models?owner_id=1").json()["models"]
        self.assertEqual(models[0]["project_version"], 1)

    def test_baseline_migration_is_repeatable_and_does_not_invent_legacy_provenance(self):
        with self.sessions() as db:
            project = db.get(Project, self.id)
            project.architecture_json = self.graph
            project.model_name = None
            db.add(TrainingJob(owner_id=1, project_id=self.id, dataset_id=1, status="completed"))
            db.commit()
        migrate_project_versions(self.engine)
        migrate_project_versions(self.engine)
        with self.sessions() as db:
            self.assertEqual(db.get(Project, self.id).version, 1)
            self.assertEqual(db.query(ProjectVersion).count(), 1)
            self.assertIsNone(db.query(TrainingJob).one().project_version)
        self.assertEqual(self.save(1).json()["version"], 2)


if __name__ == "__main__":
    unittest.main()
