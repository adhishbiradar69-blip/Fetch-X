
import json
import statistics
import threading
import time as _time
from collections import defaultdict
from datetime import date, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_role
from app.rate_limit import limiter
from app.models.attendance import Attendance
from app.models.class_ import Class
from app.models.school import School
from app.models.student import Student
from app.models.user import User
from app.models.user_school import UserSchool
from app.routers.principal import _gather_school_data  # reuse the heavy one-shot helper
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
_GATHER_TTL = 120.0  # seconds — seeded demo data is effectively static
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
