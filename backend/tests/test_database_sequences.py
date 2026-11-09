"""Sequence repair against disposable PostgreSQL schemas, never application rows."""
import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.schema import CreateSchema, DropSchema

from database_sequences import ID_TABLES, repair_id_sequences


@unittest.skipUnless(os.getenv("WORKER_TEST_POSTGRES") == "1", "Requires isolated PostgreSQL tests")
class SequenceRepairTests(unittest.TestCase):
    def setUp(self):
        self.admin = create_engine(os.environ["DATABASE_URL"])
        self.schema = "sequence_test_" + uuid4().hex
        with self.admin.begin() as connection:
            connection.execute(CreateSchema(self.schema))
        self.engine = create_engine(os.environ["DATABASE_URL"],
                                   connect_args={"options": f"-csearch_path={self.schema}"})
        self.addCleanup(self.cleanup_schema)
        with self.engine.begin() as connection:
            for table in ID_TABLES:
                connection.execute(text(f"CREATE TABLE {table} (id SERIAL PRIMARY KEY, label TEXT)"))

    def cleanup_schema(self):
        self.engine.dispose()
        with self.admin.begin() as connection:
            connection.execute(DropSchema(self.schema, cascade=True))
        self.admin.dispose()

    def test_imported_ids_repaired_for_every_table_without_changing_rows(self):
        with self.engine.begin() as connection:
            for table in ID_TABLES:
                connection.execute(text(f"INSERT INTO {table} (id, label) VALUES (1, 'old'), (70, 'imported')"))
        self.assertEqual(len(repair_id_sequences(self.engine)), len(ID_TABLES))
        self.assertEqual(repair_id_sequences(self.engine), [])
        with self.engine.begin() as connection:
            for table in ID_TABLES:
                self.assertEqual(connection.execute(text(f"INSERT INTO {table} (label) VALUES ('new') RETURNING id")).scalar(), 71)
                self.assertEqual(connection.execute(text(f"SELECT label FROM {table} WHERE id = 70")).scalar(), "imported")

    def test_empty_and_advanced_sequences_are_not_rewound(self):
        self.assertEqual(repair_id_sequences(self.engine), [])
        with self.engine.begin() as connection:
            connection.execute(text("INSERT INTO training_jobs DEFAULT VALUES"))
            connection.execute(text("DELETE FROM training_jobs"))
            connection.execute(text("ALTER SEQUENCE training_metrics_id_seq RESTART WITH 100"))
            connection.execute(text("INSERT INTO training_metrics (id) VALUES (50)"))
        self.assertEqual(repair_id_sequences(self.engine), [])
        with self.engine.begin() as connection:
            self.assertEqual(connection.execute(text("INSERT INTO training_jobs DEFAULT VALUES RETURNING id")).scalar(), 2)
            self.assertEqual(connection.execute(text("INSERT INTO training_metrics DEFAULT VALUES RETURNING id")).scalar(), 100)

    def test_simultaneous_repairs_serialize(self):
        with self.engine.begin() as connection:
            connection.execute(text("INSERT INTO training_jobs (id) VALUES (11)"))
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: repair_id_sequences(self.engine), range(2)))
        self.assertEqual(sum(len(result) for result in results), 1)
        with self.engine.begin() as connection:
            self.assertEqual(connection.execute(text("INSERT INTO training_jobs DEFAULT VALUES RETURNING id")).scalar(), 12)
