"""Repair PostgreSQL serial IDs after a data import, without changing stored rows."""
from sqlalchemy import text


ID_TABLES = (
    "datasets", "model_versions", "project_versions", "projects",
    "training_jobs", "training_metrics", "users",
)


def repair_id_sequences(engine):
    if engine.dialect.name != "postgresql":
        return []
    repaired = []
    quote = engine.dialect.identifier_preparer.quote
    with engine.begin() as connection:
        connection.execute(text("SET LOCAL lock_timeout = '5s'"))
        # Acquire in a stable order. Normal INSERTs must wait until the new
        # counters commit; simultaneous repairs cannot inspect stale counters.
        tables = ", ".join(quote(name) for name in ID_TABLES)
        connection.execute(text(f"LOCK TABLE {tables} IN SHARE ROW EXCLUSIVE MODE"))
        for table in ID_TABLES:
            sequence = connection.execute(text("""
                SELECT n.nspname, c.relname, s.seqincrement
                FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                JOIN pg_sequence s ON s.seqrelid = c.oid
                WHERE c.oid = pg_get_serial_sequence(:table, 'id')::regclass
            """), {"table": table}).first()
            if sequence is None:
                continue
            if sequence.seqincrement != 1:
                raise ValueError(f"Unexpected ID sequence increment for {table}")
            sequence_sql = f"{quote(sequence.nspname)}.{quote(sequence.relname)}"
            last, called = connection.execute(text(
                f"SELECT last_value, is_called FROM {sequence_sql}"
            )).one()
            highest = connection.execute(text(f"SELECT max(id) FROM {quote(table)}")).scalar()
            next_id = last + 1 if called else last
            if highest is not None and next_id <= highest:
                next_id = int(highest) + 1
                # Unlike setval, RESTART rolls back if this transaction fails.
                # Never lower a sequence, including after records were deleted.
                connection.execute(text(f"ALTER SEQUENCE {sequence_sql} RESTART WITH {next_id}"))
                repaired.append({"table": table, "next_id": next_id})
    return repaired


if __name__ == "__main__":
    from database import engine
    changes = repair_id_sequences(engine)
    for change in changes:
        print(f"{change['table']}: next ID = {change['next_id']}")
    if not changes:
        print("All automatic ID counters are already ahead of existing records.")
