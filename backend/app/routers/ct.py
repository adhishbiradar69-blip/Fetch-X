"""ct.py — Class Teacher console endpoints (designer dashboard v15).

The v15 design gives every class teacher their own console inside the same
dashboard shell: My Class, Attendance, Task Completion, Academic Marks,
Teaching Classes, My Report and Timetable. Attendance / tasks / marks reuse
the existing ``/attendance``, ``/tasks`` and ``/academics`` routers (they
already enforce per-class access); this router adds the read-model the
console needs and which the principal router intentionally refuses to serve
to class_teacher accounts:

  GET /ct/me                  → teacher profile + CT class + school
  GET /ct/class-dashboard     → principal-grade class detail for the CT class
                                (overview strip, subjects, distribution,
                                ranked students, attendance / tasks rollups)
  GET /ct/teaching-classes    → the teacher's subject across every class they
                                teach (per-class term averages, tasks, ranked
                                student cohort)

Admin roles (school_admin / super_admin) may pass ?class_id= to preview any
class of their school — matching the "one class at a time" console model.
"""
from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.attendance import Attendance
from app.models.class_ import Class
from app.models.exam import Exam
from app.models.mark import Mark
from app.models.school import School
from app.models.student import Student
from app.models.subject import Subject
from app.models.task import Task, TaskCompletion
from app.models.teacher_assignment import TeacherAssignment
from app.models.user import User
from app.routers.principal import (
    _band_counts, _class_rollups, _ct_map, _hod_map, _pct_expr, _ranks_from_averages,
    _student_avg_map, _teacher_aggregates, _term_key,
)

router = APIRouter(prefix="/ct", tags=["class-teacher"])

STAFF_ROLES = ("class_teacher", "school_admin", "super_admin")


def _school_of(user: User, db: Session) -> School:
    if user.role == "super_admin":
        s = db.query(School).order_by(School.id).first()
        if not s:
            raise HTTPException(status_code=404, detail="No schools configured. Seed data first.")
        return s
    if not user.school_id:
        raise HTTPException(status_code=403, detail="No school assigned to this account.")
    s = db.query(School).filter(School.id == user.school_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="School not found.")
    return s


def _ct_class_of(user: User, db: Session, school: School, class_id: int = None) -> Class:
    """Resolve the class the console operates on.

    class_teacher → their assigned / CT class (a class_id hint is ignored so
    a teacher can never pivot to another class's console); admins may pass
    any class of their school (defaults to the school's first class).
    """
    if class_id is not None and user.role in ("school_admin", "super_admin"):
        cls = db.query(Class).filter(Class.id == int(class_id),
                                     Class.school_id == school.id).first()
        if not cls:
            raise HTTPException(status_code=404, detail="Class not found in your school.")
        return cls

    if user.assigned_class_id:
        cls = db.query(Class).filter(Class.id == user.assigned_class_id,
                                     Class.school_id == school.id).first()
        if cls:
            return cls
    cls = db.query(Class).filter(Class.class_teacher_id == user.id,
                                 Class.school_id == school.id).first()
    if cls:
        return cls
    if user.role in ("school_admin", "super_admin"):
        cls = db.query(Class).filter(Class.school_id == school.id)\
            .order_by(Class.grade, Class.section).first()
        if cls:
            return cls
    raise HTTPException(status_code=404,
                        detail="No class assigned to you. Ask your admin to set your class.")


@router.get("/me")
def ct_me(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Console bootstrap: who am I, which class, what do I teach — plus the
    school (v17) so the UI's tier tag can read "CLASS 10-EMERALD · GNPS
    MAILLOOR · 30 STUDENTS" without a leadership-scoped call."""
    if user.role not in STAFF_ROLES:
        raise HTTPException(status_code=403, detail="The console is for teaching staff.")
    school = _school_of(user, db)
    cls = _ct_class_of(user, db, school)

    # primary subject = subject of the CT assignment, else most-taught
    primary = None
    ta = (db.query(TeacherAssignment, Subject.name)
            .join(Subject, TeacherAssignment.subject_id == Subject.id)
            .filter(TeacherAssignment.school_id == school.id,
                    TeacherAssignment.teacher_user_id == user.id,
                    TeacherAssignment.class_id.isnot(None))
            .all())
    if ta:
        counts: dict[int, int] = defaultdict(int)
        name_by_sid: dict[int, str] = {}
        for a, sname in ta:
            counts[a.subject_id] += 1
            name_by_sid[a.subject_id] = sname
        top_sid = max(counts, key=lambda s: counts[s])
        primary = {"id": top_sid, "name": name_by_sid[top_sid]}
    if primary is None:
        cta = (db.query(TeacherAssignment, Subject.name)
                 .join(Subject, TeacherAssignment.subject_id == Subject.id)
                 .filter(TeacherAssignment.school_id == school.id,
                         TeacherAssignment.teacher_user_id == user.id)
                 .first())
        if cta:
            primary = {"id": cta[0].subject_id, "name": cta[1]}

    is_hod = db.query(TeacherAssignment).filter(
        TeacherAssignment.school_id == school.id,
        TeacherAssignment.teacher_user_id == user.id,
        TeacherAssignment.is_hod.is_(True)).first() is not None

    return {
        "teacher": {
            "id": user.id,
            "name": user.full_name or user.email,
            "email": user.email,
            "role": user.role,
            "is_hod": is_hod,
            "subject": primary,
        },
        "class": {"id": cls.id, "name": f"{cls.grade}-{cls.section}",
                  "grade": cls.grade, "section": cls.section},
        # v17: the console's school — the designer's tier tag renders
        # "CLASS <CLASS> · <SCHOOL> · N STUDENTS".
        "school": {"id": school.id, "name": school.name},
    }


@router.get("/class-dashboard")
def ct_class_dashboard(class_id: int = None, db: Session = Depends(get_db),
                       user=Depends(get_current_user)):
    """Principal-grade class detail, scoped to the console's class.

    Same response contract as GET /principal/class-detail/{id} so the v15
    "My Class" page renders with the exact same components."""
    if user.role not in STAFF_ROLES:
        raise HTTPException(status_code=403, detail="The console is for teaching staff.")
    school = _school_of(user, db)
    cls = _ct_class_of(user, db, school, class_id)

    rollups = _class_rollups(db, school)
    ct = _ct_map(db, school)
    classes = db.query(Class).filter(Class.school_id == school.id).all()
    ranked = sorted([c.id for c in classes], key=lambda cid: (-rollups[cid]["avg"], cid))
    rank_of = {cid: i for i, cid in enumerate(ranked, start=1)}

    # per-subject term averages for this class
    pct = _pct_expr()
    per_ts: dict[tuple[int, int], list] = defaultdict(lambda: [0.0, 0])
    for sid_, t_label, s, n in (db.query(Mark.subject_id, Exam.term, func.sum(pct), func.count(Mark.id))
                                .select_from(Mark)
                                .join(Exam, Mark.exam_id == Exam.id)
                                .join(Student, Mark.student_id == Student.id)
                                .filter(Student.class_id == cls.id, Exam.max_score > 0)
                                .group_by(Mark.subject_id, Exam.term).all()):
        t = _term_key(t_label)
        if t is not None and n:
            per_ts[(sid_, t)][0] += s or 0.0
            per_ts[(sid_, t)][1] += n
    per_s: dict[int, list] = defaultdict(lambda: [0.0, 0])
    for sid_, s, n in (db.query(Mark.subject_id, func.sum(pct), func.count(Mark.id))
                       .select_from(Mark)
                       .join(Exam, Mark.exam_id == Exam.id)
                       .join(Student, Mark.student_id == Student.id)
                       .filter(Student.class_id == cls.id, Exam.max_score > 0)
                       .group_by(Mark.subject_id).all()):
        if n:
            per_s[sid_][0] += s or 0.0
            per_s[sid_][1] += n

    hod = _hod_map(db, school.id)
    subjects = []
    # configured subjects for this class's grade
    from app.models.grade_subject import GradeSubject
    subs = (db.query(Subject)
              .join(GradeSubject, GradeSubject.subject_id == Subject.id)
              .filter(GradeSubject.school_id == school.id,
                      GradeSubject.grade == cls.grade)
              .order_by(Subject.id).all())
    for sub in subs:
        s_, n_ = per_s.get(sub.id, [0.0, 0])
        row = {"name": sub.name, "hod": hod.get(sub.id)}
        for t in (1, 2, 3):
            ss, nn = per_ts.get((sub.id, t), [0.0, 0])
            row[f"t{t}"] = round(ss / nn, 1) if nn else 0.0
        row["avg"] = round(s_ / n_, 1) if n_ else 0.0
        subjects.append(row)

    # ranked students with attendance
    students = db.query(Student).filter(Student.class_id == cls.id).all()
    att = dict((sid, (p or 0) * 100.0 / n) for sid, n, p in
               (db.query(Attendance.student_id, func.count(Attendance.id),
                         func.sum(case((Attendance.status == "P", 1), else_=0)))
                .filter(Attendance.student_id.in_([s.id for s in students] or [0]))
                .group_by(Attendance.student_id).all()))
    avg_map = _student_avg_map(db, school)
    # v15: per-student per-subject averages for the class comparison tabs
    pct = _pct_expr()
    ss_map: dict[tuple[int, int], float] = {}
    for sid_, subj_id_, s_, n_ in (db.query(Student.id, Mark.subject_id, func.sum(pct), func.count(Mark.id))
                                   .select_from(Mark)
                                   .join(Exam, Mark.exam_id == Exam.id)
                                   .join(Student, Mark.student_id == Student.id)
                                   .filter(Student.class_id == cls.id, Exam.max_score > 0)
                                   .group_by(Student.id, Mark.subject_id).all()):
        if n_:
            ss_map[(sid_, subj_id_)] = round(s_ / n_, 1)
    subject_name_by_id = {s_.id: s_.name for s_ in subs}
    student_rows = []
    for s in students:
        scores = {}
        for (stu_id, subj_id), v in ss_map.items():
            if stu_id == s.id and subj_id in subject_name_by_id:
                scores[subject_name_by_id[subj_id]] = v
        student_rows.append({
            "id": s.id, "name": s.name,
            "avg": round(avg_map.get(s.id, 0.0), 1),
            "attendance_pct": round(att.get(s.id, 0.0), 1),
            "subject_scores": scores,
        })
    student_rows.sort(key=lambda r: (-r["avg"], r["name"]))
    for i, r in enumerate(student_rows, start=1):
        r["rank"] = i

    return {
        "info": {
            "id": cls.id,
            "grade": cls.grade,
            "section": cls.section,
            "name": f"{cls.grade}-{cls.section}",
            "ct_name": ct[cls.id]["ct_name"],
            "ct_subject": ct[cls.id]["ct_subject"],
            "students": rollups[cls.id]["students"],
            "avg": rollups[cls.id]["avg"],
            "attendance_pct": rollups[cls.id]["attendance_pct"],
            "tasks_pct": rollups[cls.id]["tasks_pct"],
            "rank": rank_of[cls.id],
        },
        "subjects": subjects,
        "distribution": _band_counts(db, school, class_id=cls.id),
        "attendance_pct": rollups[cls.id]["attendance_pct"],
        "tasks_pct": rollups[cls.id]["tasks_pct"],
        "students": student_rows,
    }


@router.get("/teacher-report")
def ct_teacher_report(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Full faculty report for the CONSOLE USER (same contract as
    /principal/teacher-report/{id} so the report modal renders identically)."""
    if user.role not in STAFF_ROLES:
        raise HTTPException(status_code=403, detail="The console is for teaching staff.")
    school = _school_of(user, db)
    bundle = _teacher_aggregates(db, school)
    t = bundle["index"].get(user.id)
    if not t:
        raise HTTPException(status_code=404,
                            detail="No teaching assignments found for your account.")
    role = "HOD" if t["is_hod"] else ("CLASS TEACHER" if t["ct_of"] else "FACULTY")
    return {
        "teacher": {k: v for k, v in t.items() if not k.startswith("_")},
        "role": role,
        "classes": t["_per_class"],
        "series": _self_series(db, school, t),
        "students": _self_students(db, school, t),
    }


def _self_series(db: Session, school: School, t: dict) -> list:
    """Exam-by-exam subject trend across the teacher's classes (same
    semantics as the principal's teacher-report series)."""
    from app.models.exam import Exam
    from app.models.mark import Mark
    class_ids = [c["id"] for c in t["_per_class"]] or [0]
    pct = _pct_expr()
    exam_stats: dict[int, list] = {}
    for eid, s, n in (db.query(Mark.exam_id, func.sum(pct), func.count(Mark.id))
                      .select_from(Mark)
                      .join(Exam, Mark.exam_id == Exam.id)
                      .join(Student, Mark.student_id == Student.id)
                      .filter(Student.class_id.in_(class_ids), Mark.subject_id == t["subject_id"],
                              Exam.max_score > 0)
                      .group_by(Mark.exam_id).all()):
        if n:
            exam_stats[eid] = [s or 0.0, n]
    exams = {e.id: e for e in db.query(Exam).filter(Exam.school_id == school.id).all()}
    series = []
    for eid in sorted(exam_stats):
        s, n = exam_stats[eid]
        ex = exams.get(eid)
        if ex and n:
            series.append({"label": f"G{ex.grade} {ex.name}",
                           "term": _term_key(ex.term),
                           "pct": round(s / n, 1)})
    return series


def _self_students(db: Session, school: School, t: dict) -> list:
    """Student cohort across the teacher's classes, dense-ranked by the
    subject's average (same contract as the principal's teacher-report)."""
    from app.models.mark import Mark
    class_ids = [c["id"] for c in t["_per_class"]] or [0]
    pct = _pct_expr()
    scored = []
    for sid2, nm, gr, sec, s, n in (db.query(Student.id, Student.name, Class.grade,
                                             Class.section, func.sum(pct), func.count(Mark.id))
                                    .select_from(Mark)
                                    .join(Exam, Mark.exam_id == Exam.id)
                                    .join(Student, Mark.student_id == Student.id)
                                    .join(Class, Student.class_id == Class.id)
                                    .filter(Student.class_id.in_(class_ids),
                                            Mark.subject_id == t["subject_id"], Exam.max_score > 0)
                                    .group_by(Student.id, Student.name, Class.grade, Class.section).all()):
        if n:
            scored.append({"id": sid2, "name": nm, "class_name": f"{gr}-{sec}",
                           "score": round(s / n, 1)})
    scored.sort(key=lambda r: (-r["score"], r["name"]))
    rk, prev = 0, object()
    for r in scored:
        if r["score"] != prev:
            rk += 1
            prev = r["score"]
        r["rank"] = rk
    marked_ids = {r["id"] for r in scored}
    all_kids = (db.query(Student.id, Student.name, Class.grade, Class.section)
                  .join(Class, Student.class_id == Class.id)
                  .filter(Student.class_id.in_(class_ids)).all())
    unscored = [{"id": sid2, "name": nm, "class_name": f"{gr}-{sec}",
                 "score": None, "rank": None}
                for sid2, nm, gr, sec in all_kids if sid2 not in marked_ids]
    unscored.sort(key=lambda r: (r["class_name"], r["name"]))
    return scored + unscored


@router.get("/teaching-classes")
def ct_teaching_classes(class_id: int = None, db: Session = Depends(get_db),
                        user=Depends(get_current_user)):
    """The teacher's subject across every class they teach (v15 page 05).

    Mirrors /principal/teacher-report but scoped to the console user:
    per-class subject averages + term splits + tasks, and the ranked student
    cohort across all those classes."""
    if user.role not in STAFF_ROLES:
        raise HTTPException(status_code=403, detail="The console is for teaching staff.")
    school = _school_of(user, db)

    bundle = _teacher_aggregates(db, school)
    t = bundle["index"].get(user.id)
    if not t:
        raise HTTPException(status_code=404,
                            detail="No teaching assignments found for your account.")
    resp_teacher = {k: v for k, v in t.items() if not k.startswith("_")}
    role = "HOD" if t["is_hod"] else ("CLASS TEACHER" if t["ct_of"] else "FACULTY")

    # console class context (for the header pill)
    try:
        cls = _ct_class_of(user, db, school, class_id)
        ct_class = {"id": cls.id, "name": f"{cls.grade}-{cls.section}"}
    except HTTPException:
        ct_class = None

    return {
        "teacher": resp_teacher,
        "role": role,
        "ct_class": ct_class,
        "classes": t["_per_class"],
    }
