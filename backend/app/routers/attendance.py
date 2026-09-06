from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import date, timedelta
from typing import Optional
from app.database import get_db
from app.models.attendance import Attendance
from app.models.student import Student
from app.models.class_ import Class
from app.models.user import User
from app.schemas.attendance import AttendanceBulkCreate
from app.dependencies import (
    get_current_user, require_role, assert_class_access, assert_student_access,
)

router = APIRouter(prefix="/attendance", tags=["attendance"])
_write = require_role("class_teacher", "super_admin", "school_admin")

_VALID_STATUS = {"P", "A", "L"}


@router.get("/teacher/classes")
def get_teacher_classes(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Classes the caller may work with in the teacher boards.

    class_teacher → classes they teach (incl. their assigned_class_id);
    school_admin → their own school's classes; super_admin → all classes.
    No cross-tenant fallback: returning the global class list to any
    authenticated user handed attackers the id map for every IDOR below.
    """
    q = db.query(Class)
    if user.role == "class_teacher":
        q = q.filter((Class.class_teacher_id == user.id) | (Class.id == user.assigned_class_id))
    elif user.role == "school_admin":
        if user.school_id is None:
            return []
        q = q.filter(Class.school_id == user.school_id)
    elif user.role == "super_admin":
        pass  # site owner: all classes
    else:
        return []  # principal / chairperson / parent have no teacher boards
    classes = q.order_by(Class.school_id, Class.grade, Class.section).all()
    return [{"id": c.id, "grade": c.grade, "section": c.section,
             "label": f"Grade {c.grade}-{c.section}"} for c in classes]


@router.post("/mark")
def mark_attendance(data: AttendanceBulkCreate, db: Session = Depends(get_db), user=Depends(_write)):
    cls = db.query(Class).filter(Class.id == data.class_id).first()
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found")
    # IDOR guard: class must belong to the caller's school / assignment.
    assert_class_access(user, cls, write=True)
    if data.date > date.today():
        raise HTTPException(status_code=400, detail="Attendance cannot be marked for a future date.")

    # Dedupe the payload first so duplicate student_ids don't trip the
    # count check below (and would otherwise double-write).
    seen = set()
    marks = []
    for m in data.marks:
        if m.student_id in seen:
            continue
        seen.add(m.student_id)
        if m.status is not None and m.status not in _VALID_STATUS:
            raise HTTPException(status_code=400, detail="Status must be one of P, A, L (or null to unmark).")
        marks.append(m)

    student_ids = [m.student_id for m in marks]
    students = db.query(Student).filter(Student.id.in_(student_ids), Student.class_id == data.class_id).all()
    if len(students) != len(student_ids):
        raise HTTPException(status_code=400, detail="Invalid student IDs for this class")

    for mark in marks:
        existing = db.query(Attendance).filter(
            Attendance.student_id == mark.student_id, Attendance.date == data.date
        ).first()
        if not mark.status:
            # UNMARK contract: null/empty status removes the record entirely
            # (used by the week board's Clear-week tool)
            if existing:
                db.delete(existing)
            continue
        if existing:
            existing.status = mark.status
            existing.marked_by = user.id
        else:
            db.add(Attendance(student_id=mark.student_id, date=data.date,
                              status=mark.status, marked_by=user.id))
    db.commit()
    return {"status": "saved", "date": str(data.date), "count": len(marks)}


@router.get("/class/{class_id}")
def get_class_attendance(class_id: int, date: date, db: Session = Depends(get_db),
                         user=Depends(get_current_user)):
    cls = db.query(Class).filter(Class.id == class_id).first()
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found")
    assert_class_access(user, cls)
    students = db.query(Student).filter(Student.class_id == class_id).all()
    records = db.query(Attendance).filter(
        Attendance.date == date,
        Attendance.student_id.in_([s.id for s in students])
    ).all()
    att_map = {a.student_id: a.status for a in records}
    return {
        "date": str(date),
        "students": [{"id": s.id, "name": s.name, "status": att_map.get(s.id, "Not Marked")}
                     for s in students]
    }


@router.get("/week/{class_id}")
def get_class_week(class_id: int, start: Optional[date] = None,
                   db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Mon-Fri attendance grid for the week containing `start` (default today).

    Returns one row per student with a status list aligned to `days`
    (None = not marked) plus a per-student week rate, so the class teacher's
    weekly board can render the whole week in one request.
    """
    cls = db.query(Class).filter(Class.id == class_id).first()
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found")
    assert_class_access(user, cls)

    anchor = start or date.today()
    monday = anchor - timedelta(days=anchor.weekday())
    days = [monday + timedelta(days=i) for i in range(5)]  # Mon..Fri
    day_keys = [d.isoformat() for d in days]

    students = db.query(Student).filter(Student.class_id == class_id).order_by(Student.id).all()
    ids = [s.id for s in students]
    by_sid: dict[int, dict[str, str]] = {}
    if ids:
        records = (db.query(Attendance.student_id, Attendance.date, Attendance.status)
                   .filter(Attendance.student_id.in_(ids),
                           Attendance.date >= days[0], Attendance.date <= days[-1])
                   .all())
        for sid, dt, st in records:
            key = dt.isoformat() if hasattr(dt, "isoformat") else str(dt)
            by_sid.setdefault(sid, {})[key] = st

    rows = []
    for s in students:
        cell = by_sid.get(s.id, {})
        statuses = [cell.get(k) for k in day_keys]
        marked = [x for x in statuses if x is not None]
        present = sum(1 for x in marked if x == "P")
        rows.append({
            "id": s.id, "name": s.name, "days": statuses,
            "week_rate": round(present / len(marked) * 100, 0) if marked else None,
        })
    return {"start": day_keys[0], "days": day_keys, "students": rows}


@router.get("/trend/{class_id}")
def get_attendance_trend(class_id: int, weeks: int = 6,
                         db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Per-week present% for the last `weeks` (1-12) Mon-Fri windows,
    oldest → newest, current week last. Feeds the principal's attendance
    trend sparkline — one grouped query, week bucketing done in Python."""
    cls = db.query(Class).filter(Class.id == class_id).first()
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found")
    assert_class_access(user, cls)

    weeks = min(max(weeks, 1), 12)
    today = date.today()
    current_monday = today - timedelta(days=today.weekday())
    window_start = current_monday - timedelta(days=7 * (weeks - 1))
    window_end = current_monday + timedelta(days=4)  # Friday of current week

    ids = [s.id for s in db.query(Student.id).filter(Student.class_id == class_id).all()]
    # Monday key per bucket for O(1) classification
    monday_keys = [window_start + timedelta(days=7 * i) for i in range(weeks)]
    key_set = set(m.isoformat() for m in monday_keys)
    buckets: dict[str, dict[str, int]] = {m.isoformat(): {"marked": 0, "present": 0} for m in monday_keys}

    if ids:
        records = (db.query(Attendance.date, Attendance.status)
                   .filter(Attendance.student_id.in_(ids),
                           Attendance.date >= window_start, Attendance.date <= window_end)
                   .all())
        for dt, st in records:
            key = dt.isoformat() if hasattr(dt, "isoformat") else str(dt)
            # attendance lives Mon-Fri only, so date lands exactly on a bucket monday
            if key not in key_set:
                continue
            b = buckets[key]
            b["marked"] += 1
            if st == "P":
                b["present"] += 1

    mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    out = []
    for m in monday_keys:
        b = buckets[m.isoformat()]
        pct = round(b["present"] / b["marked"] * 100, 1) if b["marked"] else None
        out.append({
            "start": m.isoformat(),
            "label": f"{mo[m.month - 1]} {m.day}",
            "marked": b["marked"],
            "present": b["present"],
            "pct": pct,
        })
    return {"weeks": out}


@router.get("/student-trend/{student_id}")
def get_student_attendance_trend(student_id: int, weeks: int = 6,
                                 db: Session = Depends(get_db),
                                 user=Depends(get_current_user)):
    """Per-week present% for ONE student over the last `weeks` (1-12)
    Mon-Fri windows, oldest → newest, current week last. Powers the tiny
    sparkline next to each follow-up student pill on the principal's
    attendance explorer — same bucketing contract as /trend/{class_id}."""
    weeks = min(max(weeks, 1), 12)
    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    # IDOR guard: parents see only their child, staff only their scope.
    assert_student_access(user, student, db)

    today = date.today()
    current_monday = today - timedelta(days=today.weekday())
    window_start = current_monday - timedelta(days=7 * (weeks - 1))
    window_end = current_monday + timedelta(days=4)

    monday_keys = [window_start + timedelta(days=7 * i) for i in range(weeks)]
    key_set = set(m.isoformat() for m in monday_keys)
    buckets: dict[str, dict[str, int]] = {m.isoformat(): {"marked": 0, "present": 0} for m in monday_keys}

    records = (db.query(Attendance.date, Attendance.status)
               .filter(Attendance.student_id == student_id,
                       Attendance.date >= window_start, Attendance.date <= window_end)
               .all())
    for dt, st in records:
        key = dt.isoformat() if hasattr(dt, "isoformat") else str(dt)
        if key not in key_set:
            continue
        b = buckets[key]
        b["marked"] += 1
        if st == "P":
            b["present"] += 1

    mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    out = []
    for m in monday_keys:
        b = buckets[m.isoformat()]
        pct = round(b["present"] / b["marked"] * 100, 1) if b["marked"] else None
        out.append({
            "start": m.isoformat(),
            "label": f"{mo[m.month - 1]} {m.day}",
            "marked": b["marked"],
            "present": b["present"],
            "pct": pct,
        })
    return {"student_id": student_id, "weeks": out}


@router.get("/summary/{class_id}")
def get_attendance_summary(class_id: int, db: Session = Depends(get_db),
                          user=Depends(get_current_user)):
    cls = db.query(Class).filter(Class.id == class_id).first()
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found")
    assert_class_access(user, cls)

    students = db.query(Student).filter(Student.class_id == class_id).all()
    # One grouped query instead of one query per student (N+1 on 30+
    # students × full history previously froze the request).
    from sqlalchemy import func, case
    rows = (db.query(Attendance.student_id,
                     func.count(Attendance.id).label("total"),
                     func.sum(case((Attendance.status == "P", 1), else_=0)).label("present"))
             .filter(Attendance.student_id.in_([s.id for s in students]) if students else False)
             .group_by(Attendance.student_id)
             .all())
    stats = {sid: (total, present) for sid, total, present in rows}
    result = []
    for s in students:
        total, present = stats.get(s.id, (0, 0))
        rate = round((present / total) * 100, 1) if total > 0 else 0
        result.append({
            "student_id": s.id, "name": s.name, "total_marked": total,
            "present_days": present, "attendance_rate": rate
        })
    return result
