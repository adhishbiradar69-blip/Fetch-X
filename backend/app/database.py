from sqlalchemy import create_engine, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy import event

SQLALCHEMY_DATABASE_URL = "sqlite:///./school.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    """Enforce foreign keys + WAL on every new SQLite connection.

    SQLite ships with FK enforcement OFF per-connection, which silently turns
    every ForeignKey column decorative (orphans on delete). WAL improves
    concurrent read throughput for the dashboard-heavy workload.
    """
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def ensure_unique_indexes() -> None:
    """Startup migration: dedupe historical rows, then add the unique
    constraints the write paths rely on.

    - attendance(student_id, date)  — one record per student per day
    - marks(student_id, subject_id, exam_id) — one score per cell

    Without them, two near-simultaneous POSTs could both pass the
    read-then-write check and insert duplicates, silently double-counting
    every average and percentage in the analytics.
    Safe to call on every boot: duplicate rows (if any) are collapsed to the
    newest, then `CREATE UNIQUE INDEX IF NOT EXISTS` is a no-op afterwards.
    """
    dedupe_sql = [
        # keep the highest-id (newest) row per (student, date)
        ("attendance", "student_id, date",
         "DELETE FROM attendance WHERE id NOT IN (SELECT MAX(id) FROM attendance GROUP BY student_id, date)"),
        ("marks", "student_id, subject_id, exam_id",
         "DELETE FROM marks WHERE id NOT IN (SELECT MAX(id) FROM marks GROUP BY student_id, subject_id, exam_id)"),
    ]
    index_sql = [
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_student_date ON attendance (student_id, date)",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_marks_student_subject_exam ON marks (student_id, subject_id, exam_id)",
    ]
    with engine.begin() as conn:
        for _table, _cols, stmt in dedupe_sql:
            try:
                conn.execute(text(stmt))
            except Exception as exc:  # table missing on a brand-new DB
                print(f"[warn] dedupe skipped: {exc}")
        for stmt in index_sql:
            try:
                conn.execute(text(stmt))
            except Exception as exc:
                print(f"[warn] index creation skipped: {exc}")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
