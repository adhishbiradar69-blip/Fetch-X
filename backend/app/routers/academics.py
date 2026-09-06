from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.mark import Mark
from app.models.student import Student
from app.models.class_ import Class
from app.models.subject import Subject
from app.models.grade_subject import GradeSubject
from app.models.exam import Exam
from app.schemas.admin import BulkMarksCreate
from app.dependencies import (
    get_current_user, require_role, assert_class_access, assert_student_access,
)

router = APIRouter(prefix="/academics", tags=["academics"])
_write = require_role("class_teacher", "super_admin", "school_admin")


# ── Subjects (global list) ───────────────────────────────────
@router.get("/subjects")
def list_subjects(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return [{"id": s.id, "name": s.name, "color": s.color}
            for s in db.query(Subject).order_by(Subject.id).all()]


# ── Grade subjects (subjects configured for a grade in a school) ─
@router.get("/grade/{school_id}/{grade}/subjects")
def grade_subjects(school_id: int, grade: int, db: Session = Depends(get_db),
                   user=Depends(get_current_user)):
    # School-scope: staff only see their own school's subject configuration
    # (super_admin / chairperson may see any).
    if user.role == "school_admin" and user.school_id != school_id:
        raise HTTPException(status_code=403, detail="You can only view your own school's subjects.")
    if user.role == "principal" and user.school_id != school_id:
        raise HTTPException(status_code=403, detail="You can only view your own school's subjects.")
    if user.role == "class_teacher":
        my = db.query(Class).filter(Class.id == user.assigned_class_id).first() if user.assigned_class_id else None
        if not my or my.school_id != school_id:
            raise HTTPException(status_code=403, detail="You can only view your own school's subjects.")
    if user.role == "parent":
        raise HTTPException(status_code=403, detail="You do not have permission to access this resource.")
    rows = db.query(GradeSubject).filter(
        GradeSubject.school_id == school_id, GradeSubject.grade == grade
    ).all()
    out = []
    for gs in rows:
        sub = db.query(Subject).filter(Subject.id == gs.subject_id).first()
        if sub:
            out.append({"id": sub.id, "name": sub.name, "color": sub.color})
    return out


# ── Exams for a class's grade ─────────────────────────────────
@router.get("/class/{class_id}/exams")
def class_exams(class_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    cls = db.query(Class).filter(Class.id == class_id).first()
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found")
    assert_class_access(user, cls)
    rows = db.query(Exam).filter(
        Exam.school_id == cls.school_id, Exam.grade == cls.grade
    ).order_by(Exam.id).all()
    return [{"id": e.id, "name": e.name, "max_score": e.max_score, "term": e.term,
             "grade": e.grade, "school_id": e.school_id} for e in rows]


# ── Marks for a class + exam ──────────────────────────────────
@router.get("/class/{class_id}/marks")
def class_marks(class_id: int, exam_id: int, db: Session = Depends(get_db),
               user=Depends(get_current_user)):
    cls = db.query(Class).filter(Class.id == class_id).first()
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found")
    assert_class_access(user, cls)
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    if exam.school_id != cls.school_id:
        raise HTTPException(status_code=400, detail="Exam does not belong to this class's school.")

    # subjects for this grade
    gs_rows = db.query(GradeSubject).filter(
        GradeSubject.school_id == cls.school_id, GradeSubject.grade == cls.grade
    ).all()
    subjects = []
    for gs in gs_rows:
        sub = db.query(Subject).filter(Subject.id == gs.subject_id).first()
        if sub:
            subjects.append(sub)

    students = db.query(Student).filter(Student.class_id == class_id).order_by(Student.roll_no).all()
    marks = db.query(Mark).filter(Mark.exam_id == exam_id).all()
    mark_map = {(m.student_id, m.subject_id): m.score for m in marks}

    return {
        "exam_id": exam.id,
        "exam_name": exam.name,
        "max_score": exam.max_score,
        "term": exam.term,
        "subjects": [{"id": s.id, "name": s.name, "color": s.color} for s in subjects],
        "students": [
            {"id": s.id, "name": s.name,
             "marks": {str(sub.id): mark_map.get((s.id, sub.id)) for sub in subjects}}
            for s in students
        ],
    }


# ── Bulk save marks (class teacher enters scores) ────────────
@router.post("/marks/bulk")
def save_bulk_marks(data: BulkMarksCreate, db: Session = Depends(get_db), user=Depends(_write)):
    cls = db.query(Class).filter(Class.id == data.class_id).first()
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found")
    # IDOR guard: only the class's teacher / school admins may write marks.
    assert_class_access(user, cls, write=True)
    exam = db.query(Exam).filter(Exam.id == data.exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    if exam.school_id != cls.school_id:
        raise HTTPException(status_code=400, detail="Exam does not belong to this class's school.")

    # Valid students & subjects for this class — anything else is rejected
    # so marks can't be forged for other classes/schools via raw ids.
    valid_student_ids = {s.id for s in
                         db.query(Student).filter(Student.class_id == data.class_id).all()}
    valid_subject_ids = {gs.subject_id for gs in db.query(GradeSubject).filter(
        GradeSubject.school_id == cls.school_id, GradeSubject.grade == cls.grade).all()}
    if not valid_subject_ids:
        raise HTTPException(status_code=400, detail="No subjects configured for this class's grade.")

    seen_pairs = set()
    for item in data.marks:
        if item.score < 0 or item.score > exam.max_score:
            raise HTTPException(status_code=400,
                                detail=f"Score {item.score} out of range for exam max {exam.max_score}")
        if item.student_id not in valid_student_ids:
            raise HTTPException(status_code=400, detail="Student does not belong to this class.")
        if item.subject_id not in valid_subject_ids:
            raise HTTPException(status_code=400, detail="Subject is not configured for this class's grade.")
        pair = (item.student_id, item.subject_id)
        if pair in seen_pairs:
            continue
        seen_pairs.add(pair)
        existing = db.query(Mark).filter(
            Mark.student_id == item.student_id,
            Mark.subject_id == item.subject_id,
            Mark.exam_id == data.exam_id,
        ).first()
        if existing:
            existing.score = item.score
        else:
            db.add(Mark(student_id=item.student_id, subject_id=item.subject_id,
                        exam_id=data.exam_id, score=item.score))
    db.commit()
    return {"status": "saved", "count": len(seen_pairs)}


# ── Single student marks (parent view + class report) ───────
@router.get("/student/{student_id}")
def student_marks(student_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    # IDOR guard: parent → own child, staff → own scope.
    assert_student_access(user, student, db)
    marks = db.query(Mark).filter(Mark.student_id == student_id).all()
    out = []
    for m in marks:
        sub = db.query(Subject).filter(Subject.id == m.subject_id).first()
        exam = db.query(Exam).filter(Exam.id == m.exam_id).first()
        max_score = exam.max_score if exam else 100
        pct = round((m.score / max_score) * 100, 1) if max_score else 0
        out.append({
            "exam": exam.name if exam else "Unknown",
            "subject": sub.name if sub else "General",
            "subject_color": sub.color if sub else "#64748b",
            "score": m.score, "max": max_score, "percentage": pct,
            "term": exam.term if exam else None,
        })
    return out


# ── Class report (averages + grade per student) ──────────────
@router.get("/class/{class_id}/report")
def class_report(class_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    cls = db.query(Class).filter(Class.id == class_id).first()
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found")
    assert_class_access(user, cls)
    students = db.query(Student).filter(Student.class_id == class_id).all()

    # figure out max_score baseline (use the first exam's max, or 100)
    exams = db.query(Exam).filter(
        Exam.school_id == cls.school_id, Exam.grade == cls.grade
    ).all()
    baseline_max = exams[0].max_score if exams else 100

    result = []
    for s in students:
        marks = db.query(Mark).filter(Mark.student_id == s.id).all()
        if marks:
            # average as percentage of each exam's max, then overall
            pcts = []
            for m in marks:
                ex = next((e for e in exams if e.id == m.exam_id), None)
                mx = ex.max_score if ex else baseline_max
                pcts.append((m.score / mx) * 100 if mx else 0)
            avg_pct = round(sum(pcts) / len(pcts), 1)
        else:
            avg_pct = 0
        result.append({
            "student_id": s.id, "name": s.name,
            "average_score": avg_pct, "exams": len(set(m.exam_id for m in marks)),
        })
    return result
