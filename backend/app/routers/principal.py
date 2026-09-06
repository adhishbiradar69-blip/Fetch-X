
import json
import re
import statistics
from collections import defaultdict
from datetime import date, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import (assert_class_access, assert_student_access,
                              get_current_user, require_role)
from app.rate_limit import limiter
from app.models.attendance import Attendance
from app.models.class_ import Class
from app.models.exam import Exam
from app.models.grade_subject import GradeSubject
from app.models.mark import Mark
from app.models.school import School
from app.models.student import Student
from app.models.subject import Subject
from app.models.task import Task, TaskCompletion
from app.models.teacher_assignment import TeacherAssignment
from app.models.user import User
from app.services.ai_service import ask_ai, ask_ai_agentic
from app.services.ai_tools import TOOLS as PRINCIPAL_TOOLS

router = APIRouter(prefix="/principal", tags=["principal"])
_allowed = require_role("principal", "super_admin", "school_admin")


# ─────────────────────────────────────────────────────────────────────────────
# helpers
# ─────────────────────────────────────────────────────────────────────────────
def _school_of(user: User, db: Session) -> School:
    """Return the school the principal/admin is acting on."""
    if user.role == "super_admin":
        # Site owner with no school of their own → preview the first school.
        s = db.query(School).order_by(School.id).first()
        if not s:
            raise HTTPException(status_code=404, detail="No schools configured. Seed data first.")
        return s
    if user.role == "school_admin":
        # A mis-provisioned school_admin must NOT silently inherit the first
        # school in the DB — that was a cross-tenant read.
        if not user.school_id:
            raise HTTPException(status_code=403, detail="Your account has no school assigned. Contact the site owner.")
        s = db.query(School).filter(School.id == user.school_id).first()
        if not s:
            raise HTTPException(status_code=404, detail="School not found.")
        return s
    # principal
    if not user.school_id:
        raise HTTPException(status_code=403, detail="No school assigned to this principal.")
    s = db.query(School).filter(School.id == user.school_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="School not found.")
    return s


def _term_key(term) -> Optional[int]:
    """Map an exam.term label ("Term 1", "Term 2", "Term 3", ...) to 1/2/3.
    Returns None for missing / unrecognised labels."""
    if not term:
        return None
    m = re.search(r"(\d+)", str(term))
    if not m:
        return None
    n = int(m.group(1))
    return n if n in (1, 2, 3) else None


def _school_rank_info(db: Session, school: School) -> tuple[Optional[int], int]:
    """Dense rank of `school` among ALL schools by average mark percentage.

    The average uses the exact same semantics as `_gather_school_data`'s
    `school_average` (mean of score/max_score*100 over every mark of the
    school's students), so the rank always agrees with the displayed
    school_average. Returns (rank_or_None, total_schools).
    """
    total_schools = db.query(func.count(School.id)).scalar() or 0
    rows = (db.query(Class.school_id,
                     func.avg(Mark.score * 100.0 / func.nullif(Exam.max_score, 0)).label("avg"))
              .join(Student, Student.class_id == Class.id)
              .join(Mark, Mark.student_id == Student.id)
              .join(Exam, Mark.exam_id == Exam.id)
              .filter(Exam.school_id == Class.school_id, Exam.max_score > 0)
              .group_by(Class.school_id)
              .all())
    distinct = []
    for _sid, avg in sorted(rows, key=lambda r: r[1], reverse=True):
        if not distinct or distinct[-1] != avg:
            distinct.append(avg)
    my = next((avg for sid, avg in rows if sid == school.id), None)
    rank = (distinct.index(my) + 1) if (my is not None and my in distinct) else None
    return rank, total_schools


def _teacher_pills_map(db: Session, class_ids: list[int]) -> dict[int, dict]:
    """class_id -> {"class_teacher_name": str|None,
                    "subject_teachers": {subject_name: teacher_full_name}}

    Powers the designer prototype's CT pill (per class) and the per-subject
    teacher map (class detail view), sourced from TeacherAssignment rows.
    """
    out = {cid: {"class_teacher_name": None, "subject_teachers": {}} for cid in class_ids}
    if not class_ids:
        return out
    classes = db.query(Class).filter(Class.id.in_(class_ids)).all()
    ct_ids = {c.class_teacher_id for c in classes if c.class_teacher_id}
    ct_names = {}
    if ct_ids:
        for u in db.query(User).filter(User.id.in_(ct_ids)).all():
            ct_names[u.id] = u.full_name or u.email
    for c in classes:
        if c.id in out:
            out[c.id]["class_teacher_name"] = ct_names.get(c.class_teacher_id)
    tas = (db.query(TeacherAssignment.class_id, Subject.name, User.full_name, User.email)
             .join(Subject, TeacherAssignment.subject_id == Subject.id)
             .join(User, TeacherAssignment.teacher_user_id == User.id)
             .filter(TeacherAssignment.class_id.in_(class_ids))
             .order_by(TeacherAssignment.is_class_teacher.desc())
             .all())
    # is_class_teacher rows sort first so the actual subject teacher always
    # wins the name for that subject (a school admin holding a CT post must
    # not shadow the real teacher in the subject map).
    for cid, sname, fname, email in tas:
        if cid in out:
            out[cid]["subject_teachers"][sname] = fname or email
    return out


def _hod_map(db: Session, school_id: int) -> dict[int, str]:
    """subject_id -> HOD full name (the is_hod TeacherAssignment of that
    subject within the school). Empty dict when no HOD rows exist."""
    rows = (db.query(TeacherAssignment.subject_id, User.full_name, User.email)
              .join(User, TeacherAssignment.teacher_user_id == User.id)
              .filter(TeacherAssignment.school_id == school_id,
                      TeacherAssignment.is_hod.is_(True))
              .all())
    return {sid: (fname or email) for sid, fname, email in rows}


def _gather_school_data(db: Session, school: School) -> dict:
    """Pull a one-shot snapshot of the school's data — used by all
    dashboard endpoints so we don't re-issue dozens of queries.

    Computes:
      - per-student stats: average %, attendance rate, subject marks, rank
        in class, rank in grade, exam-by-exam averages, strongest/weakest
        subject, improvement trend (first exam → last exam).
      - per-class stats: avg, attendance, top/bottom student, subject
        averages, exam averages, at-risk count.
      - per-grade stats: list of sections (classes), avg, attendance, top
        student.
      - per-subject stats: avg, pass_rate (>=40%), student_count.
      - school-wide aggregates: school_average, top_performer, exam list.
    """
    classes = db.query(Class).filter(Class.school_id == school.id).all()
    class_by_id = {c.id: c for c in classes}
    class_ids = list(class_by_id.keys())

    students = db.query(Student).filter(Student.class_id.in_(class_ids)).all() if class_ids else []
    student_by_id = {s.id: s for s in students}
    student_ids = list(student_by_id.keys())

    exams = db.query(Exam).filter(Exam.school_id == school.id).all()
    exam_by_id = {e.id: e for e in exams}

    marks = (db.query(Mark).filter(Mark.student_id.in_(student_ids)).all()
             if student_ids else [])
    # Lean tuple projection instead of full ORM rows — 81k attendance rows
    # instantiate ~7× faster as plain tuples, and only these three fields are
    # consumed below (student_id, status, date).
    attendance = (db.query(Attendance.student_id, Attendance.status, Attendance.date)
                  .filter(Attendance.student_id.in_(student_ids)).all()
                  if student_ids else [])

    subjects = db.query(Subject).order_by(Subject.id).all()
    subject_by_id = {s.id: s for s in subjects}

    grade_subjects = db.query(GradeSubject).filter(GradeSubject.school_id == school.id).all()
    # Map grade → set of subject_ids that are configured for that grade
    grade_subject_map: dict[int, set[int]] = defaultdict(set)
    for gs in grade_subjects:
        grade_subject_map[gs.grade].add(gs.subject_id)

    # ─── per-student stats ────────────────────────────────────────────────
    # student_marks[sid] = list[(subject_id, pct, exam_id)]
    student_marks: dict[int, list[tuple[int, float, int]]] = defaultdict(list)
    # student_att[sid] = [present, total]
    student_att: dict[int, list[int]] = defaultdict(lambda: [0, 0])
    # student_attendance_history[sid] = list[(date_str, status)]
    student_att_history: dict[int, list[tuple[str, str]]] = defaultdict(list)

    for m in marks:
        ex = exam_by_id.get(m.exam_id)
        if not ex or not ex.max_score:
            continue
        pct = (m.score / ex.max_score) * 100
        student_marks[m.student_id].append((m.subject_id, pct, m.exam_id))

    for a_sid, a_status, a_date in attendance:
        bucket = student_att[a_sid]
        bucket[1] += 1
        if a_status == "P":
            bucket[0] += 1
        student_att_history[a_sid].append(
            (a_date.isoformat() if hasattr(a_date, "isoformat") else str(a_date), a_status)
        )
    # sort each student's attendance history by date
    for sid in student_att_history:
        student_att_history[sid].sort(key=lambda x: x[0])

    # exam ordering: each grade → ordered list of exam_ids (by id asc, a stable proxy for chronology)
    grade_exams: dict[int, list[int]] = defaultdict(list)
    for ex in exams:
        grade_exams[ex.grade].append(ex.id)
    for g in grade_exams:
        grade_exams[g].sort()

    # Compute per-student averages, attendance, ranks, etc.
    student_stats: dict[int, dict] = {}
    all_pcts: list[float] = []
    for sid, lst in student_marks.items():
        stu = student_by_id.get(sid)
        if not stu:
            continue
        c = class_by_id.get(stu.class_id)
        if not c:
            continue
        avg = sum(p for (_a, p, _b) in lst) / len(lst) if lst else 0.0

        # subject averages for this student
        per_subject: dict[int, list[float]] = defaultdict(list)
        per_exam: dict[int, list[float]] = defaultdict(list)
        for (subj_id, p, exam_id) in lst:
            per_subject[subj_id].append(p)
            per_exam[exam_id].append(p)

        subject_avgs = {
            sid2: round(sum(v) / len(v), 1) for sid2, v in per_subject.items()
        }
        exam_avgs = {
            eid: round(sum(v) / len(v), 1) for eid, v in per_exam.items()
        }

        # strongest / weakest subject
        strongest = None
        weakest = None
        if subject_avgs:
            sorted_subs = sorted(subject_avgs.items(), key=lambda kv: kv[1], reverse=True)
            best_sid, best_avg = sorted_subs[0]
            weak_sid, weak_avg = sorted_subs[-1]
            bsub = subject_by_id.get(best_sid)
            wsub = subject_by_id.get(weak_sid)
            if bsub:
                strongest = {"subject_id": bsub.id, "name": bsub.name,
                             "color": bsub.color, "average": best_avg}
            if wsub:
                weakest = {"subject_id": wsub.id, "name": wsub.name,
                           "color": wsub.color, "average": weak_avg}

        # attendance rate
        att_pres, att_tot = student_att.get(sid, [0, 0])
        att_rate = (att_pres / att_tot * 100) if att_tot else 100.0

        # improvement trend: compare avg in first exam vs last exam (chronologically)
        ordered_exam_ids = grade_exams.get(c.grade, [])
        first_exam_avg = None
        last_exam_avg = None
        if ordered_exam_ids:
            first_eid = ordered_exam_ids[0]
            last_eid = ordered_exam_ids[-1]
            if first_eid in exam_avgs:
                first_exam_avg = exam_avgs[first_eid]
            if last_eid in exam_avgs:
                last_exam_avg = exam_avgs[last_eid]

        improvement_delta = None
        if first_exam_avg is not None and last_exam_avg is not None:
            improvement_delta = round(last_exam_avg - first_exam_avg, 1)

        # variance for consistency
        variance = None
        if len(lst) > 1:
            variance = round(statistics.pvariance([p for (_a, p, _b) in lst]), 2)

        student_stats[sid] = {
            "student_id": sid,
            "name": stu.name,
            "roll_no": stu.roll_no,
            "class_id": c.id,
            "class_label": f"Grade {c.grade}-{c.section}",
            "grade": c.grade,
            "section": c.section,
            "average": round(avg, 1),
            "attendance_rate": round(att_rate, 1),
            "subject_averages": subject_avgs,
            "exam_averages": exam_avgs,
            "strongest_subject": strongest,
            "weakest_subject": weakest,
            "first_exam_average": first_exam_avg,
            "last_exam_average": last_exam_avg,
            "improvement_delta": improvement_delta,
            "variance": variance,
            "attendance_history": student_att_history.get(sid, []),
            "_marks": lst,  # internal
        }
        all_pcts.extend(p for (_a, p, _b) in lst)

    school_avg = round(sum(all_pcts) / len(all_pcts), 1) if all_pcts else 0.0

    # ─── rank computation ────────────────────────────────────────────────
    # Rank within class
    classes_with_students: dict[int, list[int]] = defaultdict(list)
    for sid, st in student_stats.items():
        classes_with_students[st["class_id"]].append(sid)
    for cid, sids in classes_with_students.items():
        sids.sort(key=lambda x: student_stats[x]["average"], reverse=True)
        for rank, sid in enumerate(sids, start=1):
            student_stats[sid]["rank_in_class"] = rank
            student_stats[sid]["class_size"] = len(sids)

    # Rank within grade
    grade_with_students: dict[int, list[int]] = defaultdict(list)
    for sid, st in student_stats.items():
        grade_with_students[st["grade"]].append(sid)
    for grade, sids in grade_with_students.items():
        sids.sort(key=lambda x: student_stats[x]["average"], reverse=True)
        for rank, sid in enumerate(sids, start=1):
            student_stats[sid]["rank_in_grade"] = rank
            student_stats[sid]["grade_size"] = len(sids)

    # ─── per-class stats ─────────────────────────────────────────────────
    class_rows = []
    for c in classes:
        cls_students = [student_stats[sid] for sid in classes_with_students.get(c.id, [])]
        cls_pcts = [p for st in cls_students for (_a, p, _b) in st["_marks"]]
        cls_avg = round(sum(cls_pcts) / len(cls_pcts), 1) if cls_pcts else 0.0
        att_pres = sum(student_att.get(st["student_id"], [0, 0])[0] for st in cls_students)
        att_tot = sum(student_att.get(st["student_id"], [0, 0])[1] for st in cls_students)
        att_rate = round((att_pres / att_tot) * 100, 1) if att_tot else 0.0
        # subject averages within this class
        sub_pcts: dict[int, list[float]] = defaultdict(list)
        for st in cls_students:
            for (subj_id, p, _e) in st["_marks"]:
                sub_pcts[subj_id].append(p)
        sub_avgs = []
        for subj_id, pcts in sub_pcts.items():
            sub = subject_by_id.get(subj_id)
            if not sub:
                continue
            sub_avgs.append({
                "subject_id": subj_id, "name": sub.name, "color": sub.color,
                "average": round(sum(pcts) / len(pcts), 1),
                "pass_rate": round(sum(1 for p in pcts if p >= 40) / len(pcts) * 100, 1) if pcts else 0.0,
            })
        sub_avgs.sort(key=lambda x: x["average"], reverse=True)
        # top / bottom student in class
        top = None
        bottom = None
        if cls_students:
            sorted_cls = sorted(cls_students, key=lambda x: x["average"], reverse=True)
            top = {"student_id": sorted_cls[0]["student_id"],
                   "name": sorted_cls[0]["name"],
                   "average": sorted_cls[0]["average"]}
            bottom = {"student_id": sorted_cls[-1]["student_id"],
                      "name": sorted_cls[-1]["name"],
                      "average": sorted_cls[-1]["average"]}
        # at-risk count
        at_risk_count = sum(1 for st in cls_students if st["average"] < 50 or st["attendance_rate"] < 60)
        # exam averages within class
        exam_pcts: dict[int, list[float]] = defaultdict(list)
        for st in cls_students:
            for (subj_id, p, exam_id) in st["_marks"]:
                exam_pcts[exam_id].append(p)
        exam_rows = []
        for ex in exams:
            if ex.grade != c.grade:
                continue
            pcts = exam_pcts.get(ex.id, [])
            exam_rows.append({
                "exam_id": ex.id, "name": ex.name, "term": ex.term,
                "max_score": ex.max_score,
                "average": round(sum(pcts) / len(pcts), 1) if pcts else 0.0,
                "student_count": len(pcts),
            })
        class_rows.append({
            "class_id": c.id, "grade": c.grade, "section": c.section,
            "label": f"Grade {c.grade}-{c.section}",
            "students": len(cls_students),
            "average": cls_avg,
            "attendance_rate": att_rate,
            "top_student": top,
            "bottom_student": bottom,
            "weakest_subject": sub_avgs[-1] if sub_avgs else None,
            "strongest_subject": sub_avgs[0] if sub_avgs else None,
            "at_risk_count": at_risk_count,
            "subject_averages": sub_avgs,
            "exam_averages": exam_rows,
        })

    # ─── per-grade stats ────────────────────────────────────────────────
    grade_rows = []
    grades_dict: dict[int, dict] = {}
    for c in classes:
        grades_dict.setdefault(c.grade, {"grade": c.grade, "class_ids": [], "sections": []})
        grades_dict[c.grade]["class_ids"].append(c.id)
        grades_dict[c.grade]["sections"].append(c.section)
    for grade in sorted(grades_dict.keys()):
        g_students = [student_stats[sid] for sid in grade_with_students.get(grade, [])]
        g_pcts = [p for st in g_students for (_a, p, _b) in st["_marks"]]
        g_avg = round(sum(g_pcts) / len(g_pcts), 1) if g_pcts else 0.0
        g_att_pres = sum(student_att.get(st["student_id"], [0, 0])[0] for st in g_students)
        g_att_tot = sum(student_att.get(st["student_id"], [0, 0])[1] for st in g_students)
        g_att = round((g_att_pres / g_att_tot) * 100, 1) if g_att_tot else 0.0
        # subject averages across the grade
        g_sub_pcts: dict[int, list[float]] = defaultdict(list)
        for st in g_students:
            for (subj_id, p, _e) in st["_marks"]:
                g_sub_pcts[subj_id].append(p)
        g_sub_avgs = []
        for subj_id in grade_subject_map.get(grade, []):
            sub = subject_by_id.get(subj_id)
            if not sub:
                continue
            pcts = g_sub_pcts.get(subj_id, [])
            g_sub_avgs.append({
                "subject_id": subj_id, "name": sub.name, "color": sub.color,
                "average": round(sum(pcts) / len(pcts), 1) if pcts else 0.0,
                "pass_rate": round(sum(1 for p in pcts if p >= 40) / len(pcts) * 100, 1) if pcts else 0.0,
                "student_count": len(pcts),
            })
        g_sub_avgs.sort(key=lambda x: x["average"], reverse=True)
        # top student in grade
        g_top = None
        if g_students:
            sorted_g = sorted(g_students, key=lambda x: x["average"], reverse=True)
            g_top = {"student_id": sorted_g[0]["student_id"],
                     "name": sorted_g[0]["name"],
                     "average": sorted_g[0]["average"]}
        grade_rows.append({
            "grade": grade,
            "classes": len(grades_dict[grade]["class_ids"]),
            "sections": sorted(set(grades_dict[grade]["sections"])),
            "students": len(g_students),
            "average": g_avg,
            "attendance_rate": g_att,
            "top_student": g_top,
            "subject_averages": g_sub_avgs,
        })

    # ─── per-subject stats ──────────────────────────────────────────────
    subject_rows = []
    for sub in subjects:
        configured = any(sub.id in grade_subject_map.get(g, set()) for g in grades_dict)
        if not configured:
            continue
        sub_pcts = []
        for sid, st in student_stats.items():
            for (subj_id, p, _e) in st["_marks"]:
                if subj_id == sub.id:
                    sub_pcts.append(p)
        avg = round(sum(sub_pcts) / len(sub_pcts), 1) if sub_pcts else 0.0
        pass_count = len([p for p in sub_pcts if p >= 40])
        pass_rate = round((pass_count / len(sub_pcts)) * 100, 1) if sub_pcts else 0.0
        subject_rows.append({
            "subject_id": sub.id, "name": sub.name, "color": sub.color,
            "average": avg, "student_count": len(sub_pcts),
            "pass_rate": pass_rate,
        })

    # ─── exam-wise stats ────────────────────────────────────────────────
    exam_rows = []
    for ex in exams:
        ex_marks = [m for m in marks if m.exam_id == ex.id]
        ex_pcts = [(m.score / ex.max_score) * 100 for m in ex_marks if ex.max_score]
        ex_avg = round(sum(ex_pcts) / len(ex_pcts), 1) if ex_pcts else 0.0
        exam_rows.append({
            "exam_id": ex.id, "name": ex.name, "term": ex.term,
            "grade": ex.grade, "max_score": ex.max_score, "average": ex_avg,
            "student_count": len(ex_pcts),
        })

    # ─── top performer ──────────────────────────────────────────────────
    top = None
    if student_stats:
        ranked = sorted(student_stats.values(), key=lambda x: x["average"], reverse=True)
        if ranked:
            t = ranked[0]
            top = {"student_id": t["student_id"], "name": t["name"],
                   "average": t["average"], "class_label": t["class_label"]}

    return {
        "school": {"id": school.id, "name": school.name},
        "total_students": len(students),
        "total_classes": len(classes),
        "total_exams": len(exams),
        "school_average": school_avg,
        "top_performer": top,
        "grades": grade_rows,
        "classes": class_rows,
        "subjects": subject_rows,
        "exams": exam_rows,
        # internal
        "_student_stats": student_stats,
        "_student_by_id": student_by_id,
        "_class_by_id": class_by_id,
        "_exam_by_id": exam_by_id,
        "_subject_by_id": subject_by_id,
        "_grade_subject_map": grade_subject_map,
        "_grade_exams": grade_exams,
        "_marks": marks,
        "_students": students,
        "_classes": classes,
        "_grade_rows": grade_rows,
        "_class_rows": class_rows,
    }


# ─────────────────────────────────────────────────────────────────────────────
# existing endpoints (kept + lightly enhanced)
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db), user=Depends(_allowed)):
    school = _school_of(user, db)
    data = _gather_school_data(db, school)
    rank, total_schools = _school_rank_info(db, school)
    return {
        "school": data["school"],
        "total_students": data["total_students"],
        "total_classes": data["total_classes"],
        "total_exams": data["total_exams"],
        "school_average": data["school_average"],
        "top_performer": data["top_performer"],
        "grades": data["grades"],
        "classes": data["classes"],
        "subjects": data["subjects"],
        # real cross-school ranking (dense rank by average mark percentage)
        "school_rank": rank,
        "total_schools": total_schools,
    }


@router.get("/classes/compare")
def classes_compare(db: Session = Depends(get_db), user=Depends(_allowed)):
    """Per-class rollup with top_student + weakest_subject + teacher pills."""
    school = _school_of(user, db)
    data = _gather_school_data(db, school)
    pills = _teacher_pills_map(db, [c["class_id"] for c in data["_class_rows"]])
    out = []
    for c in data["_class_rows"]:
        p = pills.get(c["class_id"], {})
        out.append({
            "class_id": c["class_id"], "grade": c["grade"], "section": c["section"],
            "label": c["label"],
            "student_count": c["students"],
            "average_percentage": c["average"],
            "attendance_rate": c["attendance_rate"],
            "top_student": c["top_student"],
            "weakest_subject": c["weakest_subject"],
            "class_teacher_name": p.get("class_teacher_name"),
            "subject_teachers": p.get("subject_teachers", {}),
        })
    return out


@router.get("/subjects/breakdown")
def subjects_breakdown(db: Session = Depends(get_db), user=Depends(_allowed)):
    school = _school_of(user, db)
    data = _gather_school_data(db, school)
    hod = _hod_map(db, school.id)
    return [dict(row, hod_name=hod.get(row["subject_id"])) for row in data["subjects"]]


@router.get("/at-risk")
def at_risk(db: Session = Depends(get_db), user=Depends(_allowed)):
    """Students whose avg < 50% OR attendance < 60%."""
    school = _school_of(user, db)
    data = _gather_school_data(db, school)
    student_stats = data["_student_stats"]
    out = []
    for sid, st in student_stats.items():
        if st["average"] < 50 or st["attendance_rate"] < 60:
            out.append({
                "student_id": sid, "name": st["name"], "roll_no": st["roll_no"],
                "class_label": st["class_label"],
                "average": st["average"],
                "attendance_rate": st["attendance_rate"],
                "weakest_subject": st["weakest_subject"],
                "rank_in_class": st.get("rank_in_class"),
            })
    out.sort(key=lambda x: x["average"])
    return out[:20]


@router.get("/trends")
def trends(db: Session = Depends(get_db), user=Depends(_allowed)):
    """Grade-wise averages (bar) and exam-wise averages (line)."""
    school = _school_of(user, db)
    data = _gather_school_data(db, school)
    return {
        "by_grade": [{"grade": g["grade"], "average": g["average"],
                      "students": g["students"], "classes": g["classes"]}
                     for g in data["grades"]],
        "by_exam": [{"exam_id": e["exam_id"], "name": e["name"], "term": e["term"],
                     "grade": e["grade"], "max_score": e["max_score"],
                     "average": e["average"]} for e in data["exams"]],
    }


# ─────────────────────────────────────────────────────────────────────────────
# NEW: grade inspect & section compare
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/grades/{grade}/inspect")
def grade_inspect(grade: int, db: Session = Depends(get_db), user=Depends(_allowed)):
    """Deep dive into one grade: all sections/classes with full stats, the
    grade's overall avg, and section-vs-section subject comparison."""
    school = _school_of(user, db)
    data = _gather_school_data(db, school)
    grade_row = next((g for g in data["_grade_rows"] if g["grade"] == grade), None)
    if not grade_row:
        raise HTTPException(status_code=404, detail=f"No data for grade {grade} in this school.")

    # All classes (sections) of this grade with full per-class stats
    sections = [c for c in data["_class_rows"] if c["grade"] == grade]
    sections.sort(key=lambda c: c["section"])

    # Subject comparison across sections
    subject_comparison = []
    subjects_in_grade = grade_row["subject_averages"]
    for sub in subjects_in_grade:
        row = {
            "subject_id": sub["subject_id"], "name": sub["name"], "color": sub["color"],
            "grade_average": sub["average"],
            "sections": {},
            "best_section": None,
            "worst_section": None,
        }
        per_section = []
        for sec in sections:
            sa = next((s for s in sec["subject_averages"] if s["subject_id"] == sub["subject_id"]), None)
            avg_val = sa["average"] if sa else None
            row["sections"][sec["section"]] = avg_val
            if avg_val is not None:
                per_section.append((sec["section"], avg_val))
        if per_section:
            per_section.sort(key=lambda x: x[1], reverse=True)
            row["best_section"] = {"section": per_section[0][0], "average": per_section[0][1]}
            row["worst_section"] = {"section": per_section[-1][0], "average": per_section[-1][1]}
        subject_comparison.append(row)

    # top + bottom students in grade
    grade_students = sorted(
        (st for st in data["_student_stats"].values() if st["grade"] == grade),
        key=lambda x: x["average"], reverse=True
    )
    top_students = [{"student_id": s["student_id"], "name": s["name"],
                     "average": s["average"], "class_label": s["class_label"]}
                    for s in grade_students[:5]]
    bottom_students = [{"student_id": s["student_id"], "name": s["name"],
                        "average": s["average"], "class_label": s["class_label"]}
                       for s in grade_students[-5:][::-1]] if grade_students else []

    return {
        "grade": grade,
        "school": data["school"],
        "grade_average": grade_row["average"],
        "attendance_rate": grade_row["attendance_rate"],
        "total_students": grade_row["students"],
        "sections_count": len(sections),
        "sections": sections,
        "subject_averages": grade_row["subject_averages"],
        "subject_comparison": subject_comparison,
        "top_students": top_students,
        "bottom_students": bottom_students,
        "top_student": grade_row["top_student"],
    }


@router.get("/grades/{grade}/sections/compare")
def grade_sections_compare(grade: int, db: Session = Depends(get_db), user=Depends(_allowed)):
    """Compare all sections of a grade side-by-side. Chart-ready matrix."""
    school = _school_of(user, db)
    data = _gather_school_data(db, school)
    grade_row = next((g for g in data["_grade_rows"] if g["grade"] == grade), None)
    if not grade_row:
        raise HTTPException(status_code=404, detail=f"No data for grade {grade} in this school.")
    sections = sorted((c for c in data["_class_rows"] if c["grade"] == grade), key=lambda c: c["section"])
    subjects_in_grade = grade_row["subject_averages"]
    matrix_rows = []
    for sec in sections:
        row = {
            "class_id": sec["class_id"], "section": sec["section"],
            "label": sec["label"], "students": sec["students"],
            "average": sec["average"],
            "attendance_rate": sec["attendance_rate"],
            "top_student": sec["top_student"],
            "at_risk_count": sec["at_risk_count"],
            "subject_averages": {s["subject_id"]: s["average"]
                                 for s in sec["subject_averages"]},
        }
        matrix_rows.append(row)
    # subject list (for chart axis)
    subject_axis = [{"subject_id": s["subject_id"], "name": s["name"], "color": s["color"]}
                    for s in subjects_in_grade]
    # Best section overall
    best_section = max(matrix_rows, key=lambda r: r["average"]) if matrix_rows else None
    return {
        "grade": grade,
        "subjects": subject_axis,
        "sections": matrix_rows,
        "best_section": best_section,
        "grade_average": grade_row["average"],
    }


# ─────────────────────────────────────────────────────────────────────────────
# NEW: class & student deep dives
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/classes/{class_id}/inspect")
def class_inspect(class_id: int, db: Session = Depends(get_db), user=Depends(_allowed)):
    """Deep dive into one class: all students with their marks per subject
    per exam, averages, attendance, rank, grade. Plus class-level subject
    averages."""
    school = _school_of(user, db)
    data = _gather_school_data(db, school)
    class_row = next((c for c in data["_class_rows"] if c["class_id"] == class_id), None)
    if not class_row:
        raise HTTPException(status_code=404, detail=f"Class {class_id} not found in your school.")
    exam_by_id = data["_exam_by_id"]
    subject_by_id = data["_subject_by_id"]
    grade_exams = data["_grade_exams"].get(class_row["grade"], [])
    pills = _teacher_pills_map(db, [class_id]).get(class_id, {"class_teacher_name": None,
                                                              "subject_teachers": {}})

    # Build the student×subject×exam grid
    students_full = []
    for st in data["_student_stats"].values():
        if st["class_id"] != class_id:
            continue
        # marks grid: {subject_id: {exam_id: pct}}
        grid: dict[int, dict[int, float]] = defaultdict(dict)
        for (subj_id, p, exam_id) in st["_marks"]:
            grid[subj_id][exam_id] = round(p, 1)
        students_full.append({
            "student_id": st["student_id"], "name": st["name"], "roll_no": st["roll_no"],
            "average": st["average"], "attendance_rate": st["attendance_rate"],
            "rank_in_class": st.get("rank_in_class"),
            "rank_in_grade": st.get("rank_in_grade"),
            "class_size": st.get("class_size"),
            "grade_size": st.get("grade_size"),
            "strongest_subject": st["strongest_subject"],
            "weakest_subject": st["weakest_subject"],
            "improvement_delta": st["improvement_delta"],
            "marks_grid": {str(subj_id): {str(eid): p for eid, p in d.items()}
                           for subj_id, d in grid.items()},
        })
    students_full.sort(key=lambda x: x["rank_in_class"] or 9999)

    # Subject list for this class
    subjects_in_class = class_row["subject_averages"]
    # Exam list for this class
    exams_in_class = []
    for eid in grade_exams:
        ex = exam_by_id.get(eid)
        if ex:
            exams_in_class.append({
                "exam_id": ex.id, "name": ex.name, "term": ex.term,
                "max_score": ex.max_score,
            })

    return {
        "class_id": class_id,
        "label": class_row["label"],
        "grade": class_row["grade"],
        "section": class_row["section"],
        "school": data["school"],
        "students_count": class_row["students"],
        "class_average": class_row["average"],
        "attendance_rate": class_row["attendance_rate"],
        "top_student": class_row["top_student"],
        "bottom_student": class_row["bottom_student"],
        "at_risk_count": class_row["at_risk_count"],
        "subject_averages": subjects_in_class,
        "exam_averages": class_row["exam_averages"],
        "exams": exams_in_class,
        "students": students_full,
        # teacher pills (designer prototype: CT pill + per-subject teachers)
        "class_teacher_name": pills.get("class_teacher_name"),
        "subject_teachers": pills.get("subject_teachers", {}),
    }


@router.get("/students/{student_id}/profile")
def student_profile(student_id: int, db: Session = Depends(get_db), user=Depends(_allowed)):
    """One student's full profile."""
    school = _school_of(user, db)
    data = _gather_school_data(db, school)
    st = data["_student_stats"].get(student_id)
    if not st:
        raise HTTPException(status_code=404, detail=f"Student {student_id} not found in your school.")
    subject_by_id = data["_subject_by_id"]
    exam_by_id = data["_exam_by_id"]

    # Subject×exam grid for this student (with full labels)
    grid: dict[int, dict[int, float]] = defaultdict(dict)
    for (subj_id, p, exam_id) in st["_marks"]:
        grid[subj_id][exam_id] = round(p, 1)
    grid_out = []
    for subj_id, exam_map in grid.items():
        sub = subject_by_id.get(subj_id)
        if not sub:
            continue
        row = {
            "subject_id": subj_id, "name": sub.name, "color": sub.color,
            "scores": [],
            "average": st["subject_averages"].get(subj_id, 0.0),
        }
        for eid, pct in exam_map.items():
            ex = exam_by_id.get(eid)
            row["scores"].append({
                "exam_id": eid, "exam_name": ex.name if ex else "?",
                "term": ex.term if ex else None, "max_score": ex.max_score if ex else None,
                "percentage": pct,
            })
        row["scores"].sort(key=lambda x: x["exam_id"])
        grid_out.append(row)
    grid_out.sort(key=lambda x: x["name"])

    # Improvement trend
    trend = None
    if st["first_exam_average"] is not None and st["last_exam_average"] is not None:
        delta = st["improvement_delta"]
        if delta is None:
            direction = "stable"
        elif delta > 1.5:
            direction = "improving"
        elif delta < -1.5:
            direction = "declining"
        else:
            direction = "stable"
        trend = {
            "first_exam_average": st["first_exam_average"],
            "last_exam_average": st["last_exam_average"],
            "delta": delta,
            "direction": direction,
        }

    # Attendance history (chronological)
    att_history = [{"date": d, "status": s} for (d, s) in st["attendance_history"]]

    # Per-subject term averages: {subject_name: {"t1": x, "t2": y, "t3": z}}
    # derived from this student's marks grouped by exam.term. Missing terms
    # stay null.
    term_by_exam = {eid: _term_key(ex.term) for eid, ex in exam_by_id.items()}
    sub_term_pcts: dict[str, dict[int, list[float]]] = defaultdict(
        lambda: {1: [], 2: [], 3: []})
    for (subj_id, p, exam_id) in st["_marks"]:
        tn = term_by_exam.get(exam_id)
        sub = subject_by_id.get(subj_id)
        if tn is None or sub is None:
            continue
        sub_term_pcts[sub.name][tn].append(p)
    subject_term_averages = {}
    for sname, buckets in sub_term_pcts.items():
        subject_term_averages[sname] = {
            f"t{k}": (round(sum(v) / len(v), 1) if v else None) for k, v in buckets.items()
        }

    return {
        "student_id": st["student_id"],
        "name": st["name"],
        "roll_no": st["roll_no"],
        "class_label": st["class_label"],
        "class_id": st["class_id"],
        "grade": st["grade"],
        "section": st["section"],
        "school": data["school"],
        "average": st["average"],
        "attendance_rate": st["attendance_rate"],
        "rank_in_class": st.get("rank_in_class"),
        "class_size": st.get("class_size"),
        "rank_in_grade": st.get("rank_in_grade"),
        "grade_size": st.get("grade_size"),
        "strongest_subject": st["strongest_subject"],
        "weakest_subject": st["weakest_subject"],
        "improvement_trend": trend,
        "variance": st["variance"],
        "subject_exam_grid": grid_out,
        "attendance_history": att_history,
        "subject_term_averages": subject_term_averages,
    }


# ─────────────────────────────────────────────────────────────────────────────
# NEW: rankings
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/rankings")
def rankings(db: Session = Depends(get_db), user=Depends(_allowed)):
    """School-wide rankings: top 10, bottom 10, most improved, most consistent."""
    school = _school_of(user, db)
    data = _gather_school_data(db, school)
    students = list(data["_student_stats"].values())

    # Top 10
    top10 = sorted(students, key=lambda x: x["average"], reverse=True)[:10]
    top10_out = [{"student_id": s["student_id"], "name": s["name"],
                  "average": s["average"], "class_label": s["class_label"],
                  "grade": s["grade"], "attendance_rate": s["attendance_rate"]}
                 for s in top10]

    # Bottom 10 (at-risk)
    bottom10 = sorted(students, key=lambda x: x["average"])[:10]
    bottom10_out = [{"student_id": s["student_id"], "name": s["name"],
                     "average": s["average"], "class_label": s["class_label"],
                     "grade": s["grade"], "attendance_rate": s["attendance_rate"],
                     "weakest_subject": s["weakest_subject"]}
                    for s in bottom10]

    # Most improved — biggest positive delta between first and last exam
    improved = [s for s in students if s["improvement_delta"] is not None]
    improved.sort(key=lambda x: x["improvement_delta"], reverse=True)
    most_improved_out = [{"student_id": s["student_id"], "name": s["name"],
                         "class_label": s["class_label"], "grade": s["grade"],
                         "first_exam_average": s["first_exam_average"],
                         "last_exam_average": s["last_exam_average"],
                         "improvement_delta": s["improvement_delta"]}
                        for s in improved[:10]]

    # Most consistent — lowest variance
    consistent = [s for s in students if s["variance"] is not None]
    consistent.sort(key=lambda x: x["variance"])
    most_consistent_out = [{"student_id": s["student_id"], "name": s["name"],
                           "class_label": s["class_label"], "grade": s["grade"],
                           "average": s["average"], "variance": s["variance"]}
                          for s in consistent[:10]]

    return {
        "top_10": top10_out,
        "bottom_10": bottom10_out,
        "most_improved": most_improved_out,
        "most_consistent": most_consistent_out,
    }


# ─────────────────────────────────────────────────────────────────────────────
# NEW: insights
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/insights")
def insights(db: Session = Depends(get_db), user=Depends(_allowed)):
    """Algorithmic insights: improvement index, consistency score, subject
    gap, attendance impact, grade trajectory."""
    school = _school_of(user, db)
    data = _gather_school_data(db, school)
    out: list[dict] = []

    # 1) Improvement index per class (avg first exam vs avg last exam)
    for c in data["_class_rows"]:
        exams_sorted = sorted(c["exam_averages"], key=lambda e: e["exam_id"])
        if len(exams_sorted) < 2:
            continue
        first_avg = exams_sorted[0]["average"]
        last_avg = exams_sorted[-1]["average"]
        delta = round(last_avg - first_avg, 1)
        severity = "good" if delta > 1.5 else ("critical" if delta < -1.5 else "warning")
        out.append({
            "type": "class_improvement",
            "title": f"Class {c['label']} improvement",
            "value": delta,
            "detail": (f"{c['label']} moved from {first_avg}% in '{exams_sorted[0]['name']}' "
                       f"to {last_avg}% in '{exams_sorted[-1]['name']}' "
                       f"({delta:+}% across {len(exams_sorted)} exams)."),
            "severity": severity,
            "class_id": c["class_id"],
        })

    # 2) Consistency score per class (std-dev of student averages; lower = more consistent)
    for c in data["_class_rows"]:
        cls_students = [st for st in data["_student_stats"].values() if st["class_id"] == c["class_id"]]
        avgs = [s["average"] for s in cls_students]
        if len(avgs) < 2:
            continue
        sd = round(statistics.pstdev(avgs), 2)
        severity = "good" if sd < 8 else ("warning" if sd < 14 else "critical")
        out.append({
            "type": "class_consistency",
            "title": f"Class {c['label']} consistency",
            "value": sd,
            "detail": (f"Student-average spread in {c['label']} is σ={sd} percentage points "
                       f"({len(avgs)} students). Lower means more uniform performance — "
                       f"high σ suggests uneven teaching/learning."),
            "severity": severity,
            "class_id": c["class_id"],
        })

    # 3) Subject gap — biggest performance gap between best and worst class, per subject
    for sub in data["subjects"]:
        per_class_avgs = []
        for c in data["_class_rows"]:
            sa = next((s for s in c["subject_averages"] if s["subject_id"] == sub["subject_id"]), None)
            if sa and sa["average"] is not None:
                per_class_avgs.append((c["label"], sa["average"]))
        if len(per_class_avgs) < 2:
            continue
        per_class_avgs.sort(key=lambda x: x[1])
        worst = per_class_avgs[0]
        best = per_class_avgs[-1]
        gap = round(best[1] - worst[1], 1)
        if gap < 5:  # ignore negligible gaps
            continue
        severity = "warning" if gap < 15 else "critical"
        out.append({
            "type": "subject_gap",
            "title": f"{sub['name']} gap = {gap}%",
            "value": gap,
            "detail": (f"{sub['name']} ranges from {worst[0]} ({worst[1]}%) to "
                       f"{best[0]} ({best[1]}%) — a {gap} percentage-point gap."),
            "severity": severity,
            "subject_id": sub["subject_id"],
        })

    # 4) Attendance impact — correlation between attendance rate and average score
    pairs = [(st["attendance_rate"], st["average"]) for st in data["_student_stats"].values()]
    corr = _pearson(pairs)
    if corr is not None:
        severity = "good" if corr >= 0.3 else ("warning" if corr >= 0.1 else "critical")
        out.append({
            "type": "attendance_impact",
            "title": "Attendance ↔ Performance correlation",
            "value": round(corr, 3),
            "detail": (f"Across {len(pairs)} students, Pearson r = {corr:.3f} between attendance "
                       f"rate and average score. "
                       + ("Strong positive — attendance clearly matters." if corr >= 0.3 else
                          "Weak positive — attendance isn't the main driver." if corr >= 0.1 else
                          "Negligible — performance is driven by something else.")),
            "severity": severity,
        })

    # 5) Grade trajectory — does performance rise or fall from grade 1 to 10?
    grade_avgs = [(g["grade"], g["average"]) for g in data["grades"] if g["students"] > 0]
    grade_avgs.sort(key=lambda x: x[0])
    if len(grade_avgs) >= 2:
        first_grade, first_avg = grade_avgs[0]
        last_grade, last_avg = grade_avgs[-1]
        delta = round(last_avg - first_avg, 1)
        trajectory = ("rising" if delta > 1 else "falling" if delta < -1 else "flat")
        severity = "good" if delta > 1 else ("critical" if delta < -1 else "warning")
        out.append({
            "type": "grade_trajectory",
            "title": f"Grade {first_grade} → {last_grade} trajectory",
            "value": delta,
            "detail": (f"School-wide average moves from {first_avg}% in Grade {first_grade} "
                       f"to {last_avg}% in Grade {last_grade} ({trajectory}, {delta:+}%)."),
            "severity": severity,
        })

    return out


def _pearson(pairs: list[tuple[float, float]]) -> Optional[float]:
    """Pearson correlation; returns None if not enough variance."""
    n = len(pairs)
    if n < 3:
        return None
    xs = [p[0] for p in pairs]
    ys = [p[1] for p in pairs]
    mx = sum(xs) / n
    my = sum(ys) / n
    num = sum((x - mx) * (y - my) for x, y in pairs)
    denom_x = sum((x - mx) ** 2 for x in xs) ** 0.5
    denom_y = sum((y - my) ** 2 for y in ys) ** 0.5
    if denom_x == 0 or denom_y == 0:
        return None
    return num / (denom_x * denom_y)


# ─────────────────────────────────────────────────────────────────────────────
# AI ANALYZE — Agentic (tool-calling) Groq → z-ai → fallback
# ─────────────────────────────────────────────────────────────────────────────
class AnalyzeBody(BaseModel):
    question: str
    # recent panel turns (role: user|assistant, content) → follow-up memory
    history: Optional[List[dict]] = None


SYSTEM_PROMPT = (
    "You are the Fetch-X AI principal's analyst — a rigorous, data-driven "
    "assistant with live, tool-based access to the school's real data "
    "(students, classes, subjects, exams, attendance, tasks, teachers). "
    "When you need specific facts, call tools (chain several if needed); "
    "when a tool returns a ```chart block, include it verbatim so the "
    "principal sees the graph. Answer with detailed markdown — ## headers, "
    "**bold**, - bullets — citing exact names and numbers, explaining causes "
    "and trade-offs, and ending with concrete prioritized recommendations. "
    "Never invent data; if something isn't available, say so."
)


def _build_data_snapshot(data: dict) -> dict:
    """Rich JSON snapshot built from `_gather_school_data` for the AI prompt."""
    # Top performers (top 5)
    student_stats = data["_student_stats"]
    ranked = sorted(student_stats.values(), key=lambda x: x["average"], reverse=True)
    top_performers = [{"name": s["name"], "average": s["average"],
                       "class_label": s["class_label"]} for s in ranked[:5]]
    # At-risk students (bottom 5)
    at_risk = sorted(student_stats.values(), key=lambda x: x["average"])[:5]
    at_risk_out = [{"name": s["name"], "average": s["average"],
                    "attendance_rate": s["attendance_rate"],
                    "class_label": s["class_label"],
                    "weakest_subject": s["weakest_subject"]["name"] if s["weakest_subject"] else None}
                   for s in at_risk]
    return {
        "school_name": data["school"]["name"],
        "totals": {
            "students": data["total_students"],
            "classes": data["total_classes"],
            "exams": data["total_exams"],
        },
        "school_average_pct": data["school_average"],
        "top_performer": data["top_performer"],
        "grade_breakdown": [
            {"grade": g["grade"], "students": g["students"],
             "average_pct": g["average"], "attendance_pct": g["attendance_rate"]}
            for g in data["grades"]
        ],
        "class_breakdown": [
            {"label": c["label"], "students": c["students"],
             "average_pct": c["average"], "attendance_pct": c["attendance_rate"],
             "top_student": c["top_student"]["name"] if c["top_student"] else None,
             "weakest_subject": c["weakest_subject"]["name"] if c["weakest_subject"] else None,
             "at_risk_count": c["at_risk_count"]}
            for c in data["classes"]
        ],
        "subject_breakdown": [
            {"subject": s["name"], "average_pct": s["average"],
             "student_count": s["student_count"], "pass_rate": s["pass_rate"]}
            for s in data["subjects"]
        ],
        "top_performers": top_performers,
        "at_risk_students": at_risk_out,
        "insights": _build_insights_summary(data),
    }


def _build_insights_summary(data: dict) -> dict:
    """Lightweight insights summary embedded in the AI snapshot."""
    # grade trajectory
    grade_avgs = [(g["grade"], g["average"]) for g in data["grades"] if g["students"] > 0]
    grade_avgs.sort()
    trajectory = None
    if len(grade_avgs) >= 2:
        first_grade, first_avg = grade_avgs[0]
        last_grade, last_avg = grade_avgs[-1]
        trajectory = {"from_grade": first_grade, "to_grade": last_grade,
                      "from_avg": first_avg, "to_avg": last_avg,
                      "delta": round(last_avg - first_avg, 1)}
    # subject gap (largest)
    largest_gap = None
    for sub in data["subjects"]:
        per_class_avgs = []
        for c in data["classes"]:
            sa = next((s for s in c["subject_averages"] if s["subject_id"] == sub["subject_id"]), None)
            if sa:
                per_class_avgs.append((c["label"], sa["average"]))
        if len(per_class_avgs) < 2:
            continue
        per_class_avgs.sort(key=lambda x: x[1])
        gap = round(per_class_avgs[-1][1] - per_class_avgs[0][1], 1)
        if largest_gap is None or gap > largest_gap["gap"]:
            largest_gap = {"subject": sub["name"], "gap": gap,
                           "worst_class": per_class_avgs[0][0],
                           "best_class": per_class_avgs[-1][0]}
    return {
        "grade_trajectory": trajectory,
        "largest_subject_gap": largest_gap,
        "weakest_subject": min(data["subjects"], key=lambda s: s["average"])["name"] if data["subjects"] else None,
        "strongest_subject": max(data["subjects"], key=lambda s: s["average"])["name"] if data["subjects"] else None,
    }


def _compact_school_summary(data: dict) -> str:
    """One-paragraph text snapshot the agentic LLM uses as background context
    (so it knows the school's shape without having to call a tool first)."""
    weak = min(data["subjects"], key=lambda s: s["average"])["name"] if data["subjects"] else "?"
    strong = max(data["subjects"], key=lambda s: s["average"])["name"] if data["subjects"] else "?"
    top = data.get("top_performer") or {}
    at_risk_count = sum(1 for st in data["_student_stats"].values()
                        if st["average"] < 50 or st["attendance_rate"] < 60)
    grade_summary = ", ".join(
        f"Grade {g['grade']}: avg {g['average']}% ({g['students']} students)"
        for g in data["grades"]
    )
    subject_summary = ", ".join(
        f"{s['name']}: {s['average']}%" for s in data["subjects"]
    )
    return (
        f"School: {data['school']['name']} — "
        f"{data['total_students']} students, {data['total_classes']} classes, "
        f"{data['total_exams']} exams. "
        f"School average: {data['school_average']}%. "
        f"At-risk students: {at_risk_count}. "
        f"Top performer: {top.get('name', '?')} ({top.get('average', '?')}%). "
        f"Strongest subject: {strong}. Weakest subject: {weak}. "
        f"Grades — {grade_summary}. "
        f"Subjects — {subject_summary}."
    )


@router.post("/ai/analyze")
@limiter.limit("30/minute")
async def ai_analyze(request: Request, body: AnalyzeBody, db: Session = Depends(get_db), user=Depends(_allowed)):
    question = (body.question or "").strip()
    school = _school_of(user, db)
    data = _gather_school_data(db, school)
    snapshot = _build_data_snapshot(data)

    if not question:
        return {
            "answer": "Ask me about school performance, top performers, or grade comparisons.",
            "source": "fallback",
            "data_snapshot": snapshot,
            "tools_used": [],
        }

    # Agentic loop: give the LLM the principal's tool set + the pre-computed
    # school snapshot so it can answer with specific names and numbers.
    result = await ask_ai_agentic(
        question=question,
        system_prompt=SYSTEM_PROMPT,
        db=db,
        tools=PRINCIPAL_TOOLS,
        context_summary=_compact_school_summary(data),
        ctx={"school": school, "_data": data},
        history=body.history,
    )
    return {
        "answer": result["answer"],
        "source": result["source"],
        "tools_used": result.get("tools_used", []),
        "data_snapshot": snapshot,
    }


# ─────────────────────────────────────────────────────────────────────────────
# New endpoints for dedicated pages (Task: more pages + comparison tool)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/students")
def list_students(
    search: str = None,
    page: int = 1,
    page_size: int = 50,
    grade: int = None,
    class_id: int = None,
    min_avg: float = None,
    sort: str = "average",
    order: str = "desc",
    limit: int = None,
    offset: int = None,
    db: Session = Depends(get_db),
    user=Depends(_allowed),
):
    """Paginated, searchable, school-ranked student list.

    New (Fetch-X dashboard) contract: ``?search=&page=&page_size=`` →
    ``{"students":[{id,name,class_id,class_name,avg,trend,attendance_pct,
    rank_in_school}],"total","page","page_size"}``, ordered by rank_in_school
    (avg desc). page is 1-based; page_size defaults to 50 and is capped at 200.

    Legacy params (grade / class_id / sort / order / limit / offset) from the
    old Students explorer still work, and every row keeps the legacy field
    names (student_id, class_label, average, attendance_rate, at_risk) as
    aliases of the new ones so old pages continue to render.
    """
    school = _school_of(user, db)
    classes = db.query(Class).filter(Class.school_id == school.id).all()
    class_by_id = {c.id: c for c in classes}
    class_ids = [c.id for c in classes]
    if not class_ids:
        return {"students": [], "total": 0, "page": 1, "page_size": min(max(int(page_size or 50), 1), 200),
                "limit": 0, "offset": 0}

    if class_id:
        class_ids = [cid for cid in class_ids if cid == class_id]
    elif grade:
        class_ids = [cid for cid, c in class_by_id.items() if c.grade == grade]

    # ── per-student aggregates (one grouped query + one attendance query) ──
    pct = _pct_expr()
    term_sums: dict[int, dict] = defaultdict(lambda: defaultdict(lambda: [0.0, 0]))
    for sid_, term_label, s, n in (
        db.query(Mark.student_id, Exam.term, func.sum(pct), func.count(Mark.id))
          .select_from(Mark)
          .join(Exam, Mark.exam_id == Exam.id)
          .join(Student, Mark.student_id == Student.id)
          .filter(Student.class_id.in_(class_ids), Exam.max_score > 0)
          .group_by(Mark.student_id, Exam.term)
          .all()
    ):
        t = _term_key(term_label)
        if t is None:
            continue
        term_sums[sid_][t][0] += s or 0.0
        term_sums[sid_][t][1] += n

    att: dict[int, list[int]] = defaultdict(lambda: [0, 0])
    student_ids_in_scope = [
        s_id for (s_id,) in db.query(Student.id).filter(Student.class_id.in_(class_ids)).all()
    ]
    if student_ids_in_scope:
        for sid_, n, p in (
            db.query(Attendance.student_id, func.count(Attendance.id),
                     func.sum(case((Attendance.status == "P", 1), else_=0)))
              .filter(Attendance.student_id.in_(student_ids_in_scope))
              .group_by(Attendance.student_id)
              .all()
        ):
            att[sid_] = [p or 0, n]

    students = db.query(Student).filter(Student.class_id.in_(class_ids)).all()
    rows = []
    for s in students:
        sums = term_sums.get(s.id, {})
        total_s = sum(v[0] for v in sums.values())
        total_n = sum(v[1] for v in sums.values())
        avg = (total_s / total_n) if total_n else 0.0
        t1 = (sums[1][0] / sums[1][1]) if sums.get(1, [0, 0])[1] else 0.0
        t3 = (sums[3][0] / sums[3][1]) if sums.get(3, [0, 0])[1] else 0.0
        p, n = att.get(s.id, [0, 0])
        att_rate = (p / n * 100) if n else 0.0
        c = class_by_id.get(s.class_id)
        rows.append({
            "id": s.id, "student_id": s.id, "name": s.name, "roll_no": s.roll_no,
            "class_id": s.class_id,
            "class_name": f"{c.grade}-{c.section}" if c else "",
            "class_label": f"Grade {c.grade}-{c.section}" if c else "—",
            "grade": c.grade if c else None,
            "avg": round(avg, 1), "average": round(avg, 1),
            "trend": round(t3 - t1, 1),
            "attendance_pct": round(att_rate, 1), "attendance_rate": round(att_rate, 1),
            "at_risk": avg < 50 or att_rate < 60,
        })

    # rank_in_school by avg desc (dense over the whole school, before filters)
    rows.sort(key=lambda r: r["avg"], reverse=True)
    for i, r in enumerate(rows, start=1):
        r["rank_in_school"] = i

    # ── search + ordering + pagination ──────────────────────────────────────
    if search:
        needle = search.strip().lower()
        rows = [r for r in rows if needle in r["name"].lower()]

    # v15 designer update: rank-band filter tabs (ALL / 90+ / 80+ / …)
    if min_avg is not None:
        try:
            min_avg_val = float(min_avg)
        except (TypeError, ValueError):
            min_avg_val = 0.0
        if min_avg_val > 0:
            rows = [r for r in rows if r["avg"] >= min_avg_val]

    reverse = (order != "asc")
    if sort == "name":
        rows.sort(key=lambda r: r["name"].lower(), reverse=reverse)
    else:
        rows.sort(key=lambda r: (-r["avg"], r["name"].lower()))

    total = len(rows)
    if limit is not None:  # legacy paging
        lim = min(max(int(limit), 0), 200)
        off = max(int(offset or 0), 0)
        page_out, page_size_out = 1, lim
    else:  # new paging (1-based page)
        page_size_out = min(max(int(page_size or 50), 1), 200)
        page_out = max(int(page or 1), 1)
        lim, off = page_size_out, (page_out - 1) * page_size_out

    return {
        "students": rows[off:off + lim],
        "total": total,
        "page": page_out,
        "page_size": page_size_out,
        "limit": lim,
        "offset": off,
    }


@router.get("/subjects/{subject_id}/deep-dive")
def subject_deep_dive(subject_id: int, db: Session = Depends(get_db), user=Depends(_allowed)):
    """Deep dive into one subject: per-grade averages, per-class averages, top/bottom students."""
    school = _school_of(user, db)
    subject = db.query(Subject).filter(Subject.id == subject_id).first()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    classes = db.query(Class).filter(Class.school_id == school.id).all()
    from app.models.mark import Mark
    from app.models.exam import Exam
    from sqlalchemy import func

    # per-grade breakdown
    grade_data = {}
    for c in classes:
        g = c.grade
        if g not in grade_data:
            grade_data[g] = {"grade": g, "classes": 0, "students": 0, "average": 0, "_pcts": []}
        grade_data[g]["classes"] += 1
    students = db.query(Student).filter(Student.class_id.in_([c.id for c in classes])).all()
    stu_by_class = {s.id: s for s in students}
    # Scope marks to THIS school's students — the previous
    # `.filter(Mark.subject_id == subject_id)` loaded that subject's marks
    # for every school in the DB before filtering in Python (slow + mixed
    # other tenants' rows into per-class buckets via id collisions).
    student_ids = [s.id for s in students]
    marks = (db.query(Mark)
             .filter(Mark.subject_id == subject_id,
                     Mark.student_id.in_(student_ids) if student_ids else False)
             .all())
    exams = db.query(Exam).filter(Exam.school_id == school.id).all()
    exam_by_id = {e.id: e for e in exams}
    class_averages = []
    top_students = []
    bottom_students = []
    for c in classes:
        class_stu = [s for s in students if s.class_id == c.id]
        class_marks = [m for m in marks if stu_by_class.get(m.student_id) and stu_by_class[m.student_id].class_id == c.id]
        pcts = []
        for m in class_marks:
            ex = exam_by_id.get(m.exam_id)
            if ex and ex.max_score:
                pcts.append((m.score / ex.max_score) * 100)
        if pcts:
            avg = round(sum(pcts) / len(pcts), 1)
            class_averages.append({
                "class_id": c.id, "label": f"Grade {c.grade}-{c.section}", "grade": c.grade,
                "average": avg, "student_count": len(class_stu),
            })
            grade_data[c.grade]["_pcts"].extend(pcts)
            grade_data[c.grade]["students"] += len(class_stu)
            # per-student avg for this subject
            stu_pcts = {}
            for m in class_marks:
                ex = exam_by_id.get(m.exam_id)
                if ex and ex.max_score:
                    stu_pcts.setdefault(m.student_id, []).append((m.score / ex.max_score) * 100)
            for sid, spcts in stu_pcts.items():
                s = stu_by_class.get(sid)
                if s:
                    savg = round(sum(spcts) / len(spcts), 1)
                    entry = {"student_id": sid, "name": s.name, "class_label": f"Grade {c.grade}-{c.section}", "average": savg}
                    top_students.append(entry)
                    bottom_students.append(entry)
    top_students.sort(key=lambda x: x["average"], reverse=True)
    bottom_students.sort(key=lambda x: x["average"])
    grade_rows = []
    for g in sorted(grade_data.keys()):
        d = grade_data[g]
        avg = round(sum(d["_pcts"]) / len(d["_pcts"]), 1) if d["_pcts"] else 0
        grade_rows.append({"grade": g, "classes": d["classes"], "students": d["students"], "average": avg})
    overall_pcts = [p for d in grade_data.values() for p in d["_pcts"]]
    overall_avg = round(sum(overall_pcts) / len(overall_pcts), 1) if overall_pcts else 0
    return {
        "subject": {"id": subject.id, "name": subject.name, "color": subject.color},
        "school_average": overall_avg,
        "grade_breakdown": grade_rows,
        "class_breakdown": sorted(class_averages, key=lambda x: x["average"], reverse=True),
        "top_students": top_students[:10],
        "bottom_students": bottom_students[:10],
    }


@router.get("/attendance/analytics")
def attendance_analytics(db: Session = Depends(get_db), user=Depends(_allowed)):
    """School-wide attendance analytics: per-grade rates, per-day trends, at-risk-by-attendance."""
    school = _school_of(user, db)
    classes = db.query(Class).filter(Class.school_id == school.id).all()
    class_ids = [c.id for c in classes]
    students = db.query(Student).filter(Student.class_id.in_(class_ids)).all() if class_ids else []
    records = db.query(Attendance).filter(
        Attendance.student_id.in_([s.id for s in students])
    ).all() if students else []
    # per-grade
    grade_map = {c.id: c.grade for c in classes}
    grade_data = {}
    for s in students:
        g = grade_map.get(s.class_id)
        if g not in grade_data:
            grade_data[g] = {"grade": g, "total": 0, "present": 0, "absent": 0, "late": 0, "rate": 0, "students": 0}
        grade_data[g]["students"] += 1
    # O(1) student → grade lookup (the previous `next(...)` scan inside the
    # record loop made this O(records × students) — ~7M comparisons on the
    # demo dataset).
    student_grade = {s.id: grade_map.get(s.class_id) for s in students}
    for r in records:
        g = student_grade.get(r.student_id)
        if g is None or g not in grade_data:
            continue
        grade_data[g]["total"] += 1
        if r.status == "P": grade_data[g]["present"] += 1
        elif r.status == "A": grade_data[g]["absent"] += 1
        elif r.status == "L": grade_data[g]["late"] += 1
    grade_rows = []
    for g in sorted(grade_data.keys()):
        d = grade_data[g]
        d["rate"] = round((d["present"] / d["total"]) * 100, 1) if d["total"] else 0
        grade_rows.append(d)
    # per-day (last 7 days that have records)
    from collections import Counter
    day_counts = Counter()
    day_present = Counter()
    for r in records:
        d = str(r.date)
        day_counts[d] += 1
        if r.status == "P": day_present[d] += 1
    day_rows = [{"date": d, "total": day_counts[d], "present": day_present[d], "rate": round((day_present[d]/day_counts[d])*100,1) if day_counts[d] else 0} for d in sorted(day_counts.keys())[-7:]]
    return {"grade_breakdown": grade_rows, "daily_trend": day_rows, "total_records": len(records)}


# ─────────────────────────────────────────────────────────────────────────────
# NEW: designer Principal Dashboard data endpoints (Term 1/2/3, daily
# attendance series, task completion stats)
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/attendance/series")
def attendance_series(scope: str = "school", id: Optional[int] = None, days: int = 90,
                      db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Daily attendance percentage for the last `days` calendar days.

    Returns {"points": [{"date": "YYYY-MM-DD", "pct": 93.4}, ...]} — exactly
    one point per school day (Mon-Fri) in range. pct = present/total*100 where
    only status "P" counts as present — the exact same semantics as the
    existing attendance_rate in `_gather_school_data`, /attendance/summary and
    /principal/attendance/analytics, so numbers agree across the UI (L counts
    against the rate). Days with no records yield pct = null.

    Scope rules: "school" stays leadership-only; "class" and "student" open up
    to the same object-level guards the /attendance router uses, so the v15
    class-teacher console and report cards can load their own class's trend
    without holding a principal role.
    """
    days = max(1, min(int(days or 90), 365))
    today = date.today()
    start = today - timedelta(days=days - 1)

    def _daily(q):
        return (q.filter(Attendance.date >= start, Attendance.date <= today)
                 .group_by(Attendance.date)
                 .all())

    if scope == "school":
        if user.role not in ("principal", "super_admin", "school_admin"):
            raise HTTPException(status_code=403,
                                detail="School-wide analytics require a leadership role.")
        school = _school_of(user, db)
        rows = _daily(
            db.query(Attendance.date.label("d"),
                     func.count(Attendance.id).label("total"),
                     func.sum(case((Attendance.status == "P", 1), else_=0)).label("pres"))
              .join(Student, Attendance.student_id == Student.id)
              .join(Class, Student.class_id == Class.id)
              .filter(Class.school_id == school.id))
    elif scope == "class":
        if not id:
            raise HTTPException(status_code=400, detail="Query param 'id' is required for scope=class.")
        cls = db.query(Class).filter(Class.id == id).first()
        if not cls:
            raise HTTPException(status_code=404, detail="Class not found.")
        assert_class_access(user, cls)
        rows = _daily(
            db.query(Attendance.date.label("d"),
                     func.count(Attendance.id).label("total"),
                     func.sum(case((Attendance.status == "P", 1), else_=0)).label("pres"))
              .join(Student, Attendance.student_id == Student.id)
              .filter(Student.class_id == cls.id))
    elif scope == "student":
        if not id:
            raise HTTPException(status_code=400, detail="Query param 'id' is required for scope=student.")
        stu = db.query(Student).filter(Student.id == id).first()
        if not stu:
            raise HTTPException(status_code=404, detail="Student not found.")
        assert_student_access(user, stu, db)
        rows = _daily(
            db.query(Attendance.date.label("d"),
                     func.count(Attendance.id).label("total"),
                     func.sum(case((Attendance.status == "P", 1), else_=0)).label("pres"))
              .filter(Attendance.student_id == stu.id))
    else:
        raise HTTPException(status_code=400, detail="scope must be one of: school, class, student")

    by_date = {r[0]: ((r[1] or 0), (r[2] or 0)) for r in rows}
    points = []
    d = start
    while d <= today:
        if d.weekday() < 5:  # school days only (Mon-Fri)
            total, pres = by_date.get(d, (0, 0))
            points.append({"date": d.isoformat(),
                           "pct": (round(pres / total * 100, 1) if total else None)})
        d += timedelta(days=1)
    return {"points": points}


@router.get("/tasks/stats")
def tasks_stats(scope: str = "school", id: Optional[int] = None,
                db: Session = Depends(get_db), user=Depends(_allowed)):
    """Task-completion statistics from TaskCompletion rows.

    completion = completed / (completed + pending) * 100. scope=school rolls
    up by_subject AND by_class; scope=class narrows to one class and includes
    by_subject within that class only.
    """
    school = _school_of(user, db)
    q = (db.query(TaskCompletion.status, Task.subject_id, Task.class_id)
           .join(Task, TaskCompletion.task_id == Task.id)
           .join(Class, Task.class_id == Class.id)
           .filter(Class.school_id == school.id))
    if scope == "class":
        if not id:
            raise HTTPException(status_code=400, detail="Query param 'id' is required for scope=class.")
        cls = db.query(Class).filter(Class.id == id, Class.school_id == school.id).first()
        if not cls:
            raise HTTPException(status_code=404, detail="Class not found in your school.")
        q = q.filter(Task.class_id == cls.id)
    elif scope != "school":
        raise HTTPException(status_code=400, detail="scope must be one of: school, class")

    rows = q.all()
    overall = {"completed": 0, "pending": 0}
    by_subject_acc: dict[int, dict] = defaultdict(lambda: {"completed": 0, "pending": 0})
    by_class_acc: dict[int, dict] = defaultdict(lambda: {"completed": 0, "pending": 0})
    for status, subj_id, class_id in rows:
        bucket = None
        if status == "completed":
            bucket = "completed"
        elif status == "pending":
            bucket = "pending"
        if bucket is None:
            continue
        overall[bucket] += 1
        by_subject_acc[subj_id][bucket] += 1
        by_class_acc[class_id][bucket] += 1

    def _pct(done: int, pend: int) -> float:
        denom = done + pend
        return round(done / denom * 100, 1) if denom else 0.0

    subject_names = {s.id: s.name for s in db.query(Subject).all()}
    by_subject = [{"subject_id": sid, "name": subject_names.get(sid, "?"),
                   "pct": _pct(a["completed"], a["pending"])}
                  for sid, a in by_subject_acc.items()]
    by_subject.sort(key=lambda r: r["name"])

    by_class: list[dict] = []
    if scope == "school":
        class_by_id = {c.id: c for c in db.query(Class).filter(Class.school_id == school.id).all()}
        for cid, a in by_class_acc.items():
            c = class_by_id.get(cid)
            if not c:
                continue
            by_class.append({"class_id": cid, "name": f"Grade {c.grade}-{c.section}",
                             "pct": _pct(a["completed"], a["pending"])})
        by_class.sort(key=lambda r: r["name"])

    return {"overall_pct": _pct(overall["completed"], overall["pending"]),
            "by_subject": by_subject,
            "by_class": by_class}


@router.get("/terms")
def terms_overview(db: Session = Depends(get_db), user=Depends(_allowed)):
    """Average mark percentage grouped by exam term (Term 1/2/3).

    Averages of (score / exam.max_score * 100) — same mark semantics as the
    rest of the API. Returns school-level, per-subject and per-class term
    averages; missing terms are null.
    """
    school = _school_of(user, db)
    rows = (db.query(Exam.term, Mark.subject_id, Student.class_id,
                     func.avg(Mark.score * 100.0 / func.nullif(Exam.max_score, 0)).label("avg"),
                     func.count(Mark.id).label("n"))
              .join(Exam, Mark.exam_id == Exam.id)
              .join(Student, Mark.student_id == Student.id)
              .join(Class, Student.class_id == Class.id)
              .filter(Class.school_id == school.id, Exam.max_score > 0)
              .group_by(Exam.term, Mark.subject_id, Student.class_id)
              .all())

    # (term, subject, class) -> weighted-average accumulation
    school_acc = {1: [0.0, 0], 2: [0.0, 0], 3: [0.0, 0]}
    subject_acc: dict[int, dict] = defaultdict(lambda: {1: [0.0, 0], 2: [0.0, 0], 3: [0.0, 0]})
    class_acc: dict[int, dict] = defaultdict(lambda: {1: [0.0, 0], 2: [0.0, 0], 3: [0.0, 0]})
    for term_label, sid_, cid_, avg, n in rows:
        tn = _term_key(term_label)
        if tn is None or not n:
            continue
        val = (avg or 0.0) * n
        school_acc[tn][0] += val
        school_acc[tn][1] += n
        subject_acc[sid_][tn][0] += val
        subject_acc[sid_][tn][1] += n
        class_acc[cid_][tn][0] += val
        class_acc[cid_][tn][1] += n

    def _t3(acc) -> dict:
        return {f"t{k}": (round(acc[k][0] / acc[k][1], 1) if acc[k][1] else None)
                for k in (1, 2, 3)}

    subject_names = {s.id: s.name for s in db.query(Subject).all()}
    subjects = [{"subject_id": sid_, "name": subject_names.get(sid_, "?"),
                 **_t3(subject_acc[sid_])}
                for sid_ in sorted(subject_acc.keys())]

    classes = []
    school_classes = (db.query(Class).filter(Class.school_id == school.id)
                      .order_by(Class.grade, Class.section).all())
    for c in school_classes:
        row = {"class_id": c.id, "name": f"Grade {c.grade}-{c.section}",
               "grade": c.grade, "section": c.section}
        acc = class_acc.get(c.id)
        row.update(_t3(acc) if acc else {"t1": None, "t2": None, "t3": None})
        classes.append(row)

    return {"school": _t3(school_acc), "subjects": subjects, "classes": classes}


# ─────────────────────────────────────────────────────────────────────────────
# Fetch-X "School Intelligence" principal dashboard endpoints (Task 2-a).
#
# These are the fixed contracts the new frontend is coded against — field
# names must not change. Shared conventions:
#   - every average / percentage is rounded to 1 decimal
#   - a metric with no data returns 0 (never null)
#   - mark average = mean of (score / exam.max_score * 100) over the scope,
#     the exact same semantics as the legacy endpoints above
#   - attendance pct = present / total * 100 ("L" counts against the rate)
#   - at-risk = student avg < 50 OR attendance < 60 (legacy definition)
# ─────────────────────────────────────────────────────────────────────────────

def _pct_expr():
    """Mark percentage expression (guards against max_score = 0)."""
    return Mark.score * 100.0 / func.nullif(Exam.max_score, 0)


def _configured_subjects(db: Session, school_id: int) -> list:
    """Subjects configured for this school via GradeSubject, in seed order."""
    return (db.query(Subject)
              .join(GradeSubject, GradeSubject.subject_id == Subject.id)
              .filter(GradeSubject.school_id == school_id)
              .distinct()
              .order_by(Subject.id)
              .all())


def _term_sums(db: Session, school: School, grade: int = None,
               class_id: int = None, student_id: int = None) -> dict:
    """Aggregated mark sums for one school with optional narrowing.

    Returns {"per_ts": {(subject_id, term_no): [sum, n]},
             "per_t": {term_no: [sum, n]},
             "per_s": {subject_id: [sum, n]},
             "total": [sum, n]}
    """
    q = (db.query(Mark.subject_id, Exam.term,
                  func.sum(_pct_expr()).label("s"), func.count(Mark.id).label("n"))
           .select_from(Mark)
           .join(Exam, Mark.exam_id == Exam.id)
           .join(Student, Mark.student_id == Student.id)
           .join(Class, Student.class_id == Class.id)
           .filter(Class.school_id == school.id, Exam.max_score > 0))
    if grade is not None:
        q = q.filter(Class.grade == grade)
    if class_id is not None:
        q = q.filter(Student.class_id == class_id)
    if student_id is not None:
        q = q.filter(Mark.student_id == student_id)
    out = {"per_ts": defaultdict(lambda: [0.0, 0]),
           "per_t": defaultdict(lambda: [0.0, 0]),
           "per_s": defaultdict(lambda: [0.0, 0]),
           "total": [0.0, 0]}
    for subj_id, term_label, s, n in q.group_by(Mark.subject_id, Exam.term).all():
        t = _term_key(term_label)
        if t is None or not n:
            continue
        val = s or 0.0
        out["per_ts"][(subj_id, t)][0] += val
        out["per_ts"][(subj_id, t)][1] += n
        out["per_t"][t][0] += val
        out["per_t"][t][1] += n
        out["per_s"][subj_id][0] += val
        out["per_s"][subj_id][1] += n
        out["total"][0] += val
        out["total"][1] += n
    return out


def _band_counts(db: Session, school: School, class_id: int = None) -> dict:
    """Score-band histogram over mark percentages: fixed 5 bands + total."""
    pct = _pct_expr()
    band = case(
        (pct < 60, "<60"),
        (pct < 70, "60-69"),
        (pct < 80, "70-79"),
        (pct < 90, "80-89"),
        else_="90-100",
    )
    q = (db.query(band.label("band"), func.count(Mark.id).label("n"))
           .select_from(Mark)
           .join(Exam, Mark.exam_id == Exam.id)
           .join(Student, Mark.student_id == Student.id)
           .join(Class, Student.class_id == Class.id)
           .filter(Class.school_id == school.id, Exam.max_score > 0))
    if class_id is not None:
        q = q.filter(Student.class_id == class_id)
    counts = {b: 0 for b in ("<60", "60-69", "70-79", "80-89", "90-100")}
    for b, n in q.group_by(band).all():
        if b in counts:
            counts[b] = n
    return {"bands": [{"band": b, "count": counts[b]} for b in counts],
            "total": sum(counts.values())}


def _class_rollups(db: Session, school: School) -> dict[int, dict]:
    """class_id -> {"students","avg","attendance_pct","tasks_pct"} for a school."""
    classes = db.query(Class).filter(Class.school_id == school.id).all()
    ids = [c.id for c in classes]
    out = {c.id: {"students": 0, "avg": 0.0, "attendance_pct": 0.0, "tasks_pct": 0.0}
           for c in classes}
    if not ids:
        return out

    for cid, n in (db.query(Student.class_id, func.count(Student.id))
                   .filter(Student.class_id.in_(ids))
                   .group_by(Student.class_id).all()):
        if cid in out:
            out[cid]["students"] = n

    for cid, s, n in (db.query(Student.class_id, func.sum(_pct_expr()), func.count(Mark.id))
                      .select_from(Mark)
                      .join(Exam, Mark.exam_id == Exam.id)
                      .join(Student, Mark.student_id == Student.id)
                      .filter(Student.class_id.in_(ids), Exam.max_score > 0)
                      .group_by(Student.class_id).all()):
        if cid in out:
            out[cid]["avg"] = round((s or 0.0) / n, 1) if n else 0.0

    for cid, n, p in (db.query(Student.class_id, func.count(Attendance.id),
                              func.sum(case((Attendance.status == "P", 1), else_=0)))
                      .select_from(Attendance)
                      .join(Student, Attendance.student_id == Student.id)
                      .filter(Student.class_id.in_(ids))
                      .group_by(Student.class_id).all()):
        if cid in out:
            out[cid]["attendance_pct"] = round((p or 0) / n * 100, 1) if n else 0.0

    for cid, n, c in (db.query(Task.class_id, func.count(TaskCompletion.id),
                               func.sum(case((TaskCompletion.status == "completed", 1), else_=0)))
                      .select_from(TaskCompletion)
                      .join(Task, TaskCompletion.task_id == Task.id)
                      .filter(Task.class_id.in_(ids))
                      .group_by(Task.class_id).all()):
        if cid in out:
            out[cid]["tasks_pct"] = round((c or 0) / n * 100, 1) if n else 0.0
    return out


def _ct_map(db: Session, school: School) -> dict[int, dict]:
    """class_id -> {"ct_name","ct_subject"} from Class.class_teacher_id +
    the is_class_teacher TeacherAssignment row (subject the CT teaches)."""
    classes = db.query(Class).filter(Class.school_id == school.id).all()
    out = {c.id: {"ct_name": None, "ct_subject": None} for c in classes}
    ct_ids = {c.class_teacher_id for c in classes if c.class_teacher_id}
    names = {}
    if ct_ids:
        for u in db.query(User).filter(User.id.in_(ct_ids)).all():
            names[u.id] = u.full_name or u.email
    for c in classes:
        out[c.id]["ct_name"] = names.get(c.class_teacher_id)
    rows = (db.query(TeacherAssignment.class_id, Subject.name)
              .join(Subject, TeacherAssignment.subject_id == Subject.id)
              .filter(TeacherAssignment.is_class_teacher.is_(True),
                      TeacherAssignment.class_id.in_([c.id for c in classes]))
              .all())
    for cid, sname in rows:
        if cid in out:
            out[cid]["ct_subject"] = sname
    return out


def _student_avg_map(db: Session, school: School) -> dict[int, float]:
    """student_id -> overall average mark pct for every student of the school
    (unrounded, for ranking). Students with no marks are absent."""
    classes = db.query(Class).filter(Class.school_id == school.id).all()
    ids = [c.id for c in classes]
    if not ids:
        return {}
    rows = (db.query(Mark.student_id, func.sum(_pct_expr()), func.count(Mark.id))
              .select_from(Mark)
              .join(Exam, Mark.exam_id == Exam.id)
              .join(Student, Mark.student_id == Student.id)
              .filter(Student.class_id.in_(ids), Exam.max_score > 0)
              .group_by(Mark.student_id)
              .all())
    return {sid: (s or 0.0) / n for sid, s, n in rows if n}


def _rolling_attendance(att_rows, window_days: int = 7):
    """[(date, status)] -> [{date, pct}] using a trailing `window_days`-day
    rolling average (present / marked within the window ending on each day).
    O(n): a sliding deque drops entries that fall out of the window."""
    out: list[dict] = []
    window: list[tuple[date, str]] = []  # chronological, front = oldest
    for d, st in att_rows:
        dd = d if hasattr(d, "toordinal") else date.fromisoformat(str(d))
        window.append((dd, st))
        cutoff = dd - timedelta(days=window_days - 1)
        while window and window[0][0] < cutoff:
            window.pop(0)
        marked = len(window)
        present = sum(1 for _, s in window if s == "P")
        out.append({
            "date": dd.isoformat(),
            "pct": round(present / marked * 100, 1) if marked else None,
        })
    return out


def _ranks_from_averages(avg_map: dict[int, float]) -> dict[int, int]:
    """student_id -> 1-based competition rank by average desc (ties share rank)."""
    ordered = sorted(avg_map.items(), key=lambda kv: kv[1], reverse=True)
    ranks: dict[int, int] = {}
    last_val, last_rank = None, 0
    for i, (sid, val) in enumerate(ordered, start=1):
        if last_val is not None and abs(val - last_val) < 1e-9:
            ranks[sid] = last_rank
        else:
            ranks[sid] = i
            last_rank, last_val = i, val
    return ranks


@router.get("/stats")
def principal_stats(db: Session = Depends(get_db), user=Depends(_allowed)):
    """Headline school stats for the dashboard KPI strip."""
    school = _school_of(user, db)
    class_ids = [c.id for c in db.query(Class).filter(Class.school_id == school.id).all()]

    students_n = (db.query(func.count(Student.id))
                  .filter(Student.class_id.in_(class_ids)).scalar() or 0) if class_ids else 0
    teachers_n = (db.query(func.count(User.id))
                  .filter(User.role == "class_teacher", User.school_id == school.id)
                  .scalar() or 0)
    subjects_n = (db.query(func.count(func.distinct(GradeSubject.subject_id)))
                  .filter(GradeSubject.school_id == school.id).scalar() or 0)

    attendance_pct = 0.0
    if class_ids:
        n, p = (db.query(func.count(Attendance.id),
                         func.sum(case((Attendance.status == "P", 1), else_=0)))
                .select_from(Attendance)
                .join(Student, Attendance.student_id == Student.id)
                .filter(Student.class_id.in_(class_ids)).one())
        attendance_pct = round((p or 0) / n * 100, 1) if n else 0.0

    avg_score = 0.0
    if class_ids:
        avg_val = (db.query(func.avg(_pct_expr()))
                   .select_from(Mark)
                   .join(Exam, Mark.exam_id == Exam.id)
                   .join(Student, Mark.student_id == Student.id)
                   .filter(Student.class_id.in_(class_ids), Exam.max_score > 0)
                   .scalar())
        avg_score = round(float(avg_val), 1) if avg_val is not None else 0.0

    tasks_total = tasks_completed = 0
    if class_ids:
        tasks_total, tasks_completed = (db.query(func.count(TaskCompletion.id),
                                                 func.sum(case((TaskCompletion.status == "completed", 1), else_=0)))
                                        .select_from(TaskCompletion)
                                        .join(Task, TaskCompletion.task_id == Task.id)
                                        .filter(Task.class_id.in_(class_ids)).one())
        tasks_total = tasks_total or 0
        tasks_completed = tasks_completed or 0
    task_completion_pct = round(tasks_completed / tasks_total * 100, 1) if tasks_total else 0.0

    at_risk = 0
    if class_ids:
        pct = _pct_expr()
        avg_sub = (db.query(Mark.student_id.label("sid"), func.avg(pct).label("a"))
                   .select_from(Mark)
                   .join(Exam, Mark.exam_id == Exam.id)
                   .filter(Exam.max_score > 0)
                   .group_by(Mark.student_id).subquery())
        att_sub = (db.query(Attendance.student_id.label("sid"),
                            func.sum(case((Attendance.status == "P", 1), else_=0)).label("p"),
                            func.count(Attendance.id).label("n"))
                   .group_by(Attendance.student_id).subquery())
        rows = (db.query(Student.id, avg_sub.c.a, att_sub.c.p, att_sub.c.n)
                .select_from(Student)
                .outerjoin(avg_sub, Student.id == avg_sub.c.sid)
                .outerjoin(att_sub, Student.id == att_sub.c.sid)
                .filter(Student.class_id.in_(class_ids)).all())
        at_risk = sum(1 for _sid, a, p, n in rows
                      if (a is not None and a < 50)
                      or (n and (p or 0) / n * 100 < 60))

    return {
        "students": int(students_n),
        "teachers": int(teachers_n),
        "classes": len(class_ids),
        "subjects": int(subjects_n),
        "attendance_pct": attendance_pct,
        "avg_score": avg_score,
        "tasks_total": int(tasks_total),
        "tasks_completed": int(tasks_completed),
        "task_completion_pct": task_completion_pct,
        "at_risk": at_risk,
    }


@router.get("/term-averages")
def term_averages(db: Session = Depends(get_db), user=Depends(_allowed)):
    """Overall + per-subject term averages (Term 1/2/3) with HOD, rank, trend."""
    school = _school_of(user, db)
    agg = _term_sums(db, school)
    hod = _hod_map(db, school.id)
    subjects = _configured_subjects(db, school.id)

    overall = {}
    for t in (1, 2, 3):
        s, n = agg["per_t"].get(t, [0.0, 0])
        overall[f"t{t}"] = round(s / n, 1) if n else 0.0
    ts, tn = agg["total"]
    overall["all"] = round(ts / tn, 1) if tn else 0.0

    rows = []
    for sub in subjects:
        s, n = agg["per_s"].get(sub.id, [0.0, 0])
        avg = round(s / n, 1) if n else 0.0
        terms = {}
        for t in (1, 2, 3):
            ts_, tn_ = agg["per_ts"].get((sub.id, t), [0.0, 0])
            terms[f"t{t}"] = round(ts_ / tn_, 1) if tn_ else 0.0
        rows.append({
            "id": sub.id,
            "name": sub.name,
            "hod": hod.get(sub.id),
            "t1": terms["t1"], "t2": terms["t2"], "t3": terms["t3"],
            "avg": avg,
            "trend": round(terms["t3"] - terms["t1"], 1),
        })
    rows.sort(key=lambda r: (-r["avg"], r["name"]))
    for i, r in enumerate(rows, start=1):
        r["rank"] = i
    return {"overall": overall, "subjects": rows}


@router.get("/score-distribution")
def score_distribution(db: Session = Depends(get_db), user=Depends(_allowed)):
    """Histogram of all mark percentages of the school in 5 fixed bands."""
    school = _school_of(user, db)
    return _band_counts(db, school)


@router.get("/attendance-series")
def attendance_series_range(range: str = "30D",
                            db: Session = Depends(get_db), user=Depends(_allowed)):
    """Daily school-wide present-percentage series.

    range=30D|3M|6M|1Y (default 30D). One point per school day that has
    records, chronological; pct = present / total * 100.
    """
    school = _school_of(user, db)
    windows = {"30D": 30, "3M": 92, "6M": 183, "1Y": 366}
    if range not in windows:
        raise HTTPException(status_code=400,
                            detail="range must be one of: 30D, 3M, 6M, 1Y")
    start = date.today() - timedelta(days=windows[range] - 1)
    rows = (db.query(Attendance.date.label("d"),
                     func.count(Attendance.id).label("n"),
                     func.sum(case((Attendance.status == "P", 1), else_=0)).label("p"))
              .select_from(Attendance)
              .join(Student, Attendance.student_id == Student.id)
              .join(Class, Student.class_id == Class.id)
              .filter(Class.school_id == school.id, Attendance.date >= start)
              .group_by(Attendance.date)
              .order_by(Attendance.date)
              .all())
    return {"points": [{"date": r[0].isoformat() if hasattr(r[0], "isoformat") else str(r[0]),
                        "pct": round((r[2] or 0) / r[1] * 100, 1)}
                       for r in rows if r[1]]}


@router.get("/class-comparison")
def class_comparison(metric: str = "avg", subject: Optional[str] = None,
                     db: Session = Depends(get_db), user=Depends(_allowed)):
    """Per-class comparison rows, sorted by the requested metric (desc).

    metric=avg|attendance|tasks — every row always carries all three values.
    v15 designer update: pass ``subject`` (subject name or id) to compare
    classes on that SUBJECT's average instead of the overall mark average.
    """
    school = _school_of(user, db)
    if metric not in ("avg", "attendance", "tasks"):
        raise HTTPException(status_code=400,
                            detail="metric must be one of: avg, attendance, tasks")
    rollups = _class_rollups(db, school)
    ct = _ct_map(db, school)
    classes = (db.query(Class).filter(Class.school_id == school.id)
               .order_by(Class.grade, Class.section).all())
    key = {"avg": "avg", "attendance": "attendance_pct", "tasks": "tasks_pct"}[metric]

    # v15: per-subject comparison — rows override avg with the subject avg
    subject_row = None
    subj_stats = None
    if subject is not None and metric == "avg":
        subj = None
        if subject.isdigit():
            subj = db.query(Subject).filter(Subject.id == int(subject)).first()
        else:
            subj = (db.query(Subject)
                      .filter(func.lower(Subject.name) == subject.strip().lower())
                      .first())
        if not subj:
            raise HTTPException(status_code=404, detail="Subject not found.")
        subject_row = {"id": subj.id, "name": subj.name}
        subj_stats, _ = _class_subject_stats(db, school)

    rows = []
    for c in classes:
        avg = rollups[c.id]["avg"]
        if subj_stats is not None:
            s_, n_ = subj_stats.get((c.id, subject_row["id"]), [0.0, 0])
            avg = round(s_ / n_, 1) if n_ else 0.0
        rows.append({
            "id": c.id,
            "name": f"{c.grade}-{c.section}",
            "grade": c.grade,
            "section": c.section,
            "avg": avg,
            "attendance_pct": rollups[c.id]["attendance_pct"],
            "tasks_pct": rollups[c.id]["tasks_pct"],
        })
    rows.sort(key=lambda r: (-r[key], r["name"]))
    resp = {"classes": rows}
    if subject_row is not None:
        resp["subject"] = subject_row
    return resp


@router.get("/classes")
def principal_classes(grade: str = "all",
                      db: Session = Depends(get_db), user=Depends(_allowed)):
    """Class directory with CT pills and school-wide rank (avg desc).

    grade=all|1..10 — when filtered, rows narrow but rank stays school-wide.
    """
    school = _school_of(user, db)
    grade_filter = None
    if grade != "all":
        try:
            grade_filter = int(grade)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="grade must be 'all' or 1..10")
        if not 1 <= grade_filter <= 10:
            raise HTTPException(status_code=400, detail="grade must be 'all' or 1..10")

    classes = (db.query(Class).filter(Class.school_id == school.id)
               .order_by(Class.grade, Class.section).all())
    rollups = _class_rollups(db, school)
    ct = _ct_map(db, school)

    all_ids = [c.id for c in classes]
    ranked = sorted(all_ids, key=lambda cid: (-rollups[cid]["avg"], cid))
    rank_of = {cid: i for i, cid in enumerate(ranked, start=1)}

    # v15 class cards show per-term averages — one grouped query for all classes
    pct = _pct_expr()
    term_map: dict = defaultdict(lambda: defaultdict(lambda: [0.0, 0]))
    for cid_, t_label, s_, n_ in (db.query(Student.class_id, Exam.term, func.sum(pct), func.count(Mark.id))
                                  .select_from(Mark)
                                  .join(Exam, Mark.exam_id == Exam.id)
                                  .join(Student, Mark.student_id == Student.id)
                                  .filter(Student.class_id.in_(all_ids or [0]), Exam.max_score > 0)
                                  .group_by(Student.class_id, Exam.term).all()):
        t = _term_key(t_label)
        if t is not None and n_:
            term_map[cid_][t][0] += s_ or 0.0
            term_map[cid_][t][1] += n_

    rows = []
    for c in classes:
        if grade_filter is not None and c.grade != grade_filter:
            continue
        t_avgs = {}
        for t in (1, 2, 3):
            s_, n_ = term_map.get(c.id, {}).get(t, [0.0, 0])
            t_avgs[f"t{t}"] = round(s_ / n_, 1) if n_ else 0.0
        rows.append({
            "id": c.id,
            "grade": c.grade,
            "section": c.section,
            "name": f"{c.grade}-{c.section}",
            "ct_name": ct[c.id]["ct_name"],
            "ct_subject": ct[c.id]["ct_subject"],
            "students": rollups[c.id]["students"],
            "avg": rollups[c.id]["avg"],
            "attendance_pct": rollups[c.id]["attendance_pct"],
            "tasks_pct": rollups[c.id]["tasks_pct"],
            "rank": rank_of[c.id],
            **t_avgs,
        })
    return {"classes": rows}


@router.get("/class-detail/{class_id}")
def class_detail(class_id: int, db: Session = Depends(get_db), user=Depends(_allowed)):
    """Full drill-down for one class: overview, subject term averages,
    score distribution, attendance/tasks and the ranked student list."""
    school = _school_of(user, db)
    cls = db.query(Class).filter(Class.id == class_id,
                                 Class.school_id == school.id).first()
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found in your school.")

    rollups = _class_rollups(db, school)
    ct = _ct_map(db, school)
    classes = (db.query(Class).filter(Class.school_id == school.id).all())
    ranked = sorted([c.id for c in classes], key=lambda cid: (-rollups[cid]["avg"], cid))
    rank_of = {cid: i for i, cid in enumerate(ranked, start=1)}

    agg = _term_sums(db, school, class_id=cls.id)
    hod = _hod_map(db, school.id)
    subjects = []
    for sub in _configured_subjects(db, school.id):
        ts, tn = agg["per_s"].get(sub.id, [0.0, 0])
        row = {"name": sub.name, "hod": hod.get(sub.id)}
        for t in (1, 2, 3):
            s_, n_ = agg["per_ts"].get((sub.id, t), [0.0, 0])
            row[f"t{t}"] = round(s_ / n_, 1) if n_ else 0.0
        row["avg"] = round(ts / tn, 1) if tn else 0.0
        subjects.append(row)

    students = (db.query(Student).filter(Student.class_id == cls.id).all())
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
    subject_name_by_id = {sub_.id: sub_.name for sub_ in _configured_subjects(db, school.id)}
    student_rows = []
    for s in students:
        scores = {}
        for (stu_id, subj_id), v in ss_map.items():
            if stu_id == s.id and subj_id in subject_name_by_id:
                scores[subject_name_by_id[subj_id]] = v
        student_rows.append({
            "id": s.id,
            "name": s.name,
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


@router.get("/tasks-summary")
def tasks_summary(db: Session = Depends(get_db), user=Depends(_allowed)):
    """School-wide task completion totals."""
    school = _school_of(user, db)
    class_ids = [c.id for c in db.query(Class).filter(Class.school_id == school.id).all()]
    total = completed = 0
    if class_ids:
        total, completed = (db.query(func.count(TaskCompletion.id),
                                     func.sum(case((TaskCompletion.status == "completed", 1), else_=0)))
                            .select_from(TaskCompletion)
                            .join(Task, TaskCompletion.task_id == Task.id)
                            .filter(Task.class_id.in_(class_ids)).one())
        total, completed = total or 0, completed or 0
    return {"total": int(total), "completed": int(completed),
            "pct": round(completed / total * 100, 1) if total else 0.0}


@router.get("/school-rank")
def school_rank(db: Session = Depends(get_db), user=Depends(_allowed)):
    """This school's REAL rank across all schools by overall mark average."""
    school = _school_of(user, db)
    rank, total_schools = _school_rank_info(db, school)
    avg_val = (db.query(func.avg(_pct_expr()))
               .select_from(Mark)
               .join(Exam, Mark.exam_id == Exam.id)
               .join(Student, Mark.student_id == Student.id)
               .join(Class, Student.class_id == Class.id)
               .filter(Class.school_id == school.id, Exam.max_score > 0)
               .scalar())
    return {
        "rank": int(rank) if rank is not None else 0,
        "of": int(total_schools),
        "avg": round(float(avg_val), 1) if avg_val is not None else 0.0,
    }


@router.get("/student-report/{student_id}")
def student_report(student_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Report card for one student: band, term averages, attendance series,
    per-subject marks + task completion and class/grade/school ranks.

    Leadership roles keep the school-wide lookup; everyone else goes through
    the object-level guard so a class teacher can open report cards for their
    own class (the v15 CT console) and a parent for their own child — never
    anyone else's."""
    if user.role in ("principal", "super_admin", "school_admin"):
        school = _school_of(user, db)
        stu = (db.query(Student)
                 .join(Class, Student.class_id == Class.id)
                 .filter(Student.id == student_id, Class.school_id == school.id)
                 .first())
        if not stu:
            raise HTTPException(status_code=404, detail="Student not found in your school.")
    else:
        stu = db.query(Student).filter(Student.id == student_id).first()
        if not stu:
            raise HTTPException(status_code=404, detail="Student not found.")
        assert_student_access(user, stu, db)
    cls = db.query(Class).filter(Class.id == stu.class_id).first()
    school = db.query(School).filter(School.id == cls.school_id).first()

    agg = _term_sums(db, school, student_id=stu.id)
    ts, tn = agg["total"]
    overall = round(ts / tn, 1) if tn else 0.0
    terms = {}
    for t in (1, 2, 3):
        s_, n_ = agg["per_t"].get(t, [0.0, 0])
        terms[f"t{t}"] = round(s_ / n_, 1) if n_ else 0.0

    band = ("EXCELLENT" if overall >= 80
            else "GOOD" if overall >= 60
            else "NEEDS ATTENTION")

    # attendance: overall pct + last 30 school days as a daily series
    att_rows = (db.query(Attendance.date, Attendance.status)
                  .filter(Attendance.student_id == stu.id)
                  .order_by(Attendance.date.desc())
                  .limit(30)
                  .all())
    att_rows.reverse()
    total_att, present_att = (db.query(func.count(Attendance.id),
                                       func.sum(case((Attendance.status == "P", 1), else_=0)))
                              .filter(Attendance.student_id == stu.id).one())
    attendance_pct = round((present_att or 0) / total_att * 100, 1) if total_att else 0.0

    subjects = []
    for sub in _configured_subjects(db, school.id):
        s_, n_ = agg["per_s"].get(sub.id, [0.0, 0])
        marks = {}
        for t in (1, 2, 3):
            ss, nn = agg["per_ts"].get((sub.id, t), [0.0, 0])
            marks[f"t{t}"] = round(ss / nn, 1) if nn else 0.0
        rows, done = (db.query(func.count(TaskCompletion.id),
                              func.sum(case((TaskCompletion.status == "completed", 1), else_=0)))
                     .select_from(TaskCompletion)
                     .join(Task, TaskCompletion.task_id == Task.id)
                     .filter(Task.subject_id == sub.id,
                             TaskCompletion.student_id == stu.id).one())
        subjects.append({
            "name": sub.name,
            "marks": marks,
            "avg": round(s_ / n_, 1) if n_ else 0.0,
            "tasks_pct": round((done or 0) / rows * 100, 1) if (rows or 0) else 0.0,
        })

    avg_map = _student_avg_map(db, school)
    school_ranks = _ranks_from_averages(avg_map)

    # grade + class rank subsets (one query for all school students)
    school_students = (db.query(Student.id, Student.class_id)
                       .join(Class, Student.class_id == Class.id)
                       .filter(Class.school_id == school.id).all())
    grade_students: dict[int, set[int]] = defaultdict(set)
    class_students: dict[int, set[int]] = defaultdict(set)
    class_grade = {c.id: c.grade for c in db.query(Class)
                   .filter(Class.school_id == school.id).all()}
    for sid_, cid_ in school_students:
        class_students[cid_].add(sid_)
        grade_students[class_grade.get(cid_)].add(sid_)

    in_class_rank = _ranks_from_averages(
        {sid: v for sid, v in avg_map.items() if sid in class_students.get(stu.class_id, set())}
    ).get(stu.id)
    in_grade_rank = _ranks_from_averages(
        {sid: v for sid, v in avg_map.items() if sid in grade_students.get(cls.grade if cls else None, set())}
    ).get(stu.id)

    return {
        "student": {
            "id": stu.id,
            "name": stu.name,
            "class_id": stu.class_id,
            "class_name": f"{cls.grade}-{cls.section}" if cls else "",
        },
        "overall": overall,
        "band": band,
        "terms": terms,
        "attendance_pct": attendance_pct,
        # 7-day trailing rolling average (present / marked within the window
        # ending on each day) — smooths the binary P/A marks into a readable
        # trend line instead of 0/100 spikes.
        "attendance_series": _rolling_attendance(att_rows),
        # raw daily record kept for the chart's dashed overlay
        "attendance_raw": [{"date": (d.isoformat() if hasattr(d, "isoformat") else str(d)),
                            "pct": 100.0 if st == "P" else 0.0}
                           for d, st in att_rows],
        "subjects": subjects,
        "ranks": {
            "in_class": in_class_rank,
            "in_grade": in_grade_rank,
            "in_school": school_ranks.get(stu.id),
        },
    }


@router.get("/radar")
def radar(scope: str = "school", grade: int = None, class_id: int = None,
          student_id: int = None,
          db: Session = Depends(get_db), user=Depends(_allowed)):
    """Per-subject average per term for school / grade / class / student scope.

    Returns {"subjects":[names],"terms":{"t1":[...],"t2":[...],"t3":[...]}}
    with arrays aligned to `subjects`. Scope rows are always validated to
    belong to the caller's school.
    """
    school = _school_of(user, db)
    if scope not in ("school", "grade", "class", "student"):
        raise HTTPException(status_code=400,
                            detail="scope must be one of: school, grade, class, student")

    kw = {}
    if scope == "grade":
        if grade is None:
            raise HTTPException(status_code=400, detail="grade is required for scope=grade")
        if not db.query(Class).filter(Class.school_id == school.id,
                                      Class.grade == grade).first():
            raise HTTPException(status_code=404, detail="Grade not found in your school.")
        kw["grade"] = grade
    elif scope == "class":
        if class_id is None:
            raise HTTPException(status_code=400, detail="class_id is required for scope=class")
        if not db.query(Class).filter(Class.id == class_id,
                                      Class.school_id == school.id).first():
            raise HTTPException(status_code=404, detail="Class not found in your school.")
        kw["class_id"] = class_id
    elif scope == "student":
        if student_id is None:
            raise HTTPException(status_code=400, detail="student_id is required for scope=student")
        if not (db.query(Student)
                  .join(Class, Student.class_id == Class.id)
                  .filter(Student.id == student_id, Class.school_id == school.id).first()):
            raise HTTPException(status_code=404, detail="Student not found in your school.")
        kw["student_id"] = student_id

    agg = _term_sums(db, school, **kw)
    subjects = _configured_subjects(db, school.id)
    names = [s.name for s in subjects]
    terms = {}
    for t in (1, 2, 3):
        arr = []
        for sub in subjects:
            s_, n_ = agg["per_ts"].get((sub.id, t), [0.0, 0])
            arr.append(round(s_ / n_, 1) if n_ else 0.0)
        terms[f"t{t}"] = arr
    return {"subjects": names, "terms": terms}


# ═════════════════════════ Teachers Level (v5 designer update) ══════════════
# The designer's v5 dashboard adds a fifth section: faculty ranked by the
# average performance of the classes they teach, with a per-teacher report.
# Everything below is deliberately LEAN (grouped SQL only) so the dashboard's
# initial parallel load stays fast — no _gather_school_data scans here.


def _teacher_load_rows(db: Session, school: School) -> list:
    """Teaching-load assignments (class_id set) joined to user + subject:
    (teacher_user_id, subject_id, class_id, full_name, email, subject_name)."""
    return (db.query(TeacherAssignment.teacher_user_id, TeacherAssignment.subject_id,
                     TeacherAssignment.class_id, User.full_name, User.email, Subject.name)
              .join(User, TeacherAssignment.teacher_user_id == User.id)
              .join(Subject, TeacherAssignment.subject_id == Subject.id)
              .filter(TeacherAssignment.school_id == school.id,
                      TeacherAssignment.class_id.isnot(None))
              .all())


def _class_subject_stats(db: Session, school: School) -> tuple[dict, dict]:
    """Two grouped queries: per (class, subject) [sum_pct, n] and per
    (class, subject, term_no) [sum_pct, n]."""
    subj = defaultdict(lambda: [0.0, 0])
    for cid, sid_, s, n in (db.query(Student.class_id, Mark.subject_id,
                                     func.sum(_pct_expr()), func.count(Mark.id))
                            .select_from(Mark)
                            .join(Exam, Mark.exam_id == Exam.id)
                            .join(Student, Mark.student_id == Student.id)
                            .join(Class, Student.class_id == Class.id)
                            .filter(Class.school_id == school.id, Exam.max_score > 0)
                            .group_by(Student.class_id, Mark.subject_id).all()):
        if n:
            subj[(cid, sid_)][0] += s or 0.0
            subj[(cid, sid_)][1] += n
    terms = defaultdict(lambda: [0.0, 0])
    for cid, sid_, t_label, s, n in (db.query(Student.class_id, Mark.subject_id, Exam.term,
                                              func.sum(_pct_expr()), func.count(Mark.id))
                                     .select_from(Mark)
                                     .join(Exam, Mark.exam_id == Exam.id)
                                     .join(Student, Mark.student_id == Student.id)
                                     .join(Class, Student.class_id == Class.id)
                                     .filter(Class.school_id == school.id, Exam.max_score > 0)
                                     .group_by(Student.class_id, Mark.subject_id, Exam.term).all()):
        t = _term_key(t_label)
        if t is not None and n:
            terms[(cid, sid_, t)][0] += s or 0.0
            terms[(cid, sid_, t)][1] += n
    return subj, terms


def _teacher_aggregates(db: Session, school: School) -> dict:
    """Faculty analytics bundle shared by /teachers and /teacher-report/{id}.

    A "teacher" here is any user holding teaching-load assignments. Primary
    subject = the subject they teach in the most classes; only classes where
    they teach THAT subject count toward their metrics (parity with the
    designer's per-subject faculty model). avg = mean subject average across
    those classes; teachers without any marks data rank last with avg None.
    """
    tas = _teacher_load_rows(db, school)
    if not tas:
        return {"teachers": [], "index": {}}

    subj_stats, term_stats = _class_subject_stats(db, school)
    rollups = _class_rollups(db, school)
    ct = _ct_map(db, school)
    hod_pairs = {(tid, sid_) for tid, sid_ in
                 (db.query(TeacherAssignment.teacher_user_id, TeacherAssignment.subject_id)
                    .filter(TeacherAssignment.school_id == school.id,
                            TeacherAssignment.is_hod.is_(True)).all())}

    class_rows = (db.query(Class).filter(Class.school_id == school.id)
                    .order_by(Class.grade, Class.section).all())
    cid_name = {c.id: f"{c.grade}-{c.section}" for c in class_rows}
    ranked_cids = sorted([c.id for c in class_rows], key=lambda cid: (-rollups[cid]["avg"], cid))
    class_rank = {cid: i for i, cid in enumerate(ranked_cids, start=1)}
    ct_of_map = {c.class_teacher_id: cid_name[c.id] for c in class_rows if c.class_teacher_id}

    per_t: dict[int, dict[int, set]] = defaultdict(lambda: defaultdict(set))
    names: dict[int, tuple] = {}
    subject_names: dict[int, str] = {}
    for tid, sid_, cid, fname, email, sname in tas:
        per_t[tid][sid_].add(cid)
        names[tid] = (fname or email, email)
        subject_names[sid_] = sname

    def avg_of(key, pool):
        s, n = pool.get(key, [0.0, 0])
        return round(s / n, 1) if n else None

    def mean_or_none(arr):
        return round(sum(arr) / len(arr), 1) if arr else None

    teachers = []
    for tid, by_subject in per_t.items():
        sid_, class_ids = max(by_subject.items(), key=lambda kv: (len(kv[1]), -kv[0]))
        per_class = []
        for cid in sorted(class_ids):
            per_class.append({
                "id": cid,
                "name": cid_name.get(cid, str(cid)),
                "students": rollups[cid]["students"],
                "rank": class_rank.get(cid),
                "ct_name": ct[cid]["ct_name"],
                "avg": avg_of((cid, sid_), subj_stats),
                "t1": avg_of((cid, sid_, 1), term_stats),
                "t2": avg_of((cid, sid_, 2), term_stats),
                "t3": avg_of((cid, sid_, 3), term_stats),
                "tasks_pct": rollups[cid]["tasks_pct"],
            })
        fname, email = names[tid]
        t1 = mean_or_none([c["t1"] for c in per_class if c["t1"] is not None])
        t2 = mean_or_none([c["t2"] for c in per_class if c["t2"] is not None])
        t3 = mean_or_none([c["t3"] for c in per_class if c["t3"] is not None])
        teachers.append({
            "id": tid,
            "name": fname,
            "email": email,
            "subject": subject_names[sid_],
            "subject_id": sid_,
            "is_hod": (tid, sid_) in hod_pairs,
            "ct_of": ct_of_map.get(tid),
            "classes": len(per_class),
            "students": sum(c["students"] for c in per_class),
            "avg": mean_or_none([c["avg"] for c in per_class if c["avg"] is not None]),
            "t1": t1, "t2": t2, "t3": t3,
            "trend": round(t3 - t2, 1) if (t3 is not None and t2 is not None) else None,
            "tasks_avg": mean_or_none([c["tasks_pct"] for c in per_class]) or 0.0,
            "_per_class": per_class,
        })

    ranked_t = sorted(teachers, key=lambda t: (-(t["avg"] if t["avg"] is not None else -1.0),
                                               t["name"]))
    rank, prev = 0, object()
    for t in ranked_t:
        if t["avg"] != prev:
            rank += 1
            prev = t["avg"]
        t["rank"] = rank
        t["of"] = len(ranked_t)
    return {"teachers": ranked_t, "index": {t["id"]: t for t in ranked_t}}


@router.get("/teachers")
def principal_teachers(db: Session = Depends(get_db), user=Depends(_allowed)):
    """Ranked academic faculty for the v5 'Teachers Level' section.

    Returns {"teachers":[{id,name,subject,is_hod,ct_of,classes,students,
    avg,t1,t2,t3,trend,tasks_avg,rank,of}]} dense-ranked by avg desc."""
    school = _school_of(user, db)
    bundle = _teacher_aggregates(db, school)
    return {"teachers": [{k: v for k, v in t.items() if not k.startswith("_")}
                         for t in bundle["teachers"]]}


@router.get("/teacher-report/{teacher_user_id}")
def teacher_report(teacher_user_id: int, db: Session = Depends(get_db),
                   user=Depends(_allowed)):
    """Full faculty report: identity + role, per-class subject cards, the
    exam-by-exam subject trend across THEIR classes, and the ranked student
    cohort they teach (dense-ranked by the subject's score)."""
    school = _school_of(user, db)
    bundle = _teacher_aggregates(db, school)
    t = bundle["index"].get(teacher_user_id)
    if not t:
        raise HTTPException(status_code=404, detail="Teacher not found in your school.")
    sid_ = t["subject_id"]
    class_ids = [c["id"] for c in t["_per_class"]] or [0]

    # exam-by-exam subject trend restricted to the teacher's own classes
    exam_stats = {}
    for eid, s, n in (db.query(Mark.exam_id, func.sum(_pct_expr()), func.count(Mark.id))
                      .select_from(Mark)
                      .join(Exam, Mark.exam_id == Exam.id)
                      .join(Student, Mark.student_id == Student.id)
                      .filter(Student.class_id.in_(class_ids), Mark.subject_id == sid_,
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

    # student cohort: everyone in the teacher's classes, dense-ranked by the
    # subject's average; students without marks trail with score None
    scored = []
    for sid2, nm, gr, sec, s, n in (db.query(Student.id, Student.name, Class.grade,
                                             Class.section, func.sum(_pct_expr()),
                                             func.count(Mark.id))
                                    .select_from(Mark)
                                    .join(Exam, Mark.exam_id == Exam.id)
                                    .join(Student, Mark.student_id == Student.id)
                                    .join(Class, Student.class_id == Class.id)
                                    .filter(Student.class_id.in_(class_ids),
                                            Mark.subject_id == sid_, Exam.max_score > 0)
                                    .group_by(Student.id, Student.name, Class.grade,
                                              Class.section).all()):
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

    role = "HOD" if t["is_hod"] else ("CLASS TEACHER" if t["ct_of"] else "FACULTY")
    return {
        "teacher": {k: v for k, v in t.items() if not k.startswith("_")},
        "role": role,
        "classes": t["_per_class"],
        "series": series,
        "students": scored + unscored,
    }


# ═════════════════════════════════════════════════════════════════════════════
# v15 designer update — Subject Detail view + multi-entity Compare
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/subject-detail/{subject_id}")
def subject_detail(subject_id: int, db: Session = Depends(get_db),
                   user=Depends(_allowed)):
    """Full drill-down for one subject (designer v15 `subjectDetailView`):

    • overview: term averages, all-term average, HOD, teacher count,
      student count, top score, best class
    • mark distribution (band counts across every student's subject average)
    • the subject's faculty ranked by their class-subject average
    • every student ranked by the subject's all-term score
    """
    school = _school_of(user, db)
    sub = db.query(Subject).filter(Subject.id == subject_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subject not found.")

    pct = _pct_expr()
    classes = (db.query(Class).filter(Class.school_id == school.id)
               .order_by(Class.grade, Class.section).all())
    cid_by_id = {c.id: c for c in classes}
    class_ids = [c.id for c in classes]

    # ── per-term + overall subject averages (school scope) ──
    term_sums: dict[int, dict] = defaultdict(lambda: [0.0, 0])
    for t_label, s, n in (db.query(Exam.term, func.sum(pct), func.count(Mark.id))
                          .select_from(Mark)
                          .join(Exam, Mark.exam_id == Exam.id)
                          .join(Student, Mark.student_id == Student.id)
                          .join(Class, Student.class_id == Class.id)
                          .filter(Class.school_id == school.id,
                                  Mark.subject_id == subject_id,
                                  Exam.max_score > 0)
                          .group_by(Exam.term).all()):
        t = _term_key(t_label)
        if t is not None and n:
            term_sums[t][0] += s or 0.0
            term_sums[t][1] += n
    total_s = sum(v[0] for v in term_sums.values())
    total_n = sum(v[1] for v in term_sums.values())
    overall = round(total_s / total_n, 1) if total_n else 0.0

    # ── per-class subject averages → best class ──
    per_class: dict[int, list] = defaultdict(lambda: [0.0, 0])
    for cid, s, n in (db.query(Student.class_id, func.sum(pct), func.count(Mark.id))
                      .select_from(Mark)
                      .join(Exam, Mark.exam_id == Exam.id)
                      .join(Student, Mark.student_id == Student.id)
                      .filter(Student.class_id.in_(class_ids or [0]),
                              Mark.subject_id == subject_id,
                              Exam.max_score > 0)
                      .group_by(Student.class_id).all()):
        if n:
            per_class[cid][0] += s or 0.0
            per_class[cid][1] += n
    best_cls = None
    best_avg = -1.0
    for cid, (s_, n_) in per_class.items():
        if n_ and cid in cid_by_id:
            a = s_ / n_
            if a > best_avg:
                best_avg, best_cls = a, cid_by_id[cid]

    # ── faculty of this subject (ranked by class-subject average) ──
    bundle = _teacher_aggregates(db, school)
    dept = [t for t in bundle["teachers"] if t["subject_id"] == subject_id]
    dept_sorted = sorted(dept, key=lambda t: (-(t["avg"] if t["avg"] is not None else -1.0),
                                              t["name"]))
    hod = (db.query(User.full_name)
             .join(TeacherAssignment, TeacherAssignment.teacher_user_id == User.id)
             .filter(TeacherAssignment.school_id == school.id,
                     TeacherAssignment.subject_id == subject_id,
                     TeacherAssignment.is_hod.is_(True))
             .first())
    hod_name = hod[0] if hod else None

    # ── per-student subject scores, dense-ranked ──
    scored: dict[int, float] = {}
    for sid_, s, n in (db.query(Student.id, func.sum(pct), func.count(Mark.id))
                       .select_from(Mark)
                       .join(Exam, Mark.exam_id == Exam.id)
                       .join(Student, Mark.student_id == Student.id)
                       .join(Class, Student.class_id == Class.id)
                       .filter(Class.school_id == school.id,
                               Mark.subject_id == subject_id,
                               Exam.max_score > 0)
                       .group_by(Student.id).all()):
        if n:
            scored[sid_] = round(s / n, 1)

    students = (db.query(Student.id, Student.name, Student.class_id)
                  .filter(Student.class_id.in_(class_ids or [0])).all())
    kid_rows = []
    for sid_, name_, cid_ in students:
        m = scored.get(sid_)
        c = cid_by_id.get(cid_)
        kid_rows.append({
            "id": sid_, "name": name_,
            "class_id": cid_,
            "class_name": f"{c.grade}-{c.section}" if c else "",
            "score": m,
        })
    ranked_kids = sorted([k for k in kid_rows if k["score"] is not None],
                         key=lambda k: (-k["score"], k["name"]))
    rk, prev = 0, object()
    for k in ranked_kids:
        if k["score"] != prev:
            rk += 1
            prev = k["score"]
        k["rank"] = rk
    unscored = [k for k in kid_rows if k["score"] is None]
    unscored.sort(key=lambda k: (k["class_name"], k["name"]))
    for k in unscored:
        k["rank"] = None
    top = max((k["score"] for k in ranked_kids), default=0)

    # band counts over per-student subject averages
    bands = {"<60": 0, "60-69": 0, "70-79": 0, "80-89": 0, "90-100": 0}
    for k in ranked_kids:
        v = k["score"]
        key2 = ("<60" if v < 60 else "60-69" if v < 70 else
                "70-79" if v < 80 else "80-89" if v < 90 else "90-100")
        bands[key2] += 1

    terms_out = {}
    for t in (1, 2, 3):
        s_, n_ = term_sums.get(t, [0.0, 0])
        terms_out[f"t{t}"] = round(s_ / n_, 1) if n_ else 0.0

    return {
        "subject": {"id": sub.id, "name": sub.name},
        "overview": {
            "avg": overall,
            "terms": terms_out,
            "hod": hod_name,
            "teachers": len(dept_sorted),
            "students": len(kid_rows),
            "top_score": top,
            "top_class": f"{best_cls.grade}-{best_cls.section}" if best_cls else None,
            "avg_marks": overall,
        },
        "distribution": {"bands": [{"band": b, "count": n} for b, n in bands.items()],
                         "total": len(ranked_kids)},
        "teachers": [{
            "id": t["id"], "name": t["name"], "is_hod": t["is_hod"],
            "ct_of": t["ct_of"], "classes": t["classes"],
            "avg": t["avg"], "trend": t["trend"], "rank": t["rank"],
        } for t in dept_sorted],
        "students": ranked_kids + unscored,
    }


class CompareEntity(BaseModel):
    type: str  # school | grade | class | student | folder
    id: Optional[str] = None
    # display name override (folders send their localStorage folder name)
    name: Optional[str] = None
    # folder entities carry their member ids from the client (folders live in
    # the browser's localStorage, the server cannot resolve them)
    student_ids: Optional[list[int]] = None


class CompareRequest(BaseModel):
    entities: list[CompareEntity]


@router.post("/compare")
def compare_entities(data: CompareRequest, db: Session = Depends(get_db),
                     user=Depends(_allowed)):
    """Multi-entity compare (designer v15) — up to 7 entities, each becomes a
    bar in every metric group. Returns per entity:
    {key, name, marks, attendance, tasks, overall}."""
    school = _school_of(user, db)
    if not data.entities:
        return {"entities": []}
    if len(data.entities) > 7:
        raise HTTPException(status_code=400, detail="Compare supports up to 7 entities.")

    rollups = _class_rollups(db, school)
    classes = (db.query(Class).filter(Class.school_id == school.id).all())
    cid_by_id = {c.id: c for c in classes}
    grade_map: dict[int, list[int]] = defaultdict(list)
    for c in classes:
        grade_map[c.grade].append(c.id)

    avg_map = _student_avg_map(db, school)
    tasks_by_class: dict[int, tuple[int, int]] = {}
    class_ids = [c.id for c in classes]
    if class_ids:
        rows_ = (db.query(Task.class_id, func.count(TaskCompletion.id),
                          func.sum(case((TaskCompletion.status == "completed", 1), else_=0)))
                 .select_from(TaskCompletion)
                 .join(Task, TaskCompletion.task_id == Task.id)
                 .filter(Task.class_id.in_(class_ids))
                 .group_by(Task.class_id).all())
        for cid_, total_, done_ in rows_:
            tasks_by_class[cid_] = (total_ or 0, done_ or 0)

    # per-student attendance + tasks maps (lazily built only when needed)
    stu_att: dict[int, float] = {}
    stu_tasks: dict[int, float] = {}

    def _ensure_student_maps():
        nonlocal stu_att, stu_tasks
        if stu_att or stu_tasks:
            return
        sids = [sid for (sid,) in db.query(Student.id)
                .filter(Student.class_id.in_(class_ids or [0])).all()]
        if sids:
            for sid_, n, p in (db.query(Attendance.student_id, func.count(Attendance.id),
                                        func.sum(case((Attendance.status == "P", 1), else_=0)))
                               .filter(Attendance.student_id.in_(sids))
                               .group_by(Attendance.student_id).all()):
                stu_att[sid_] = round((p or 0) / n * 100, 1) if n else 0.0
            for sid_, n, done in (db.query(TaskCompletion.student_id,
                                           func.count(TaskCompletion.id),
                                           func.sum(case((TaskCompletion.status == "completed", 1), else_=0)))
                                   .join(Task, TaskCompletion.task_id == Task.id)
                                   .filter(TaskCompletion.student_id.in_(sids))
                                   .group_by(TaskCompletion.student_id).all()):
                stu_tasks[sid_] = round((done or 0) / n * 100, 1) if n else 0.0

    out = []
    for i, ent in enumerate(data.entities):
        etype = (ent.type or "").lower()
        if etype == "school":
            att = round(sum(r["attendance_pct"] for r in rollups.values()) / len(rollups), 1) if rollups else 0.0
            tsk = round(sum(r["tasks_pct"] for r in rollups.values()) / len(rollups), 1) if rollups else 0.0
            mrk = round(sum(r["avg"] for r in rollups.values()) / len(rollups), 1) if rollups else 0.0
            out.append({"key": f"school|{school.id}", "name": school.name,
                        "marks": mrk, "attendance": att, "tasks": tsk})
        elif etype == "grade":
            g = int(ent.id) if ent.id and str(ent.id).isdigit() else None
            cs = grade_map.get(g, []) if g is not None else []
            if not cs:
                out.append({"key": f"grade|{ent.id}", "name": f"Grade {ent.id}",
                            "marks": 0.0, "attendance": 0.0, "tasks": 0.0})
            else:
                att = round(sum(rollups[cid]["attendance_pct"] for cid in cs) / len(cs), 1)
                tsk = round(sum(rollups[cid]["tasks_pct"] for cid in cs) / len(cs), 1)
                mrk = round(sum(rollups[cid]["avg"] for cid in cs) / len(cs), 1)
                out.append({"key": f"grade|{g}", "name": f"Grade {g}",
                            "marks": mrk, "attendance": att, "tasks": tsk})
        elif etype == "class":
            cid_ = int(ent.id) if ent.id and str(ent.id).isdigit() else None
            c = cid_by_id.get(cid_) if cid_ is not None else None
            if not c:
                out.append({"key": f"class|{ent.id}", "name": "Class —",
                            "marks": 0.0, "attendance": 0.0, "tasks": 0.0})
            else:
                total_, done_ = tasks_by_class.get(c.id, (0, 0))
                out.append({
                    "key": f"class|{c.id}", "name": f"Class {c.grade}-{c.section}",
                    "marks": rollups[c.id]["avg"],
                    "attendance": rollups[c.id]["attendance_pct"],
                    "tasks": round(done_ / total_ * 100, 1) if total_ else 0.0,
                })
        elif etype == "student":
            sid_ = int(ent.id) if ent.id and str(ent.id).isdigit() else None
            stu = (db.query(Student)
                     .join(Class, Student.class_id == Class.id)
                     .filter(Student.id == sid_, Class.school_id == school.id)
                     .first()) if sid_ is not None else None
            if not stu:
                out.append({"key": f"student|{ent.id}", "name": "Student —",
                            "marks": 0.0, "attendance": 0.0, "tasks": 0.0})
            else:
                _ensure_student_maps()
                out.append({
                    "key": f"student|{stu.id}", "name": stu.name,
                    "marks": round(avg_map.get(stu.id, 0.0), 1),
                    "attendance": stu_att.get(stu.id, 0.0),
                    "tasks": stu_tasks.get(stu.id, 0.0),
                })
        elif etype == "folder":
            ids = [int(x) for x in (ent.student_ids or []) if str(x).isdigit()]
            valid = (db.query(Student.id, Student.name)
                       .join(Class, Student.class_id == Class.id)
                       .filter(Student.id.in_(ids or [0]), Class.school_id == school.id)
                       .all())
            name = ent.name or ent.id or "Folder"
            if not valid:
                out.append({"key": f"folder|{i}", "name": str(name),
                            "marks": 0.0, "attendance": 0.0, "tasks": 0.0})
            else:
                _ensure_student_maps()
                out.append({
                    "key": f"folder|{i}", "name": str(name),
                    "marks": round(sum(avg_map.get(s, 0.0) for s, _ in valid) / len(valid), 1),
                    "attendance": round(sum(stu_att.get(s, 0.0) for s, _ in valid) / len(valid), 1),
                    "tasks": round(sum(stu_tasks.get(s, 0.0) for s, _ in valid) / len(valid), 1),
                })
        else:
            raise HTTPException(status_code=400,
                                detail="entity.type must be school|grade|class|student|folder")

    for e in out:
        e["overall"] = round((e["marks"] + e["attendance"] + e["tasks"]) / 3, 1)
    return {"entities": out}
