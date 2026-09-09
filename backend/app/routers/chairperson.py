
import json
import statistics
import threading
import os
import time as _time
from collections import defaultdict
from datetime import date, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_role
from app.rate_limit import limiter
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
from app.models.user_school import UserSchool
from app.routers.principal import (  # reuse the heavy one-shot helpers
    _band_counts,
    _class_rollups,
    _configured_subjects,
    _ct_map,
    _gather_school_data,
    _hod_map,
    _pct_expr,
    _student_avg_map,
    _term_key,
    _term_sums,
)
from app.services.ai_service import ask_ai, ask_ai_agentic
from app.services.ai_tools import CHAIRPERSON_TOOLS

router = APIRouter(prefix="/chairperson", tags=["chairperson"])
_allowed = require_role("chairperson", "super_admin")


# ─────────────────────────────────────────────────────────────────────────────
# helpers
# ─────────────────────────────────────────────────────────────────────────────
def _schools_of(user: User, db: Session) -> list[School]:
    """Return the list of schools this chairperson oversees."""
    if user.role == "super_admin":
        return db.query(School).order_by(School.id).all()
    links = db.query(UserSchool).filter(UserSchool.user_id == user.id).all()
    ids = [l.school_id for l in links]
    if not ids:
        return []
    return db.query(School).filter(School.id.in_(ids)).order_by(School.id).all()


def _gather_all_schools_data(db: Session, schools: list[School]) -> dict:
    """Run `_gather_school_data` for every overseen school and bundle the
    results into a dict keyed by school_id. Each school gets a compact
    public snapshot plus the internal stats for cross-school analytics.
    """
    per_school: dict[int, dict] = {}
    for s in schools:
        per_school[s.id] = _gather_school_data(db, s)
    return per_school


# ── tiny in-process TTL cache (stack policy: local memory caching only) ──────
_GATHER_CACHE: dict[tuple, tuple] = {}
_GATHER_TTL = float(os.environ.get("CHAIRPERSON_CACHE_TTL", "600"))  # seconds — the multi-school scan is expensive; demo data is static
# Single-flight support: when several chairperson pages load in parallel on a
# cold cache, each request used to compute its OWN copy of the multi-school
# aggregation simultaneously — 4-5 concurrent pure-Python scans contending on
# the GIL made every request take 45-55 s wall time. An in-flight Event per
# key lets the losers wait for the winner's computation instead.
_GATHER_INFLIGHT: dict[tuple, threading.Event] = {}
_GATHER_LOCK = threading.Lock()


def _gather_all_schools_data_cached(db: Session, schools: list[School]) -> dict:
    """Memoized + single-flight wrapper around `_gather_all_schools_data`.

    The multi-school aggregation scans ~300k rows, so every chairperson page
    load otherwise pays 5-16 s. Keyed by the overseen school-id set, 120 s TTL.
    Parallel cold callers share ONE in-flight computation (threading.Event),
    then read the winner's cached result — measured effect: the worst parallel
    cold burst drops from ~50 s per request to ~one computation total.
    Cache hits return the SHARED snapshot directly (copying it via deepcopy
    costs ~4 s for this structure, defeating the purpose) — every call site is
    audited to be read-only (sorted()/min()/max()/sum() produce new lists), so
    treat the returned dict as strictly read-only.
    """
    key = tuple(sorted(s.id for s in schools))
    now = _time.monotonic()
    hit = _GATHER_CACHE.get(key)
    if hit is not None and now - hit[0] < _GATHER_TTL:
        return hit[1]

    with _GATHER_LOCK:
        # double-check after acquiring the lock (another thread may have won)
        hit = _GATHER_CACHE.get(key)
        if hit is not None and _time.monotonic() - hit[0] < _GATHER_TTL:
            return hit[1]
        ev = _GATHER_INFLIGHT.get(key)
        if ev is None:
            ev = threading.Event()
            _GATHER_INFLIGHT[key] = ev
            winner = True
        else:
            winner = False

    if winner:
        try:
            data = _gather_all_schools_data(db, schools)
            _GATHER_CACHE[key] = (_time.monotonic(), data)
            return data
        finally:
            with _GATHER_LOCK:
                _GATHER_INFLIGHT.pop(key, None)
            ev.set()

    # loser: wait for the winner's computation, then serve the cached snapshot
    ev.wait(timeout=90)
    hit = _GATHER_CACHE.get(key)
    if hit is not None:
        return hit[1]
    # extreme fallback (winner crashed before caching): compute inline
    return _gather_all_schools_data(db, schools)


def _school_public_summary(school: School, data: dict) -> dict:
    """Compact public summary of one school."""
    return {
        "school_id": school.id,
        "name": school.name,
        "students": data["total_students"],
        "classes": data["total_classes"],
        "exams": data["total_exams"],
        "average_pct": data["school_average"],
        "top_performer": data["top_performer"],
        "weakest_subject": min(data["subjects"], key=lambda x: x["average"])
                          if data["subjects"] else None,
        "strongest_subject": max(data["subjects"], key=lambda x: x["average"])
                             if data["subjects"] else None,
        "at_risk_count": sum(1 for st in data["_student_stats"].values()
                             if st["average"] < 50 or st["attendance_rate"] < 60),
    }


def _school_attendance_rate(data: dict) -> float:
    """School-wide attendance rate."""
    pres = 0
    tot = 0
    for st in data["_student_stats"].values():
        # we don't track per-student attendance totals in the snapshot's public
        # view, but the _student_stats dict does have attendance_rate. Use the
        # average of those as a proxy if needed.
        pass
    # Better: recompute from attendance_history length isn't feasible without
    # the original Attendance rows. Instead use the school-wide attendance
    # from the grade rollup, weighted by students.
    if data["grades"]:
        total_students = sum(g["students"] for g in data["grades"])
        if total_students:
            weighted = sum(g["attendance_rate"] * g["students"] for g in data["grades"])
            return round(weighted / total_students, 1)
    return 0.0


# ─────────────────────────────────────────────────────────────────────────────
# endpoints
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/overview")
def overview(db: Session = Depends(get_db), user=Depends(_allowed)):
    """Totals across all overseen schools: total schools, total students,
    total classes, overall average %, best school, most-improved school."""
    schools = _schools_of(user, db)
    if not schools:
        raise HTTPException(status_code=404, detail="No schools overseen by this chairperson.")
    per_school = _gather_all_schools_data_cached(db, schools)

    summaries = [_school_public_summary(s, per_school[s.id]) for s in schools]
    total_students = sum(s["students"] for s in summaries)
    total_classes = sum(s["classes"] for s in summaries)
    total_exams = sum(s["exams"] for s in summaries)

    # overall weighted average
    all_avg_pcts = []
    for s in summaries:
        # weight by student count
        for _ in range(s["students"]):
            all_avg_pcts.append(s["average_pct"])
    overall_avg = round(sum(all_avg_pcts) / len(all_avg_pcts), 1) if all_avg_pcts else 0.0

    best_school = max(summaries, key=lambda x: x["average_pct"]) if summaries else None

    # most-improved school — compare first-exam avg vs last-exam avg per school
    improvement_per_school = []
    for s in schools:
        data = per_school[s.id]
        # average over all exams in chronological order
        exam_avgs_sorted = sorted(
            (e for e in data["exams"]), key=lambda e: e["exam_id"]
        )
        # group by grade to get first/last per grade
        per_grade_first = defaultdict(list)
        per_grade_last = defaultdict(list)
        per_grade_exam_ids = data["_grade_exams"]
        for grade, exam_ids in per_grade_exam_ids.items():
            if not exam_ids:
                continue
            first_eid = exam_ids[0]
            last_eid = exam_ids[-1]
            first_ex = next((e for e in exam_avgs_sorted if e["exam_id"] == first_eid), None)
            last_ex = next((e for e in exam_avgs_sorted if e["exam_id"] == last_eid), None)
            if first_ex and last_ex:
                per_grade_first[grade].append(first_ex["average"])
                per_grade_last[grade].append(last_ex["average"])
        if per_grade_first and per_grade_last:
            avg_first = round(sum(v for lst in per_grade_first.values() for v in lst) /
                              sum(len(lst) for lst in per_grade_first.values()), 1)
            avg_last = round(sum(v for lst in per_grade_last.values() for v in lst) /
                             sum(len(lst) for lst in per_grade_last.values()), 1)
            improvement_per_school.append({
                "school_id": s.id, "name": s.name,
                "first_exam_avg": avg_first, "last_exam_avg": avg_last,
                "delta": round(avg_last - avg_first, 1),
            })
    most_improved = (max(improvement_per_school, key=lambda x: x["delta"])
                     if improvement_per_school else None)

    return {
        "total_schools": len(schools),
        "total_students": total_students,
        "total_classes": total_classes,
        "total_exams": total_exams,
        "overall_average_pct": overall_avg,
        "best_school": best_school,
        "most_improved_school": most_improved,
        "schools": summaries,
    }


@router.get("/schools")
def schools(db: Session = Depends(get_db), user=Depends(_allowed)):
    """Enhanced per-school stats."""
    schools = _schools_of(user, db)
    if not schools:
        raise HTTPException(status_code=404, detail="No schools overseen by this chairperson.")
    per_school = _gather_all_schools_data_cached(db, schools)
    out = []
    for s in schools:
        summary = _school_public_summary(s, per_school[s.id])
        summary["attendance_rate"] = _school_attendance_rate(per_school[s.id])
        out.append(summary)
    return out


@router.get("/trends")
def attendance_trends(weeks: int = 6, db: Session = Depends(get_db), user=Depends(_allowed)):
    """Per-week attendance % for EVERY overseen school over the last
    `weeks` (1-12) Mon-Fri windows, oldest → newest.

    One joined lean query over the whole window (school_id, date, status —
    ~5k rows for the demo), bucketed per school per Monday in Python.
    Deliberately does NOT reuse `_gather_school_data`: the command-center
    gather pulls all marks + exams, which is orders of magnitude heavier
    than the three attendance fields this endpoint needs. Gives the
    chairperson their first TEMPORAL view of the portfolio.
    """
    weeks = min(max(weeks, 1), 12)
    schools = _schools_of(user, db)
    if not schools:
        raise HTTPException(status_code=404, detail="No schools overseen by this chairperson.")
    school_ids = [s.id for s in schools]
    name_by_id = {s.id: s.name for s in schools}

    today = date.today()
    current_monday = today - timedelta(days=today.weekday())
    window_start = current_monday - timedelta(days=7 * (weeks - 1))
    window_end = current_monday + timedelta(days=4)

    monday_keys = [window_start + timedelta(days=7 * i) for i in range(weeks)]
    key_set = set(m.isoformat() for m in monday_keys)
    # buckets[school_id][monday_iso] = {marked, present}
    buckets: dict[int, dict[str, dict[str, int]]] = {sid: {} for sid in school_ids}
    for sid in school_ids:
        buckets[sid] = {m.isoformat(): {"marked": 0, "present": 0} for m in monday_keys}

    rows = (db.query(Class.school_id, Attendance.date, Attendance.status)
            .join(Student, Student.class_id == Class.id)
            .join(Attendance, Attendance.student_id == Student.id)
            .filter(Class.school_id.in_(school_ids),
                    Attendance.date >= window_start, Attendance.date <= window_end)
            .all())
    for sid, dt, st in rows:
        key = dt.isoformat() if hasattr(dt, "isoformat") else str(dt)
        if key not in key_set:
            continue
        b = buckets[sid][key]
        b["marked"] += 1
        if st == "P":
            b["present"] += 1

    mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    out = []
    for sid in school_ids:
        wk = []
        for m in monday_keys:
            b = buckets[sid][m.isoformat()]
            pct = round(b["present"] / b["marked"] * 100, 1) if b["marked"] else None
            wk.append({
                "start": m.isoformat(),
                "label": f"{mo[m.month - 1]} {m.day}",
                "marked": b["marked"],
                "present": b["present"],
                "pct": pct,
            })
        out.append({"school_id": sid, "name": name_by_id[sid], "weeks": wk})
    return {
        "window": [{"start": m.isoformat(), "label": f"{mo[m.month - 1]} {m.day}"} for m in monday_keys],
        "schools": out,
    }


@router.get("/compare")
def compare(db: Session = Depends(get_db), user=Depends(_allowed)):
    """School comparison matrix: avg per subject, avg per grade, attendance,
    at-risk count. Chart-ready."""
    schools = _schools_of(user, db)
    if not schools:
        raise HTTPException(status_code=404, detail="No schools overseen by this chairperson.")
    per_school = _gather_all_schools_data_cached(db, schools)

    # union of all subjects and grades across schools
    all_subject_ids: set[int] = set()
    all_grades: set[int] = set()
    for data in per_school.values():
        for s in data["subjects"]:
            all_subject_ids.add(s["subject_id"])
        for g in data["grades"]:
            all_grades.add(g["grade"])

    subject_axis = sorted(all_subject_ids)
    grade_axis = sorted(all_grades)

    rows = []
    for s in schools:
        data = per_school[s.id]
        # subject avg map
        subject_map = {subj["subject_id"]: subj["average"] for subj in data["subjects"]}
        # grade avg map
        grade_map = {g["grade"]: g["average"] for g in data["grades"]}
        at_risk = sum(1 for st in data["_student_stats"].values()
                      if st["average"] < 50 or st["attendance_rate"] < 60)
        top_student = data["top_performer"]
        rows.append({
            "school_id": s.id, "name": s.name,
            "students": data["total_students"],
            "average_pct": data["school_average"],
            "attendance_rate": _school_attendance_rate(data),
            "at_risk_count": at_risk,
            "top_student": top_student,
            "subject_averages": {str(sid): subject_map.get(sid) for sid in subject_axis},
            "grade_averages": {str(g): grade_map.get(g) for g in grade_axis},
        })
    # Subject leadership: which school leads in each subject?
    subject_leaders = []
    for sid in subject_axis:
        # collect (school_name, avg) tuples
        per_school_avgs = []
        subj_name = None
        subj_color = None
        for s in schools:
            data = per_school[s.id]
            sa = next((x for x in data["subjects"] if x["subject_id"] == sid), None)
            if sa:
                per_school_avgs.append((s.name, sa["average"]))
                subj_name = sa["name"]
                subj_color = sa["color"]
        if per_school_avgs:
            per_school_avgs.sort(key=lambda x: x[1], reverse=True)
            subject_leaders.append({
                "subject_id": sid, "name": subj_name, "color": subj_color,
                "leader": per_school_avgs[0][0] if per_school_avgs else None,
                "leader_avg": per_school_avgs[0][1] if per_school_avgs else None,
                "worst": per_school_avgs[-1][0] if per_school_avgs else None,
                "worst_avg": per_school_avgs[-1][1] if per_school_avgs else None,
            })

    return {
        "subjects": [{"subject_id": sid,
                      "name": next((x["name"] for d in per_school.values()
                                    for x in d["subjects"] if x["subject_id"] == sid), f"subject-{sid}"),
                      "color": next((x["color"] for d in per_school.values()
                                    for x in d["subjects"] if x["subject_id"] == sid), "#6366f1")}
                     for sid in subject_axis],
        "grades": grade_axis,
        "schools": rows,
        "subject_leaders": subject_leaders,
    }


# ── v17 multi-entity compare (CP compare sheet) ─────────────────────────────
# Same response contract as POST /principal/compare — each entity becomes
# {key, name, marks, attendance, tasks, t1, t2, t3, overall} — but scoped to
# the GROUP: schools/grades/classes/students across every overseen school.
# Folders are client-resolved (localStorage) and carry their member ids.
class CpCompareEntity(BaseModel):
    type: str  # school | grade | class | student | folder
    id: Optional[str] = None
    # display name override (the page shows school + class together)
    name: Optional[str] = None
    # folder entities carry their member ids from the client
    student_ids: Optional[List[int]] = None


class CpCompareBody(BaseModel):
    entities: List[CpCompareEntity]


@router.post("/compare")
def compare_entities(data: CpCompareBody, db: Session = Depends(get_db),
                     user=Depends(_allowed)):
    """Multi-entity compare (v17 CP compare sheet) — up to 7 entities, group
    scoped. Returns per entity:
    {key, name, marks, attendance, tasks, t1, t2, t3, overall}.

    metrics per type (group-wide, same averaging semantics everywhere else):
      school  → mean over that school's classes (id = school_id; no id =
                mean over the whole group)
      grade   → mean over every class of that grade in the group
      class   → the class's own rollups (marks / attendance / tasks + terms)
      student → the student's own all-term average / attendance / tasks
      folder  → mean over the folder's students (ids resolved by the client)
    A missing term renders as None (honest "no marks that term"), mirroring
    the principal sheet's CSV behaviour."""
    schools = _schools_of(user, db)
    if not schools:
        raise HTTPException(status_code=404, detail="No schools overseen by this chairperson.")
    if not data.entities:
        return {"entities": []}
    if len(data.entities) > 7:
        raise HTTPException(status_code=400, detail="Compare supports up to 7 entities.")
    school_ids = [s.id for s in schools]
    school_names = {s.id: s.name for s in schools}

    need_classes = any(e.type in ("school", "grade", "class") for e in data.entities)
    need_students = any(e.type in ("student", "folder") for e in data.entities)

    # ── class-level maps (group scoped) ──────────────────────────────────
    cls_rows: dict[int, dict] = {}
    cls_term: dict[int, dict[int, float]] = {}
    if need_classes:
        for cid_, grade, section, sid_ in (db.query(Class.id, Class.grade, Class.section,
                                                    Class.school_id)
                                             .filter(Class.school_id.in_(school_ids)).all()):
            cls_rows[cid_] = {"grade": grade, "section": section, "school_id": sid_,
                              "students": 0, "avg": 0.0, "att": 0.0, "tasks": 0.0}
        if cls_rows:
            ids = list(cls_rows.keys())
            for cid_, n in (db.query(Student.class_id, func.count(Student.id))
                            .filter(Student.class_id.in_(ids))
                            .group_by(Student.class_id).all()):
                if cid_ in cls_rows:
                    cls_rows[cid_]["students"] = n
            for cid_, s, n in (db.query(Student.class_id, func.sum(_pct_expr()), func.count(Mark.id))
                               .select_from(Mark)
                               .join(Exam, Mark.exam_id == Exam.id)
                               .join(Student, Mark.student_id == Student.id)
                               .filter(Student.class_id.in_(ids), Exam.max_score > 0)
                               .group_by(Student.class_id).all()):
                if cid_ in cls_rows:
                    cls_rows[cid_]["avg"] = round((s or 0.0) / n, 1) if n else 0.0
            for cid_, n, p in (db.query(Student.class_id, func.count(Attendance.id),
                                        func.sum(case((Attendance.status == "P", 1), else_=0)))
                               .select_from(Attendance)
                               .join(Student, Attendance.student_id == Student.id)
                               .filter(Student.class_id.in_(ids))
                               .group_by(Student.class_id).all()):
                if cid_ in cls_rows:
                    cls_rows[cid_]["att"] = round((p or 0) / n * 100, 1) if n else 0.0
            for cid_, n, c in (db.query(Task.class_id, func.count(TaskCompletion.id),
                                        func.sum(case((TaskCompletion.status == "completed", 1), else_=0)))
                               .select_from(TaskCompletion)
                               .join(Task, TaskCompletion.task_id == Task.id)
                               .filter(Task.class_id.in_(ids))
                               .group_by(Task.class_id).all()):
                if cid_ in cls_rows:
                    cls_rows[cid_]["tasks"] = round((c or 0) / n * 100, 1) if n else 0.0
            # per-term averages per class (None when a term has no marks)
            for cid_, term_label, s, n in (db.query(Student.class_id, Exam.term,
                                                    func.sum(_pct_expr()), func.count(Mark.id))
                                             .select_from(Mark)
                                             .join(Exam, Mark.exam_id == Exam.id)
                                             .join(Student, Mark.student_id == Student.id)
                                             .join(Class, Student.class_id == Class.id)
                                             .filter(Class.school_id.in_(school_ids),
                                                     Exam.max_score > 0)
                                             .group_by(Student.class_id, Exam.term).all()):
                t = _term_key(term_label)
                if t is not None and n and cid_ in cls_rows:
                    cls_term.setdefault(cid_, {})[t] = round((s or 0.0) / n, 1)

    def _class_cols(cids: list[int]) -> dict:
        cols = {}
        for tn in (1, 2, 3):
            vals = [cls_term[c][tn] for c in cids if tn in cls_term.get(c, {})]
            cols[f"t{tn}"] = round(sum(vals) / len(vals), 1) if vals else None
        return cols

    # ── student-level maps (only for the ids actually requested) ─────────
    stu_avg: dict[int, float] = {}
    stu_att: dict[int, float] = {}
    stu_tasks: dict[int, float] = {}
    stu_names: dict[int, str] = {}
    stu_term: dict[int, dict[int, float]] = {}
    if need_students:
        req_ids: set[int] = set()
        for ent in data.entities:
            if ent.type == "student" and ent.id and str(ent.id).isdigit():
                req_ids.add(int(ent.id))
            elif ent.type == "folder":
                req_ids.update(int(x) for x in (ent.student_ids or [])
                               if str(x).isdigit())
        # scope guard: every requested student must live in an overseen school
        if req_ids:
            in_scope = set()
            for sid_, nm in (db.query(Student.id, Student.name)
                             .join(Class, Student.class_id == Class.id)
                             .filter(Student.id.in_(req_ids),
                                     Class.school_id.in_(school_ids)).all()):
                in_scope.add(sid_)
                stu_names[sid_] = nm
            req_ids &= in_scope
        if req_ids:
            sids = list(req_ids)
            for sid_, s, n in (db.query(Mark.student_id, func.sum(_pct_expr()), func.count(Mark.id))
                               .select_from(Mark)
                               .join(Exam, Mark.exam_id == Exam.id)
                               .join(Student, Mark.student_id == Student.id)
                               .filter(Mark.student_id.in_(sids), Exam.max_score > 0)
                               .group_by(Mark.student_id).all()):
                if n:
                    stu_avg[sid_] = round((s or 0.0) / n, 1)
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
            for sid_, term_label, s, n in (db.query(Mark.student_id, Exam.term,
                                                    func.sum(_pct_expr()), func.count(Mark.id))
                                             .select_from(Mark)
                                             .join(Exam, Mark.exam_id == Exam.id)
                                             .filter(Mark.student_id.in_(sids),
                                                     Exam.max_score > 0)
                                             .group_by(Mark.student_id, Exam.term).all()):
                t = _term_key(term_label)
                if t is not None and n:
                    stu_term.setdefault(sid_, {})[t] = round((s or 0.0) / n, 1)

    def _student_cols(sids: list[int]) -> dict:
        cols = {}
        for tn in (1, 2, 3):
            vals = [stu_term[s][tn] for s in sids if tn in stu_term.get(s, {})]
            cols[f"t{tn}"] = round(sum(vals) / len(vals), 1) if vals else None
        return cols

    out = []
    for i, ent in enumerate(data.entities):
        etype = (ent.type or "").lower()
        if etype == "school":
            sid_ = int(ent.id) if ent.id and str(ent.id).isdigit() else None
            member_ids = [c for c, r in cls_rows.items()
                          if (sid_ is None or r["school_id"] == sid_)]
            if sid_ is not None and sid_ not in school_names:
                member_ids = []
            name = ent.name or (school_names.get(sid_, "—") if sid_ is not None
                                else "Entire Group")
            if member_ids:
                att = round(sum(cls_rows[c]["att"] for c in member_ids) / len(member_ids), 1)
                tsk = round(sum(cls_rows[c]["tasks"] for c in member_ids) / len(member_ids), 1)
                mrk = round(sum(cls_rows[c]["avg"] for c in member_ids) / len(member_ids), 1)
                out.append({"key": f"school|{ent.id}", "name": name,
                            "marks": mrk, "attendance": att, "tasks": tsk})
                out[-1].update(_class_cols(member_ids))
            else:
                out.append({"key": f"school|{ent.id}", "name": name,
                            "marks": 0.0, "attendance": 0.0, "tasks": 0.0})
        elif etype == "grade":
            g = int(ent.id) if ent.id and str(ent.id).isdigit() else None
            member_ids = [c for c, r in cls_rows.items()
                          if g is not None and r["grade"] == g]
            if not member_ids:
                out.append({"key": f"grade|{ent.id}", "name": ent.name or f"Grade {ent.id}",
                            "marks": 0.0, "attendance": 0.0, "tasks": 0.0})
            else:
                att = round(sum(cls_rows[c]["att"] for c in member_ids) / len(member_ids), 1)
                tsk = round(sum(cls_rows[c]["tasks"] for c in member_ids) / len(member_ids), 1)
                mrk = round(sum(cls_rows[c]["avg"] for c in member_ids) / len(member_ids), 1)
                out.append({"key": f"grade|{g}", "name": ent.name or f"Grade {g} · group",
                            "marks": mrk, "attendance": att, "tasks": tsk})
                out[-1].update(_class_cols(member_ids))
        elif etype == "class":
            cid_ = int(ent.id) if ent.id and str(ent.id).isdigit() else None
            r = cls_rows.get(cid_) if cid_ is not None else None
            if not r:
                out.append({"key": f"class|{ent.id}", "name": ent.name or "Class —",
                            "marks": 0.0, "attendance": 0.0, "tasks": 0.0})
            else:
                label = (ent.name or f"{school_names.get(r['school_id'], '')} · "
                         f"{r['grade']}-{r['section']}").strip(" ·") or "Class"
                out.append({"key": f"class|{cid_}", "name": label,
                            "marks": r["avg"], "attendance": r["att"], "tasks": r["tasks"]})
                out[-1].update(_class_cols([cid_]))
        elif etype == "student":
            sid_ = int(ent.id) if ent.id and str(ent.id).isdigit() else None
            if sid_ is None or sid_ not in stu_avg:
                out.append({"key": f"student|{ent.id}", "name": ent.name or "Student —",
                            "marks": 0.0, "attendance": 0.0, "tasks": 0.0})
            else:
                out.append({"key": f"student|{sid_}", "name": ent.name or stu_names.get(sid_) or f"Student {sid_}",
                            "marks": stu_avg[sid_],
                            "attendance": stu_att.get(sid_, 0.0),
                            "tasks": stu_tasks.get(sid_, 0.0)})
                out[-1].update(_student_cols([sid_]))
        elif etype == "folder":
            ids = [int(x) for x in (ent.student_ids or []) if str(x).isdigit()]
            valid = [s for s in ids if s in stu_avg]
            name = ent.name or ent.id or "Folder"
            if not valid:
                out.append({"key": f"folder|{i}", "name": str(name),
                            "marks": 0.0, "attendance": 0.0, "tasks": 0.0})
            else:
                out.append({
                    "key": f"folder|{i}", "name": str(name),
                    "marks": round(sum(stu_avg[s] for s in valid) / len(valid), 1),
                    "attendance": round(sum(stu_att.get(s, 0.0) for s in valid) / len(valid), 1),
                    "tasks": round(sum(stu_tasks.get(s, 0.0) for s in valid) / len(valid), 1),
                })
                out[-1].update(_student_cols(valid))
        else:
            raise HTTPException(status_code=400,
                                detail="entity.type must be school|grade|class|student|folder")

    for e in out:
        e["overall"] = round((e["marks"] + e["attendance"] + e["tasks"]) / 3, 1)
        for k, _tn in (("t1", 1), ("t2", 2), ("t3", 3)):
            e.setdefault(k, None)
    return {"entities": out}


@router.get("/rankings")
def rankings(db: Session = Depends(get_db), user=Depends(_allowed)):
    """Rank all schools by: overall avg, attendance, lowest at-risk count."""
    schools = _schools_of(user, db)
    if not schools:
        raise HTTPException(status_code=404, detail="No schools overseen by this chairperson.")
    per_school = _gather_all_schools_data_cached(db, schools)
    summaries = []
    for s in schools:
        data = per_school[s.id]
        summaries.append({
            "school_id": s.id, "name": s.name,
            "students": data["total_students"],
            "average_pct": data["school_average"],
            "attendance_rate": _school_attendance_rate(data),
            "at_risk_count": sum(1 for st in data["_student_stats"].values()
                                  if st["average"] < 50 or st["attendance_rate"] < 60),
        })
    by_avg = sorted(summaries, key=lambda x: x["average_pct"], reverse=True)
    by_attendance = sorted(summaries, key=lambda x: x["attendance_rate"], reverse=True)
    by_lowest_at_risk = sorted(summaries, key=lambda x: x["at_risk_count"])
    return {
        "by_average": by_avg,
        "by_attendance": by_attendance,
        "by_lowest_at_risk": by_lowest_at_risk,
    }


@router.get("/schools/{school_id}/inspect")
def school_inspect(school_id: int, db: Session = Depends(get_db), user=Depends(_allowed)):
    """Drill into one school: same data as the principal dashboard but for
    the chairperson's view."""
    schools = _schools_of(user, db)
    if not any(s.id == school_id for s in schools):
        raise HTTPException(status_code=403, detail="You do not oversee this school.")
    school = next((s for s in schools if s.id == school_id), None)
    if not school:
        raise HTTPException(status_code=404, detail="School not found.")
    data = _gather_school_data(db, school)
    summary = _school_public_summary(school, data)
    summary["attendance_rate"] = _school_attendance_rate(data)
    return {
        "school": data["school"],
        "summary": summary,
        "grades": data["grades"],
        "classes": data["classes"],
        "subjects": data["subjects"],
        "exams": data["exams"],
        "top_performer": data["top_performer"],
    }


@router.get("/classes/{class_id}/inspect")
def class_inspect(class_id: int, db: Session = Depends(get_db), user=Depends(_allowed)):
    """v17 drill-down: full report for ONE class anywhere in the group.

    Mirrors the /principal/class-detail/{id} contract exactly (info,
    subjects with t1/t2/t3, score distribution, ranked students) so the
    shared ClassDetail view renders it unchanged. The chairperson's scope
    is the whole group: every class of every overseen school is reachable,
    read-only. The SQL reuses the principal router's helpers with the
    class's own school, so every number matches what that school's
    principal sees by construction. Additive key vs the principal payload:
    "school" {id, name} (the CP page labels the drill-down with it)."""
    schools = _schools_of(user, db)
    if not schools:
        raise HTTPException(status_code=404, detail="No schools overseen by this chairperson.")
    overseen = {s.id: s for s in schools}
    cls = db.query(Class).filter(Class.id == class_id).first()
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found.")
    if cls.school_id not in overseen:
        raise HTTPException(status_code=403, detail="You do not oversee this school.")
    school = overseen[cls.school_id]

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
    pct_expr = _pct_expr()
    ss_map: dict[tuple[int, int], float] = {}
    for sid_, subj_id_, s_, n_ in (db.query(Student.id, Mark.subject_id,
                                            func.sum(pct_expr), func.count(Mark.id))
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
        "school": {"id": school.id, "name": school.name},
    }


@router.get("/insights")
def insights(db: Session = Depends(get_db), user=Depends(_allowed)):
    """Cross-school insights."""
    schools = _schools_of(user, db)
    if not schools:
        raise HTTPException(status_code=404, detail="No schools overseen by this chairperson.")
    per_school = _gather_all_schools_data_cached(db, schools)
    out: list[dict] = []

    summaries = []
    for s in schools:
        data = per_school[s.id]
        summaries.append({
            "school_id": s.id, "name": s.name,
            "data": data,
            "average_pct": data["school_average"],
            "attendance_rate": _school_attendance_rate(data),
            "at_risk_count": sum(1 for st in data["_student_stats"].values()
                                  if st["average"] < 50 or st["attendance_rate"] < 60),
            "students": data["total_students"],
        })

    # 1) Best performing school + why
    if summaries:
        best = max(summaries, key=lambda x: x["average_pct"])
        # which subjects/classes drive it?
        top_subjects = sorted(best["data"]["subjects"], key=lambda x: x["average"], reverse=True)[:3]
        top_classes = sorted(best["data"]["classes"], key=lambda x: x["average"], reverse=True)[:3]
        out.append({
            "type": "best_performing_school",
            "title": f"{best['name']} is the best performing school",
            "value": best["average_pct"],
            "detail": (
                f"{best['name']} leads with {best['average_pct']}% average "
                f"({best['students']} students). Top subjects: "
                + ", ".join(f"{s['name']} ({s['average']}%)" for s in top_subjects)
                + f". Top classes: "
                + ", ".join(f"{c['label']} ({c['average']}%)" for c in top_classes)
                + "."
            ),
            "severity": "good",
            "school_id": best["school_id"],
        })

        # 2) School needing most attention
        worst = min(summaries, key=lambda x: x["average_pct"])
        weak_subjects = sorted(worst["data"]["subjects"], key=lambda x: x["average"])[:3]
        weak_classes = sorted(worst["data"]["classes"], key=lambda x: x["average"])[:3]
        out.append({
            "type": "school_needing_attention",
            "title": f"{worst['name']} needs the most attention",
            "value": worst["average_pct"],
            "detail": (
                f"{worst['name']} has the lowest average at {worst['average_pct']}% "
                f"with {worst['at_risk_count']} at-risk students. Weakest subjects: "
                + ", ".join(f"{s['name']} ({s['average']}%)" for s in weak_subjects)
                + f". Weakest classes: "
                + ", ".join(f"{c['label']} ({c['average']}%)" for c in weak_classes)
                + "."
            ),
            "severity": "critical",
            "school_id": worst["school_id"],
        })

    # 3) Subject leadership — which school leads in each subject
    all_subject_ids: set[int] = set()
    for s in summaries:
        for sub in s["data"]["subjects"]:
            all_subject_ids.add(sub["subject_id"])
    for sid in sorted(all_subject_ids):
        per_school_avgs = []
        subj_name = None
        subj_color = None
        for s in summaries:
            sa = next((x for x in s["data"]["subjects"] if x["subject_id"] == sid), None)
            if sa:
                per_school_avgs.append((s["name"], sa["average"]))
                subj_name = sa["name"]
                subj_color = sa["color"]
        if len(per_school_avgs) < 2:
            continue
        per_school_avgs.sort(key=lambda x: x[1], reverse=True)
        leader_name, leader_avg = per_school_avgs[0]
        worst_name, worst_avg = per_school_avgs[-1]
        gap = round(leader_avg - worst_avg, 1)
        out.append({
            "type": "subject_leadership",
            "title": f"{subj_name}: {leader_name} leads",
            "value": gap,
            "detail": (
                f"{leader_name} leads in {subj_name} at {leader_avg}%, "
                f"ahead of {worst_name} ({worst_avg}%) by {gap} points."
            ),
            "severity": "good" if gap < 10 else "warning" if gap < 20 else "critical",
            "subject_id": sid,
            "subject_name": subj_name,
            "subject_color": subj_color,
        })

    # 4) Growth trajectory — which school improved most (first exam vs last exam)
    growth_per_school = []
    for s in summaries:
        data = s["data"]
        per_grade_first = []
        per_grade_last = []
        for grade, exam_ids in data["_grade_exams"].items():
            if not exam_ids:
                continue
            first_eid = exam_ids[0]
            last_eid = exam_ids[-1]
            first_ex = next((e for e in data["exams"] if e["exam_id"] == first_eid), None)
            last_ex = next((e for e in data["exams"] if e["exam_id"] == last_eid), None)
            if first_ex and last_ex:
                per_grade_first.append(first_ex["average"])
                per_grade_last.append(last_ex["average"])
        if per_grade_first and per_grade_last:
            avg_first = round(sum(per_grade_first) / len(per_grade_first), 1)
            avg_last = round(sum(per_grade_last) / len(per_grade_last), 1)
            growth_per_school.append({
                "school_id": s["school_id"], "name": s["name"],
                "first_exam_avg": avg_first, "last_exam_avg": avg_last,
                "delta": round(avg_last - avg_first, 1),
            })
    if growth_per_school:
        growth_per_school.sort(key=lambda x: x["delta"], reverse=True)
        top_growth = growth_per_school[0]
        bottom_growth = growth_per_school[-1]
        out.append({
            "type": "growth_trajectory",
            "title": f"{top_growth['name']} improved most",
            "value": top_growth["delta"],
            "detail": (
                f"{top_growth['name']} improved by {top_growth['delta']:+}% "
                f"({top_growth['first_exam_avg']}% → {top_growth['last_exam_avg']}%) "
                f"between first and last exams. "
                f"By contrast, {bottom_growth['name']} changed by {bottom_growth['delta']:+}% "
                f"({bottom_growth['first_exam_avg']}% → {bottom_growth['last_exam_avg']}%)."
            ),
            "severity": "good" if top_growth["delta"] > 0 else "warning",
            "school_id": top_growth["school_id"],
        })

    # 5) Attendance vs performance correlation across schools
    if len(summaries) >= 3:
        pairs = [(s["attendance_rate"], s["average_pct"]) for s in summaries]
        corr = _pearson(pairs)
        if corr is not None:
            severity = "good" if corr >= 0.5 else ("warning" if corr >= 0.2 else "critical")
            out.append({
                "type": "attendance_performance_correlation",
                "title": "Attendance ↔ Performance (cross-school)",
                "value": round(corr, 3),
                "detail": (
                    f"Pearson r = {corr:.3f} across {len(pairs)} schools. "
                    + ("Schools with higher attendance consistently outperform — attendance is a key lever."
                       if corr >= 0.5 else
                       "Some correlation but not consistent — investigate outliers."
                       if corr >= 0.2 else
                       "Weak correlation — performance is driven by factors other than attendance.")
                ),
                "severity": severity,
            })

    return out


def _pearson(pairs: list[tuple[float, float]]) -> Optional[float]:
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
# v16 CHAIRPERSON BUNDLE (designer v16 CP page — one-shot payload)
# ─────────────────────────────────────────────────────────────────────────────
# The v16 page renders the whole portfolio in one pass: group stats, per-school
# cards, grade rows, subject grids, attendance trends and org-wide ranked
# students/teachers. Fetching that as ~30 existing-endpoint calls would re-pay
# the multi-school gather over and over, so the page gets ONE payload built
# from the shared `_gather_all_schools_data_cached` snapshot (so every number
# matches the existing pages by construction) plus a handful of lean grouped
# queries for the bits the snapshot doesn't carry (tasks, attendance series,
# HOD / principal names).
#
# Averaging semantics (deliberately identical to the existing endpoints):
#   - overall / marks = all-term average of (score / exam.max_score * 100)
#     over every mark in scope — the exact `_gather_school_data`
#     `school_average` semantics, so school `overall` equals the
#     /chairperson/schools `average_pct` value.
#   - t1/t2/t3 = the same average narrowed to exam.term "Term 1/2/3".
#   - attendance = present / total * 100 (only "P" is present, "L" counts
#     against the rate — same as every existing attendance endpoint).
#   - tasks = completed / (completed + pending) * 100 from TaskCompletion.
# The designer prototype also derives OVERALL (A+T+AT) = (marks+tasks+att)/3
# client-side; every level of this payload carries marks, tasks and attendance
# so the page can render that composite without another endpoint.

_V16_SCHOOL_COLORS = ["#4f42dd", "#0c7a6b", "#b45f04",
                      "#c2255c", "#0e7490", "#9333ea"]

_V16_BANDS = ("<60", "60-69", "70-79", "80-89", "90+")

_V16_ATT_WINDOWS = {"30D": 30, "3M": 92, "6M": 183, "1Y": 366}

# Same single-flight TTL pattern as _GATHER_CACHE above: the derived bundle is
# pure-Python work over the (already cached) gather snapshot plus 4 grouped
# queries, but there is no reason to repeat it per page load either.
_V16_BUNDLE_CACHE: dict[tuple, tuple] = {}
_V16_BUNDLE_INFLIGHT: dict[tuple, threading.Event] = {}


def _v16_band_of(pct: float) -> str:
    """Designer distribution bands ('<60', '60-69', '70-79', '80-89', '90+')."""
    if pct < 60:
        return "<60"
    if pct < 70:
        return "60-69"
    if pct < 80:
        return "70-79"
    if pct < 90:
        return "80-89"
    return "90+"


def _v16_dense_ranks(items: list[dict], key: str, value: str) -> None:
    """Designer `denseRankField`: 1-based dense rank by `value` desc, ties
    share a rank; name/grade/id breaks sort ties for stable output."""
    def _sort_key(it):
        tie = it.get("name") if it.get("name") is not None else it.get("grade")
        if tie is None:
            tie = it.get("id")
        return (-it[value], str(tie))
    prev = None
    rank = 0
    for i, it in enumerate(sorted(items, key=_sort_key), start=1):
        if prev is None or it[value] != prev:
            rank = i
            prev = it[value]
        it[key] = rank


def _v16_term_avg(acc: dict, t: int) -> float:
    """Rounded term average from a [sum, count] accumulator (0.0 if empty)."""
    s, n = acc.get(t, [0.0, 0])
    return round(s / n, 1) if n else 0.0


def _v16_attendance_series(db: Session, school_ids: list[int]) -> dict:
    """Per-school + group attendance series for every designer range tab.

    One grouped query over the widest window (1Y), then each range is the
    filtered slice — the exact /principal/attendance-series logic (one point
    per day that has records, pct = present / total * 100, chronological)
    extended to group scope by pooling the per-school counts per day.
    Returns {"schools": {school_id: {"30D": [...], ...}},
             "group": {"30D": [...], ...}} with points {"date", "pct"}.
    """
    start = date.today() - timedelta(days=_V16_ATT_WINDOWS["1Y"] - 1)
    rows = (db.query(Class.school_id.label("sid"),
                     Attendance.date.label("d"),
                     func.count(Attendance.id).label("n"),
                     func.sum(case((Attendance.status == "P", 1), else_=0)).label("p"))
              .select_from(Attendance)
              .join(Student, Attendance.student_id == Student.id)
              .join(Class, Student.class_id == Class.id)
              .filter(Class.school_id.in_(school_ids), Attendance.date >= start)
              .group_by(Class.school_id, Attendance.date)
              .all())

    per_school: dict[int, dict[str, list[int]]] = {sid: {} for sid in school_ids}
    group: dict[str, list[int]] = {}
    for sid, d, n, p in rows:
        key = d.isoformat() if hasattr(d, "isoformat") else str(d)
        per_school[sid][key] = [n, p or 0]
        g = group.setdefault(key, [0, 0])
        g[0] += n
        g[1] += p or 0

    def _points(acc: dict[str, list[int]], days: int) -> list[dict]:
        range_start = (date.today() - timedelta(days=days - 1)).isoformat()
        return [{"date": k, "pct": round(v[1] / v[0] * 100, 1)}
                for k, v in sorted(acc.items()) if k >= range_start and v[0]]

    out = {"schools": {}, "group": {}}
    for rng, days in _V16_ATT_WINDOWS.items():
        out["group"][rng] = _points(group, days)
        for sid in school_ids:
            out["schools"].setdefault(sid, {})[rng] = _points(per_school[sid], days)
    return out


def _build_v16_bundle(db: Session, schools: list[School],
                      per_school: dict[int, dict]) -> dict:
    """Assemble the v16 payload. Read-only over the cached gather snapshot."""
    school_ids = [s.id for s in schools]

    # ── lean grouped lookups for what the snapshot doesn't carry ──────────
    # tasks: (school_id, grade) -> [total, completed] from TaskCompletion
    task_acc: dict[tuple[int, int], list[int]] = defaultdict(lambda: [0, 0])
    for sid, g, n, c in (db.query(Class.school_id, Class.grade,
                                  func.count(TaskCompletion.id),
                                  func.sum(case((TaskCompletion.status == "completed", 1),
                                                else_=0)))
                           .select_from(TaskCompletion)
                           .join(Task, TaskCompletion.task_id == Task.id)
                           .join(Class, Task.class_id == Class.id)
                           .filter(Class.school_id.in_(school_ids))
                           .group_by(Class.school_id, Class.grade).all()):
        task_acc[(sid, g)] = [n, c or 0]

    # HOD of subject: (school_id, subject_id) -> full name (is_hod rows,
    # same source as the principal dashboard's _hod_map)
    hod_names: dict[tuple[int, int], str] = {}
    for sid, subj_id, fname, email in (
        db.query(TeacherAssignment.school_id, TeacherAssignment.subject_id,
                 User.full_name, User.email)
          .join(User, TeacherAssignment.teacher_user_id == User.id)
          .filter(TeacherAssignment.school_id.in_(school_ids),
                  TeacherAssignment.is_hod.is_(True)).all()
    ):
        hod_names[(sid, subj_id)] = fname or email

    # principal of school
    principal_names: dict[int, str] = {}
    for sid, fname, email in (db.query(User.school_id, User.full_name, User.email)
                                .filter(User.role == "principal",
                                        User.school_id.in_(school_ids)).all()):
        principal_names[sid] = fname or email

    series = _v16_attendance_series(db, school_ids)

    school_rows: list[dict] = []
    school_term_accs: dict[int, dict] = {}
    school_grade_rows: dict[int, list[dict]] = {}

    for s_idx, s in enumerate(schools):
        data = per_school[s.id]
        exam_by_id = data["_exam_by_id"]

        # Term + band accumulation straight off the snapshot's per-student
        # marks — the same mark set that produces school_average, so the
        # bands always sum to the mark count behind the average.
        term_acc = {1: [0.0, 0], 2: [0.0, 0], 3: [0.0, 0]}
        subj_term_acc: dict[int, dict] = defaultdict(
            lambda: {1: [0.0, 0], 2: [0.0, 0], 3: [0.0, 0]})
        grade_term_acc: dict[int, dict] = defaultdict(
            lambda: {1: [0.0, 0], 2: [0.0, 0], 3: [0.0, 0]})
        band_counts = {b: 0 for b in _V16_BANDS}
        # v17: per-(grade, subject) term accumulation — powers the APERF
        # GRADE scope (subject radar per term at grade level), which the
        # school-level subjects[] cannot answer.
        g_subj_term_acc: dict[tuple[int, int], dict] = defaultdict(
            lambda: {1: [0.0, 0], 2: [0.0, 0], 3: [0.0, 0]})
        for st in data["_student_stats"].values():
            grade = st["grade"]
            for subj_id, pct, exam_id in st["_marks"]:
                ex = exam_by_id.get(exam_id)
                t = _term_key(ex.term) if ex else None
                if t is not None:
                    acc = term_acc[t]
                    acc[0] += pct
                    acc[1] += 1
                    s_acc = subj_term_acc[subj_id][t]
                    s_acc[0] += pct
                    s_acc[1] += 1
                    g_acc = grade_term_acc[grade][t]
                    g_acc[0] += pct
                    g_acc[1] += 1
                    gs_acc = g_subj_term_acc[(grade, subj_id)][t]
                    gs_acc[0] += pct
                    gs_acc[1] += 1
                band_counts[_v16_band_of(pct)] += 1
        school_term_accs[s.id] = term_acc

        # subjects: name/avg from the snapshot, terms + HOD + dense rank
        subjects_out = []
        for sub in data["subjects"]:
            st_terms = subj_term_acc.get(sub["subject_id"], {})
            subjects_out.append({
                "name": sub["name"],
                "avg": sub["average"],
                "t": [_v16_term_avg(st_terms, t) for t in (1, 2, 3)],
                "hod": hod_names.get((s.id, sub["subject_id"])),
            })
        subjects_out.sort(key=lambda x: (-x["avg"], x["name"]))
        _v16_dense_ranks(subjects_out, "rank", "avg")

        # grades: avg/att from the snapshot's grade rollup, terms from the
        # accumulation above, tasks from TaskCompletion, sections from the
        # class rollup, top-10 students from the per-student stats.
        grade_rows = []
        for g_row in data["grades"]:
            grade = g_row["grade"]
            n_tasks, c_tasks = task_acc.get((s.id, grade), [0, 0])
            top10 = sorted((st for st in data["_student_stats"].values()
                            if st["grade"] == grade),
                           key=lambda st: (-st["average"], st["name"].lower()))[:10]
            # v17 additions (all additive keys — the v16 page ignores them):
            #   sections[].id/att/students → global search + saved classes +
            #   the class drill-down; subject_terms[] → the APERF GRADE scope
            #   (subject radar per term at grade level).
            g_subjects = []
            for sub in data["subjects"]:
                gs_accs = g_subj_term_acc.get((grade, sub["subject_id"]))
                if not gs_accs or not any(v[1] for v in gs_accs.values()):
                    continue
                g_subjects.append({
                    "name": sub["name"],
                    "t": [_v16_term_avg(gs_accs, t) for t in (1, 2, 3)],
                })
            grade_rows.append({
                "grade": grade,
                "avg": g_row["average"],
                "t": [_v16_term_avg(grade_term_acc.get(grade, {}), t)
                      for t in (1, 2, 3)],
                "att": g_row["attendance_rate"],
                "task": round(c_tasks / n_tasks * 100, 1) if n_tasks else 0.0,
                "marks": g_row["average"],
                "overall": g_row["average"],
                "sections": [{"section": c["section"], "avg": c["average"],
                              "id": c["class_id"],
                              "att": c["attendance_rate"],
                              "students": c["students"]}
                             for c in data["classes"] if c["grade"] == grade],
                "subject_terms": g_subjects,
                "students_top10": [{"id": st["student_id"], "name": st["name"],
                                    "class": f"{st['grade']}-{st['section']}",
                                    "avg": st["average"]} for st in top10],
            })
        _v16_dense_ranks(grade_rows, "grank_in_school", "avg")
        school_grade_rows[s.id] = grade_rows

        n_tasks_total = sum(v[0] for (sid_, _g), v in task_acc.items() if sid_ == s.id)
        c_tasks_total = sum(v[1] for (sid_, _g), v in task_acc.items() if sid_ == s.id)
        school_rows.append({
            "id": s.id,
            "name": s.name,
            "color": _V16_SCHOOL_COLORS[s_idx % len(_V16_SCHOOL_COLORS)],
            "overall": data["school_average"],
            "t1": _v16_term_avg(term_acc, 1),
            "t2": _v16_term_avg(term_acc, 2),
            "t3": _v16_term_avg(term_acc, 3),
            "attendance": _school_attendance_rate(data),
            "tasks": round(c_tasks_total / n_tasks_total * 100, 1) if n_tasks_total else 0.0,
            "marks": data["school_average"],
            "principal": principal_names.get(s.id),
            "students": data["total_students"],
            "distribution": [{"band": b, "count": band_counts[b]} for b in _V16_BANDS],
            "attendance_series": series["schools"].get(s.id,
                                                       {rng: [] for rng in _V16_ATT_WINDOWS}),
            "subjects": subjects_out,
            "grades": grade_rows,
        })

    # dense org rank by overall desc (ties share rank), group rank after
    _v16_dense_ranks(school_rows, "org_rank", "overall")

    # xrank_across: for each grade index, dense rank across all schools
    for grade in sorted({g_row["grade"]
                         for rows in school_grade_rows.values() for g_row in rows}):
        entries = [g_row for s in schools
                   for g_row in school_grade_rows[s.id] if g_row["grade"] == grade]
        _v16_dense_ranks(entries, "xrank_across", "avg")

    # ── group level (matches /chairperson/overview semantics) ─────────────
    total_students = sum(r["students"] for r in school_rows)
    group_overall = (round(sum(r["overall"] * r["students"] for r in school_rows)
                           / total_students, 1) if total_students else 0.0)
    group_terms = {1: [0.0, 0], 2: [0.0, 0], 3: [0.0, 0]}
    for term_acc in school_term_accs.values():
        for t in (1, 2, 3):
            group_terms[t][0] += term_acc[t][0]
            group_terms[t][1] += term_acc[t][1]
    group_tasks_total = sum(v[0] for v in task_acc.values())
    group_tasks_done = sum(v[1] for v in task_acc.values())
    group_distribution = [{"band": b,
                           "count": sum(next(x["count"] for x in r["distribution"]
                                             if x["band"] == b)
                                         for r in school_rows)}
                          for b in _V16_BANDS]

    return {
        "group": {
            "overall": group_overall,
            "t1": _v16_term_avg(group_terms, 1),
            "t2": _v16_term_avg(group_terms, 2),
            "t3": _v16_term_avg(group_terms, 3),
            "attendance_rate": (round(sum(r["attendance"] * r["students"]
                                          for r in school_rows) / total_students, 1)
                                if total_students else 0.0),
            "tasks_rate": (round(group_tasks_done / group_tasks_total * 100, 1)
                           if group_tasks_total else 0.0),
            "marks_avg": group_overall,
            "students": total_students,
            "schools": len(schools),
            "distribution": group_distribution,
            "attendance_series": series["group"],
        },
        "schools": school_rows,
    }


def _v16_bundle_cached(db: Session, schools: list[School],
                       per_school: dict[int, dict]) -> dict:
    """Memoized + single-flight wrapper around `_build_v16_bundle` — the same
    TTL / threading.Event pattern as `_gather_all_schools_data_cached`."""
    key = tuple(sorted(s.id for s in schools))
    now = _time.monotonic()
    hit = _V16_BUNDLE_CACHE.get(key)
    if hit is not None and now - hit[0] < _GATHER_TTL:
        return hit[1]

    with _GATHER_LOCK:
        # double-check after acquiring the lock (another thread may have won)
        hit = _V16_BUNDLE_CACHE.get(key)
        if hit is not None and _time.monotonic() - hit[0] < _GATHER_TTL:
            return hit[1]
        ev = _V16_BUNDLE_INFLIGHT.get(key)
        if ev is None:
            ev = threading.Event()
            _V16_BUNDLE_INFLIGHT[key] = ev
            winner = True
        else:
            winner = False

    if winner:
        try:
            bundle = _build_v16_bundle(db, schools, per_school)
            _V16_BUNDLE_CACHE[key] = (_time.monotonic(), bundle)
            return bundle
        finally:
            with _GATHER_LOCK:
                _V16_BUNDLE_INFLIGHT.pop(key, None)
            ev.set()

    # loser: wait for the winner's computation, then serve the cached snapshot
    ev.wait(timeout=90)
    hit = _V16_BUNDLE_CACHE.get(key)
    if hit is not None:
        return hit[1]
    # extreme fallback (winner crashed before caching): compute inline
    return _build_v16_bundle(db, schools, per_school)


@router.get("/v16/bundle")
def v16_bundle(db: Session = Depends(get_db), user=Depends(_allowed)):
    """One payload for the whole v16 chairperson page.

    {"group": {overall, t1, t2, t3, attendance_rate, tasks_rate, marks_avg,
               students, schools, distribution, attendance_series{30D,3M,6M,1Y}},
     "schools": [{id, name, color, overall, t1, t2, t3, attendance, tasks,
                  marks, principal, students, org_rank, distribution,
                  attendance_series, subjects[{name,avg,t,hod,rank}],
                  grades[{grade,avg,t,att,task,marks,overall,sections,
                          grank_in_school,xrank_across,students_top10,
                          v17: sections[{section,avg,id,att,students}],
                               subject_terms[{name,t[3]}]}]}]}
    Cached with the same TTL/single-flight pattern as the multi-school gather.
    """
    schools = _schools_of(user, db)
    if not schools:
        raise HTTPException(status_code=404, detail="No schools overseen by this chairperson.")
    per_school = _gather_all_schools_data_cached(db, schools)
    return _v16_bundle_cached(db, schools, per_school)


@router.get("/v16/students")
def v16_students(search: Optional[str] = None,
                 page: int = 1,
                 page_size: int = 50,
                 min_avg: Optional[float] = None,
                 school_id: Optional[int] = None,
                 db: Session = Depends(get_db),
                 user=Depends(_allowed)):
    """Org-wide ranked students (rank across ALL overseen schools by their
    all-term average), server-side paginated like /principal/students:

    {"students":[{id,name,class,school,avg,org_rank}],"total","page","page_size"}

    search matches name / school / class; min_avg band filters (90/80/70/60/
    50/40 → avg >= band); school_id optionally narrows rows (ranks stay
    org-wide). page is 1-based; page_size capped at 200.
    """
    schools = _schools_of(user, db)
    if not schools:
        raise HTTPException(status_code=404, detail="No schools overseen by this chairperson.")
    school_by_id = {s.id: s for s in schools}
    scope_ids = [s.id for s in schools]
    if school_id is not None:
        if school_id not in school_by_id:
            raise HTTPException(status_code=403, detail="You do not oversee this school.")
        scope_ids = [school_id]

    page_size_out = min(max(int(page_size or 50), 1), 200)
    page_out = max(int(page or 1), 1)

    class_rows = (db.query(Class.id, Class.grade, Class.section, Class.school_id)
                    .filter(Class.school_id.in_(scope_ids)).all())
    class_by_id = {cid: (grade, section, sid)
                   for cid, grade, section, sid in class_rows}
    class_ids = list(class_by_id.keys())
    if not class_ids:
        return {"students": [], "total": 0, "page": page_out, "page_size": page_size_out}

    # per-student all-term average (one grouped query, _pct_expr semantics)
    avg_map: dict[int, float] = {}
    for sid_, s, n in (db.query(Mark.student_id, func.sum(_pct_expr()), func.count(Mark.id))
                         .select_from(Mark)
                         .join(Exam, Mark.exam_id == Exam.id)
                         .join(Student, Mark.student_id == Student.id)
                         .filter(Student.class_id.in_(class_ids), Exam.max_score > 0)
                         .group_by(Mark.student_id).all()):
        if n:
            avg_map[sid_] = (s or 0.0) / n

    rows = []
    for sid_, name, cid in (db.query(Student.id, Student.name, Student.class_id)
                              .filter(Student.class_id.in_(class_ids)).all()):
        grade, section, sid = class_by_id[cid]
        rows.append({
            "id": sid_,
            "name": name,
            "class": f"{grade}-{section}",
            "school": school_by_id[sid].name,
            "avg": round(avg_map.get(sid_, 0.0), 1),
        })

    # org-wide rank BEFORE any filter (same pattern as /principal/students)
    rows.sort(key=lambda r: (-r["avg"], r["name"].lower()))
    for i, r in enumerate(rows, start=1):
        r["org_rank"] = i

    if search:
        needle = search.strip().lower()
        rows = [r for r in rows if needle in r["name"].lower()
                or needle in r["school"].lower() or needle in r["class"].lower()]

    if min_avg is not None:
        try:
            min_avg_val = float(min_avg)
        except (TypeError, ValueError):
            min_avg_val = 0.0
        if min_avg_val > 0:
            rows = [r for r in rows if r["avg"] >= min_avg_val]

    total = len(rows)
    off = (page_out - 1) * page_size_out
    return {"students": rows[off:off + page_size_out], "total": total,
            "page": page_out, "page_size": page_size_out}


@router.get("/v16/teachers")
def v16_teachers(search: Optional[str] = None,
                 min_avg: Optional[float] = None,
                 page: int = 1,
                 page_size: int = 50,
                 db: Session = Depends(get_db),
                 user=Depends(_allowed)):
    """Org-wide ranked teachers across all overseen schools:

    {"teachers":[{id,name,school,subject,avg,is_hod,is_ct,org_rank}],
     "total","page","page_size"}

    is_hod = holds a class_id-NULL is_hod TeacherAssignment (HOD of subject);
    is_ct = class teacher of a class (is_class_teacher row or the class's
    class_teacher_id). avg = all-term average over the marks of every
    (class, subject) they teach — the same _pct_expr semantics everywhere
    else. Dense rank by avg desc (ties share a rank, mirroring
    /principal/teachers); teachers without marks trail with avg null.
    """
    schools = _schools_of(user, db)
    if not schools:
        raise HTTPException(status_code=404, detail="No schools overseen by this chairperson.")
    school_names = {s.id: s.name for s in schools}
    school_ids = [s.id for s in schools]

    page_size_out = min(max(int(page_size or 50), 1), 200)
    page_out = max(int(page or 1), 1)

    tas = (db.query(TeacherAssignment.teacher_user_id, TeacherAssignment.subject_id,
                    TeacherAssignment.class_id, TeacherAssignment.is_hod,
                    TeacherAssignment.is_class_teacher,
                    User.full_name, User.email, User.school_id, Subject.name)
             .join(User, TeacherAssignment.teacher_user_id == User.id)
             .join(Subject, TeacherAssignment.subject_id == Subject.id)
             .filter(TeacherAssignment.school_id.in_(school_ids)).all())
    if not tas:
        return {"teachers": [], "total": 0, "page": page_out, "page_size": page_size_out}

    load: dict[int, dict[int, set]] = defaultdict(lambda: defaultdict(set))
    hod_teachers: set[int] = set()
    ct_teachers: set[int] = set()
    teacher_names: dict[int, str] = {}
    teacher_school: dict[int, int] = {}
    subject_names: dict[int, str] = {}
    for tid, subj_id, cid, is_hod, is_ct, fname, email, usid, sname in tas:
        teacher_names[tid] = fname or email
        teacher_school[tid] = usid
        subject_names[subj_id] = sname
        if is_hod:
            hod_teachers.add(tid)
        if cid is None:
            continue
        load[tid][subj_id].add(cid)
        if is_ct:
            ct_teachers.add(tid)
    # a CT post may also be recorded only on Class.class_teacher_id
    for _cid, ct_id in (db.query(Class.id, Class.class_teacher_id)
                           .filter(Class.school_id.in_(school_ids),
                                   Class.class_teacher_id.isnot(None)).all()):
        if ct_id in teacher_names:
            ct_teachers.add(ct_id)

    # per (class, subject) mark sums for every overseen class — one grouped
    # query covering all teaching loads (superset of the assignments)
    cs_sums: dict[tuple[int, int], list] = {}
    for cid, subj_id, s, n in (db.query(Student.class_id, Mark.subject_id,
                                        func.sum(_pct_expr()), func.count(Mark.id))
                                 .select_from(Mark)
                                 .join(Exam, Mark.exam_id == Exam.id)
                                 .join(Student, Mark.student_id == Student.id)
                                 .join(Class, Student.class_id == Class.id)
                                 .filter(Class.school_id.in_(school_ids),
                                         Exam.max_score > 0)
                                 .group_by(Student.class_id, Mark.subject_id).all()):
        if n:
            cs_sums[(cid, subj_id)] = [s or 0.0, n]

    teachers = []
    for tid, by_subject in load.items():
        # primary subject = the one they teach in the most classes (same
        # tiebreak as the principal's _teacher_aggregates)
        primary_sid, _cids = max(by_subject.items(),
                                 key=lambda kv: (len(kv[1]), -kv[0]))
        tot_s = 0.0
        tot_n = 0
        for subj_id, cids in by_subject.items():
            for cid in cids:
                sn = cs_sums.get((cid, subj_id))
                if sn:
                    tot_s += sn[0]
                    tot_n += sn[1]
        teachers.append({
            "id": tid,
            "name": teacher_names[tid],
            "school": school_names.get(teacher_school[tid]),
            "subject": subject_names[primary_sid],
            "avg": round(tot_s / tot_n, 1) if tot_n else None,
            "is_hod": tid in hod_teachers,
            "is_ct": tid in ct_teachers,
        })

    # dense rank by avg desc (None last), mirroring /principal/teachers
    teachers.sort(key=lambda t: (-(t["avg"] if t["avg"] is not None else -1.0),
                                 t["name"].lower()))
    rank, prev = 0, object()
    for t in teachers:
        if t["avg"] != prev:
            rank += 1
            prev = t["avg"]
        t["org_rank"] = rank

    if search:
        needle = search.strip().lower()
        teachers = [t for t in teachers
                    if needle in t["name"].lower()
                    or needle in (t["school"] or "").lower()
                    or needle in (t["subject"] or "").lower()]

    if min_avg is not None:
        try:
            min_avg_val = float(min_avg)
        except (TypeError, ValueError):
            min_avg_val = 0.0
        if min_avg_val > 0:
            teachers = [t for t in teachers
                        if t["avg"] is not None and t["avg"] >= min_avg_val]

    total = len(teachers)
    off = (page_out - 1) * page_size_out
    return {"teachers": teachers[off:off + page_size_out], "total": total,
            "page": page_out, "page_size": page_size_out}


# ─────────────────────────────────────────────────────────────────────────────
# AI ANALYZE
# ─────────────────────────────────────────────────────────────────────────────
class AnalyzeBody(BaseModel):
    question: str
    # recent panel turns (role: user|assistant, content) → follow-up memory
    history: Optional[List[dict]] = None


SYSTEM_PROMPT = (
    "You are an AI assistant for a chairperson overseeing multiple schools. "
    "You have tools to query live data across your portfolio. When you need "
    "specific info, call a tool by responding with ONLY: "
    "{\"tool\":\"tool_name\",\"args\":{...}}. After getting the result, give "
    "a detailed markdown answer with specific school names, numbers, and "
    "comparisons. Highlight which schools need attention and why. Suggest "
    "concrete cross-school actions. Use ## headers, **bold**, and - bullet lists."
)


def _build_chair_snapshot(per_school: dict[int, dict], schools: list[School]) -> dict:
    """Compact snapshot of all schools for the AI prompt."""
    school_entries = []
    for s in schools:
        data = per_school[s.id]
        school_entries.append({
            "name": s.name,
            "students": data["total_students"],
            "classes": data["total_classes"],
            "average_pct": data["school_average"],
            "attendance_pct": _school_attendance_rate(data),
            "at_risk_count": sum(1 for st in data["_student_stats"].values()
                                  if st["average"] < 50 or st["attendance_rate"] < 60),
            "top_performer": data["top_performer"],
            "weakest_subject": min(data["subjects"], key=lambda x: x["average"])["name"]
                              if data["subjects"] else None,
            "strongest_subject": max(data["subjects"], key=lambda x: x["average"])["name"]
                                 if data["subjects"] else None,
            "subject_averages": {x["name"]: x["average"] for x in data["subjects"]},
            "grade_averages": {g["grade"]: g["average"] for g in data["grades"]},
        })
    # overall
    total_students = sum(e["students"] for e in school_entries)
    overall_avg = round(sum(e["average_pct"] * e["students"] for e in school_entries) /
                        total_students, 1) if total_students else 0.0
    return {
        "total_schools": len(schools),
        "total_students": total_students,
        "overall_average_pct": overall_avg,
        "schools": school_entries,
    }


def _compact_portfolio_summary(schools: list[School], per_school: dict[int, dict]) -> str:
    """One-paragraph text snapshot of the chairperson's portfolio."""
    if not schools:
        return "No schools overseen."
    entries = []
    total_students = 0
    weighted_avg_sum = 0.0
    for s in schools:
        data = per_school[s.id]
        weak = min(data["subjects"], key=lambda x: x["average"])["name"] if data["subjects"] else "?"
        strong = max(data["subjects"], key=lambda x: x["average"])["name"] if data["subjects"] else "?"
        at_risk = sum(1 for st in data["_student_stats"].values()
                      if st["average"] < 50 or st["attendance_rate"] < 60)
        entries.append(
            f"{s.name} (avg {data['school_average']}%, "
            f"{data['total_students']} students, "
            f"{at_risk} at-risk, strong: {strong}, weak: {weak})"
        )
        total_students += data["total_students"]
        weighted_avg_sum += data["school_average"] * data["total_students"]
    overall = round(weighted_avg_sum / total_students, 1) if total_students else 0.0
    return (
        f"Portfolio: {len(schools)} schools, {total_students} students total, "
        f"overall average {overall}%. Schools — " + "; ".join(entries) + "."
    )


@router.post("/ai/analyze")
@limiter.limit("30/minute")
async def ai_analyze(request: Request, body: AnalyzeBody, db: Session = Depends(get_db), user=Depends(_allowed)):
    question = (body.question or "").strip()
    schools = _schools_of(user, db)
    if not schools:
        raise HTTPException(status_code=404, detail="No schools overseen by this chairperson.")
    per_school = _gather_all_schools_data_cached(db, schools)
    snapshot = _build_chair_snapshot(per_school, schools)

    if not question:
        return {
            "answer": "Ask me to compare your schools, identify which needs attention, or summarize performance.",
            "source": "fallback",
            "data_snapshot": snapshot,
            "tools_used": [],
        }

    # Agentic loop: the chairperson's tools operate across ALL overseen
    # schools. We pass `schools=[...]` plus the pre-computed per_school dict
    # (wrapped so ai_tools can extract it) via `ctx`.
    result = await ask_ai_agentic(
        question=question,
        system_prompt=SYSTEM_PROMPT,
        db=db,
        tools=CHAIRPERSON_TOOLS,
        context_summary=_compact_portfolio_summary(schools, per_school),
        ctx={"schools": schools, "_data": {"per_school": per_school}},
        history=body.history,
    )
    return {
        "answer": result["answer"],
        "source": result["source"],
        "tools_used": result.get("tools_used", []),
        "data_snapshot": snapshot,
    }
