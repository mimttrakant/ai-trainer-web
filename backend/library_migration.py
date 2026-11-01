from sqlalchemy import text


def migrate_library(engine):
    # Additive; existing datasets/designs remain private.
    statements = [
        "ALTER TABLE datasets ADD COLUMN IF NOT EXISTS visibility VARCHAR NOT NULL DEFAULT 'private'",
        "ALTER TABLE datasets ADD COLUMN IF NOT EXISTS url_provider VARCHAR",
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS visibility VARCHAR NOT NULL DEFAULT 'private'",
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP",
        "ALTER TABLE training_jobs ADD COLUMN IF NOT EXISTS source_project_owner_id INTEGER",
        "ALTER TABLE training_jobs ADD COLUMN IF NOT EXISTS source_dataset_owner_id INTEGER",
    ]
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))
