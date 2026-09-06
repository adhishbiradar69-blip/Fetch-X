from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.student import Student
from app.models.class_ import Class
from app.models.mark import Mark
from app.models.exam import Exam
from app.models.subject import Subject
from app.models.attendance import Attendance
from app.dependencies import get_current_user, require_role

router = APIRouter(prefix="/parent", tags=["parent"])
_allowed = require_role("parent", "super_admin", "school_admin")


def _child_of(user: User, db: Session):
    if user.role in ("super_admin", "school_admin"):
        # admin preview: pick first student (optionally scoped to school)
        q = db.query(Student)
        if user.role == "school_admin" and user.school_id:
            q = q.join(Class, Class.id == Student.class_id).filter(Class.school_id == user.school_id)
        s = q.first()
        if not s:
            raise HTTPException(status_code=404, detail="No students in the system yet.")
        return s
    # Real parents: deterministic pick (lowest id) of their linked children.
    student = (db.query(Student)
               .filter(Student.parent_user_id == user.id)
               .order_by(Student.id)
               .first())
    if not student:
        raise HTTPException(status_code=404, detail="No child is linked to your account.")
    return student


@router.get("/child")
def my_child(db: Session = Depends(get_db), user=Depends(_allowed)):
    student = _child_of(user, db)
    cls = db.query(Class).filter(Class.id == student.class_id).first()
    marks = db.query(Mark).filter(Mark.student_id == student.id).all()
    attendance = db.query(Attendance).filter(Attendance.student_id == student.id).all()

    marks_out = []
    for m in marks:
        sub = db.query(Subject).filter(Subject.id == m.subject_id).first()
        ex = db.query(Exam).filter(Exam.id == m.exam_id).first()
        max_score = ex.max_score if ex else 100
        pct = round((m.score / max_score) * 100, 1) if max_score else 0
        marks_out.append({
            "exam": ex.name if ex else "Unknown",
            "subject": sub.name if sub else "General",
            "subject_color": sub.color if sub else "#64748b",
            "score": m.score, "max": max_score, "percentage": pct,
            "term": ex.term if ex else None,
        })

    present = len([a for a in attendance if a.status == "P"])
    att_rate = round((present / len(attendance)) * 100, 1) if attendance else 0

    avg_pct = 0
    if marks_out:
        avg_pct = round(sum(m["percentage"] for m in marks_out) / len(marks_out), 1)

    return {
        "student": {"id": student.id, "name": student.name, "roll_no": student.roll_no},
        "class": {"id": cls.id, "grade": cls.grade, "section": cls.section,
                  "label": f"Grade {cls.grade}-{cls.section}"} if cls else None,
        "marks": marks_out,
        "attendance": {"total": len(attendance), "present": present, "rate": att_rate},
        "average_percentage": avg_pct,
    }
