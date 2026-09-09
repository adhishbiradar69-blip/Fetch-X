"""Developer-only group stats for the /group Command Center pagehead.

The designer's developer build hardcodes its pagehead counts ("across all
3 schools"); the port replaces them with live numbers so the dev console
subtitle stays honest:

    GET /group/summary → {"schools": n, "classes": n, "students": n,
                          "teachers": n}

super_admin only — the console is super_admin-gated on the client, but the
API never trusts that. Counts are plain SQLAlchemy counts over the seeded
demo data: teachers are the class_teacher accounts (the app's only teaching
role, 30 per school in seed_demo.py); principals / admins are staff, not
teachers. The client degrades gracefully if this endpoint is unavailable —
the pagehead simply keeps its per-tier subtitle without the counts.
"""

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_role
from app.models.class_ import Class
from app.models.school import School
from app.models.student import Student
from app.models.user import User

router = APIRouter(prefix="/group", tags=["developer"])
_allowed = require_role("super_admin")


@router.get("/summary")
def group_summary(db: Session = Depends(get_db), user=Depends(_allowed)):
    """Live group-wide counts for the developer console pagehead."""
    teachers = db.query(func.count(User.id)).filter(User.role == "class_teacher").scalar()
    return {
        "schools": db.query(func.count(School.id)).scalar() or 0,
        "classes": db.query(func.count(Class.id)).scalar() or 0,
        "students": db.query(func.count(Student.id)).scalar() or 0,
        "teachers": teachers or 0,
    }
