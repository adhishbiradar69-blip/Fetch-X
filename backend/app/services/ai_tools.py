"""Agentic AI tools — small, focused data-fetching functions the LLM can
call on demand during a multi-turn conversation.

Each tool takes ``(db, school, **args)`` (principal tools) or
``(db, schools, **args)`` (chairperson tools) and returns a *compact*
plain-text string. The agentic loop in ``ai_service.ask_ai_agentic``
parses the LLM's tool-call request, executes the matching tool, and feeds
the result back into the conversation.

To avoid re-running the (relatively heavy) ``_gather_school_data`` snapshot
on every tool call, each tool accepts an optional ``_data`` kwarg. The
agentic loop pre-computes the snapshot once at request entry and threads it
into every tool call. If ``_data`` is ``None`` the tool falls back to a
lazy import + on-the-fly computation.
"""
from __future__ import annotations

import statistics
from collections import defaultdict
from typing import Optional

from sqlalchemy.orm import Session

from app.models.attendance import Attendance
from app.models.class_ import Class
from app.models.exam import Exam
from app.models.mark import Mark
from app.models.school import School
from app.models.student import Student
from app.models.subject import Subject


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────
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


def _school_data(db: Session, school: School, _data: dict | None = None) -> dict:
    """Return the pre-computed snapshot if provided, else compute on the fly.

    Lazy-imports ``_gather_school_data`` from the principal router to avoid a
    circular import at module load (principal imports ai_service which
    imports ai_tools).
    """
    if _data is not None:
        return _data
    from app.routers.principal import _gather_school_data
    return _gather_school_data(db, school)


def _fmt_student(st: dict) -> str:
    """One-line compact summary of a student-stats dict."""
    strongest = st.get("strongest_subject") or {}
    weakest = st.get("weakest_subject") or {}
    return (
        f"- {st['name']} (roll {st.get('roll_no') or '?'}) — "
        f"Grade {st['grade']}-{st['section']} · avg {st['average']}% · "
        f"rank {st.get('rank_in_class')}/{st.get('class_size', '?')} in class, "
        f"{st.get('rank_in_grade')}/{st.get('grade_size', '?')} in grade · "
        f"attendance {st.get('attendance_rate', 0)}% · "
        f"strongest: {strongest.get('name', '?')} ({strongest.get('average', '?')}%) · "
        f"weakest: {weakest.get('name', '?')} ({weakest.get('average', '?')}%)"
    )


# ─────────────────────────────────────────────────────────────────────────────
# Principal tools — each takes (db, school, **args) and returns a string
# ─────────────────────────────────────────────────────────────────────────────
def get_student_details(db: Session, school: School, name: str,
                        _data: dict | None = None) -> str:
    """Find student by fuzzy (ilike) name match; return their average, rank,
    class, strongest/weakest subject, and attendance."""
    if not name:
        return "Error: 'name' argument is required for get_student_details."
    # Search students in this school by ilike
    matches = (
        db.query(Student)
        .join(Class, Student.class_id == Class.id)
        .filter(Class.school_id == school.id)
        .filter(Student.name.ilike(f"%{name.strip()}%"))
        .all()
    )
    if not matches:
        return f"No student found matching '{name}' in {school.name}."
    data = _school_data(db, school, _data)
    stats = data["_student_stats"]
    rows = []
    for stu in matches[:5]:
        st = stats.get(stu.id)
        if not st:
            continue
        rows.append(_fmt_student(st))
        # detailed subject averages
        if st.get("subject_averages"):
            sub_by_id = data["_subject_by_id"]
            rows.append("  Subject averages:")
            for sid, avg in sorted(st["subject_averages"].items()):
                sub = sub_by_id.get(sid)
                rows.append(f"    - {sub.name if sub else '?'}: {avg}%")
        # improvement trend
        if st.get("first_exam_average") is not None and st.get("last_exam_average") is not None:
            rows.append(
                f"  Improvement: first exam {st['first_exam_average']}% → "
                f"last exam {st['last_exam_average']}% "
                f"(Δ {st['improvement_delta']:+}%)"
            )
    header = (f"Found {len(matches)} student(s) matching '{name}' in {school.name}. "
              f"Showing top {len(rows) // 4}:") if len(matches) > 1 else f"Student details for {matches[0].name}:"
    return header + "\n" + "\n".join(rows)


def get_class_comparison(db: Session, school: School, grade: int,
                         _data: dict | None = None) -> str:
    """All classes in the given grade with averages, top students, attendance."""
    try:
        grade = int(grade)
    except (TypeError, ValueError):
        return f"Error: 'grade' must be an integer (got {grade!r})."
    data = _school_data(db, school, _data)
    class_rows = [c for c in data["_class_rows"] if c["grade"] == grade]
    if not class_rows:
        return f"No classes found in grade {grade} at {school.name}."
    class_rows.sort(key=lambda c: c["section"])
    grade_row = next((g for g in data["grades"] if g["grade"] == grade), None)
    grade_avg = grade_row["average"] if grade_row else 0.0
    lines = [f"Class comparison for Grade {grade} at {school.name} "
             f"(grade avg {grade_avg}%):"]
    for c in class_rows:
        top = c.get("top_student") or {}
        weak = c.get("weakest_subject") or {}
        strong = c.get("strongest_subject") or {}
        lines.append(
            f"- Section {c['section']} ({c['students']} students) — "
            f"avg {c['average']}% · attendance {c['attendance_rate']}% · "
            f"at-risk {c['at_risk_count']} · "
            f"top: {top.get('name', '?')} ({top.get('average', '?')}%) · "
            f"strongest subj: {strong.get('name', '?')} ({strong.get('average', '?')}%) · "
            f"weakest subj: {weak.get('name', '?')} ({weak.get('average', '?')}%)"
        )
    # Best/worst section overall
    best = max(class_rows, key=lambda c: c["average"])
    worst = min(class_rows, key=lambda c: c["average"])
    lines.append(
        f"Best section: {best['section']} ({best['average']}%). "
        f"Needs attention: {worst['section']} ({worst['average']}%)."
    )
    return "\n".join(lines)


def get_subject_analysis(db: Session, school: School, subject_name: str,
                         _data: dict | None = None) -> str:
    """Subject's school-wide average, per-grade breakdown, and which classes
    are strongest/weakest at it."""
    if not subject_name:
        return "Error: 'subject_name' argument is required."
    data = _school_data(db, school, _data)
    subject_name_lc = subject_name.strip().lower()
    # Find the subject by fuzzy name match
    subj = next((s for s in data["subjects"]
                 if subject_name_lc in s["name"].lower()), None)
    if not subj:
        avail = ", ".join(s["name"] for s in data["subjects"]) or "(none)"
        return (f"No subject matching '{subject_name}' at {school.name}. "
                f"Available: {avail}.")
    sid = subj["subject_id"]
    sub_name = subj["name"]
    # Per-grade breakdown
    grade_rows = []
    for g in data["grades"]:
        sa = next((s for s in g["subject_averages"] if s["subject_id"] == sid), None)
        if sa:
            grade_rows.append((g["grade"], sa["average"], sa["pass_rate"], g["students"]))
    # Per-class breakdown (strongest/weakest)
    class_avgs = []
    for c in data["_class_rows"]:
        sa = next((s for s in c["subject_averages"] if s["subject_id"] == sid), None)
        if sa and sa["average"] is not None:
            class_avgs.append((c["label"], sa["average"]))
    class_avgs.sort(key=lambda x: x[1], reverse=True)
    lines = [
        f"Subject analysis: {sub_name} at {school.name}",
        f"- School-wide average: {subj['average']}% · pass rate {subj['pass_rate']}% · "
        f"{subj['student_count']} marks recorded.",
    ]
    if grade_rows:
        lines.append("- Per-grade averages:")
        for grade, avg, pr, n in grade_rows:
            lines.append(f"  · Grade {grade} ({n} students): avg {avg}%, pass rate {pr}%")
    if class_avgs:
        best = class_avgs[0]
        worst = class_avgs[-1]
        lines.append(
            f"- Strongest class: {best[0]} ({best[1]}%). "
            f"Weakest class: {worst[0]} ({worst[1]}%). "
            f"Gap: {round(best[1] - worst[1], 1)} percentage points."
        )
        if len(class_avgs) > 2:
            lines.append("- All classes:")
            for label, avg in class_avgs:
                lines.append(f"  · {label}: {avg}%")
    return "\n".join(lines)


def get_at_risk_students(db: Session, school: School, limit: int = 10,
                        _data: dict | None = None) -> str:
    """Top N at-risk students (avg < 50% or attendance < 60%) with names,
    averages, and reasons."""
    try:
        limit = int(limit)
    except (TypeError, ValueError):
        limit = 10
    limit = max(1, min(limit, 50))
    data = _school_data(db, school, _data)
    at_risk = []
    for st in data["_student_stats"].values():
        reasons = []
        if st["average"] < 50:
            reasons.append(f"low average ({st['average']}%)")
        if st["attendance_rate"] < 60:
            reasons.append(f"poor attendance ({st['attendance_rate']}%)")
        if reasons:
            weak = st.get("weakest_subject") or {}
            at_risk.append({
                "name": st["name"],
                "class_label": st["class_label"],
                "average": st["average"],
                "attendance_rate": st["attendance_rate"],
                "weakest_subject": weak.get("name"),
                "weakest_avg": weak.get("average"),
                "reasons": reasons,
            })
    at_risk.sort(key=lambda x: x["average"])
    at_risk = at_risk[:limit]
    if not at_risk:
        return f"No at-risk students at {school.name}."
    lines = [f"Top {len(at_risk)} at-risk students at {school.name}:"]
    for i, s in enumerate(at_risk, 1):
        weak_info = (f"; weakest subject: {s['weakest_subject']} ({s['weakest_avg']}%)"
                     if s.get("weakest_subject") else "")
        lines.append(
            f"{i}. {s['name']} ({s['class_label']}) — avg {s['average']}% · "
            f"attendance {s['attendance_rate']}% · "
            f"reason: {', '.join(s['reasons'])}{weak_info}"
        )
    return "\n".join(lines)


def get_top_performers(db: Session, school: School, n: int = 10,
                       _data: dict | None = None) -> str:
    """Top N students with names, averages, classes."""
    try:
        n = int(n)
    except (TypeError, ValueError):
        n = 10
    n = max(1, min(n, 50))
    data = _school_data(db, school, _data)
    ranked = sorted(data["_student_stats"].values(),
                    key=lambda x: x["average"], reverse=True)[:n]
    if not ranked:
        return f"No students found at {school.name}."
    lines = [f"Top {len(ranked)} performers at {school.name}:"]
    for i, st in enumerate(ranked, 1):
        strong = st.get("strongest_subject") or {}
        lines.append(
            f"{i}. {st['name']} — {st['class_label']} — avg {st['average']}% · "
            f"attendance {st['attendance_rate']}% · "
            f"rank {st.get('rank_in_class')}/{st.get('class_size', '?')} in class · "
            f"strongest: {strong.get('name', '?')} ({strong.get('average', '?')}%)"
        )
    return "\n".join(lines)


def get_grade_trend(db: Session, school: School, grade: int,
                    _data: dict | None = None) -> str:
    """That grade's average across each exam (chronological)."""
    try:
        grade = int(grade)
    except (TypeError, ValueError):
        return f"Error: 'grade' must be an integer (got {grade!r})."
    data = _school_data(db, school, _data)
    grade_exams = data["_grade_exams"].get(grade, [])
    if not grade_exams:
        return f"No exams found for grade {grade} at {school.name}."
    exam_by_id = data["_exam_by_id"]
    # Per-exam average for that grade — recompute from raw marks
    grade_class_ids = [c.id for c in data["_classes"] if c.grade == grade]
    grade_student_ids = [sid for sid, st in data["_student_stats"].items()
                         if st["grade"] == grade]
    if not grade_student_ids:
        return f"No students found in grade {grade} at {school.name}."
    # exam_id -> list of pct
    per_exam_pcts: dict[int, list[float]] = defaultdict(list)
    for sid in grade_student_ids:
        st = data["_student_stats"][sid]
        for eid, avg in st["exam_averages"].items():
            # Weight by # of subjects the student took in that exam
            per_exam_pcts[eid].append(avg)
    lines = [f"Grade {grade} exam trend at {school.name}:"]
    for eid in grade_exams:
        ex = exam_by_id.get(eid)
        pcts = per_exam_pcts.get(eid, [])
        avg = round(sum(pcts) / len(pcts), 1) if pcts else 0.0
        lines.append(
            f"- {ex.name if ex else f'exam #{eid}'} (term {ex.term if ex and ex.term else '?'}, "
            f"max {ex.max_score if ex else '?'}) — avg {avg}% across {len(pcts)} students"
        )
    if len(grade_exams) >= 2:
        first = per_exam_pcts.get(grade_exams[0], [])
        last = per_exam_pcts.get(grade_exams[-1], [])
        if first and last:
            fa = round(sum(first) / len(first), 1)
            la = round(sum(last) / len(last), 1)
            lines.append(f"Δ from first → last exam: {round(la - fa, +1):+}% ({fa}% → {la}%).")
    return "\n".join(lines)


def get_attendance_impact(db: Session, school: School,
                          _data: dict | None = None) -> str:
    """Pearson correlation between attendance rate and average score across
    all students in this school."""
    data = _school_data(db, school, _data)
    pairs = [(st["attendance_rate"], st["average"])
             for st in data["_student_stats"].values()]
    if len(pairs) < 3:
        return (f"Not enough student data ({len(pairs)} students) at "
                f"{school.name} to compute attendance correlation.")
    r = _pearson(pairs)
    if r is None:
        return (f"Attendance vs performance correlation at {school.name}: "
                f"cannot compute (no variance in {len(pairs)} students).")
    # Bin students by attendance band
    bands = {"<60%": [], "60-80%": [], "80-95%": [], "95-100%": []}
    for st in data["_student_stats"].values():
        ar = st["attendance_rate"]
        if ar < 60:
            bands["<60%"].append(st["average"])
        elif ar < 80:
            bands["60-80%"].append(st["average"])
        elif ar < 95:
            bands["80-95%"].append(st["average"])
        else:
            bands["95-100%"].append(st["average"])
    lines = [
        f"Attendance ↔ Performance correlation at {school.name}:",
        f"- Pearson r = {r:.3f} across {len(pairs)} students.",
        f"- Interpretation: " + (
            "strong positive — attendance clearly drives performance." if r >= 0.5 else
            "moderate positive — attendance matters but isn't the only factor." if r >= 0.2 else
            "weak/negligible — performance is driven by other factors." if r >= -0.2 else
            "negative — unexpected inverse pattern, investigate outliers."),
        "- Average score by attendance band:",
    ]
    for band, avgs in bands.items():
        if avgs:
            lines.append(f"  · attendance {band}: avg {round(sum(avgs)/len(avgs), 1)}% "
                         f"({len(avgs)} students)")
    return "\n".join(lines)


def get_improvement_candidates(db: Session, school: School,
                               _data: dict | None = None) -> str:
    """Students who improved most from first to last exam."""
    data = _school_data(db, school, _data)
    candidates = [st for st in data["_student_stats"].values()
                  if st["improvement_delta"] is not None]
    if not candidates:
        return (f"No improvement data available at {school.name} "
                f"(need at least 2 exams per grade).")
    candidates.sort(key=lambda x: x["improvement_delta"], reverse=True)
    top = candidates[:10]
    lines = [f"Top {len(top)} most-improved students at {school.name}:"]
    for i, st in enumerate(top, 1):
        lines.append(
            f"{i}. {st['name']} ({st['class_label']}) — "
            f"first exam {st['first_exam_average']}% → last exam {st['last_exam_average']}% "
            f"(Δ {st['improvement_delta']:+}%) · current avg {st['average']}%"
        )
    # Also show decliners
    decliners = sorted(candidates, key=lambda x: x["improvement_delta"])[:5]
    if decliners and decliners[0]["improvement_delta"] < 0:
        lines.append("")
        lines.append("Students who declined most (need attention):")
        for i, st in enumerate(decliners, 1):
            if st["improvement_delta"] >= 0:
                break
            lines.append(
                f"{i}. {st['name']} ({st['class_label']}) — "
                f"first exam {st['first_exam_average']}% → last exam {st['last_exam_average']}% "
                f"(Δ {st['improvement_delta']:+}%)"
            )
    return "\n".join(lines)


def get_school_summary(db: Session, school: School,
                       _data: dict | None = None) -> str:
    """School totals, averages, top performer, at-risk count, weakest subject."""
    data = _school_data(db, school, _data)
    at_risk_count = sum(1 for st in data["_student_stats"].values()
                        if st["average"] < 50 or st["attendance_rate"] < 60)
    weakest = min(data["subjects"], key=lambda x: x["average"]) if data["subjects"] else None
    strongest = max(data["subjects"], key=lambda x: x["average"]) if data["subjects"] else None
    top = data.get("top_performer") or {}
    lines = [
        f"School summary: {school.name}",
        f"- Students: {data['total_students']} · Classes: {data['total_classes']} · "
        f"Exams: {data['total_exams']}",
        f"- School-wide average: {data['school_average']}%",
        f"- At-risk students: {at_risk_count} "
        f"({round(at_risk_count / max(data['total_students'], 1) * 100, 1)}% of student body)",
    ]
    if top:
        lines.append(f"- Top performer: {top.get('name')} ({top.get('average')}%)")
    if weakest:
        lines.append(f"- Weakest subject: {weakest['name']} ({weakest['average']}%, "
                     f"pass rate {weakest['pass_rate']}%)")
    if strongest:
        lines.append(f"- Strongest subject: {strongest['name']} ({strongest['average']}%)")
    # Grade roll-up (one line each)
    if data["grades"]:
        lines.append("- Grade averages:")
        for g in data["grades"]:
            lines.append(f"  · Grade {g['grade']} ({g['students']} students, "
                         f"{g['classes']} sections): avg {g['average']}%, "
                         f"attendance {g['attendance_rate']}%")
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# Principal TOOLS registry
# ─────────────────────────────────────────────────────────────────────────────
TOOLS: dict[str, dict] = {
    "get_student_details": {
        "description": (
            "Find a student by name (case-insensitive fuzzy match) and return their "
            "average %, rank in class & grade, class label, attendance %, "
            "strongest/weakest subject, and improvement trend."
        ),
        "params": {"name": "string (required) — part or all of the student's name"},
        "function": get_student_details,
    },
    "get_class_comparison": {
        "description": (
            "Compare all sections (classes) in a single grade side by side — "
            "averages, attendance, top student, strongest/weakest subject per section."
        ),
        "params": {"grade": "integer (required) — grade level (e.g. 8)"},
        "function": get_class_comparison,
    },
    "get_subject_analysis": {
        "description": (
            "Analyze one subject across the whole school: school-wide average, "
            "per-grade breakdown, and which classes are strongest/weakest at it."
        ),
        "params": {"subject_name": "string (required) — subject name (e.g. 'Math')"},
        "function": get_subject_analysis,
    },
    "get_at_risk_students": {
        "description": (
            "List the most at-risk students (avg < 50% or attendance < 60%) with "
            "names, averages, attendance, and the specific reason they're flagged."
        ),
        "params": {"limit": "integer (optional, default 10) — max students to return"},
        "function": get_at_risk_students,
    },
    "get_top_performers": {
        "description": (
            "List the school's top-performing students by average score, with their "
            "class label, attendance, and strongest subject."
        ),
        "params": {"n": "integer (optional, default 10) — number of students to return"},
        "function": get_top_performers,
    },
    "get_grade_trend": {
        "description": (
            "Show how one grade's average has moved across each exam (chronologically). "
            "Use this to spot grades that are improving or declining over time."
        ),
        "params": {"grade": "integer (required) — grade level"},
        "function": get_grade_trend,
    },
    "get_attendance_impact": {
        "description": (
            "Compute the Pearson correlation between attendance rate and average score "
            "across all students in the school, plus averages per attendance band. "
            "Use this when asked whether attendance drives performance."
        ),
        "params": {},
        "function": get_attendance_impact,
    },
    "get_improvement_candidates": {
        "description": (
            "Students who improved most from first to last exam (and those who declined "
            "most). Useful for recognizing progress or flagging regression."
        ),
        "params": {},
        "function": get_improvement_candidates,
    },
    "get_school_summary": {
        "description": (
            "A compact overview of the entire school: totals (students/classes/exams), "
            "school average, at-risk count, top performer, weakest & strongest subject, "
            "and a per-grade roll-up. Use this first to ground any analysis."
        ),
        "params": {},
        "function": get_school_summary,
    },
}


# ─────────────────────────────────────────────────────────────────────────────
# Chairperson tools — each takes (db, schools, **args) and returns a string
# ─────────────────────────────────────────────────────────────────────────────
def _schools_data(db: Session, schools: list[School],
                  _data: dict | None = None) -> dict[int, dict]:
    """Return pre-computed per-school data dict if provided, else compute."""
    if _data is not None and isinstance(_data, dict) and "per_school" in _data:
        return _data["per_school"]
    # Lazy import to avoid circular
    from app.routers.principal import _gather_school_data
    return {s.id: _gather_school_data(db, s) for s in schools}


def _attendance_rate(data: dict) -> float:
    """School-wide attendance rate from grade rollup."""
    if data["grades"]:
        total = sum(g["students"] for g in data["grades"])
        if total:
            weighted = sum(g["attendance_rate"] * g["students"] for g in data["grades"])
            return round(weighted / total, 1)
    return 0.0


def get_school_comparison(db: Session, schools: list[School],
                          _data: dict | None = None) -> str:
    """Compare all overseen schools side by side."""
    if not schools:
        return "No schools to compare."
    per_school = _schools_data(db, schools, _data)
    rows = []
    for s in schools:
        data = per_school[s.id]
        weak = min(data["subjects"], key=lambda x: x["average"])["name"] if data["subjects"] else "?"
        strong = max(data["subjects"], key=lambda x: x["average"])["name"] if data["subjects"] else "?"
        at_risk = sum(1 for st in data["_student_stats"].values()
                      if st["average"] < 50 or st["attendance_rate"] < 60)
        top = data.get("top_performer") or {}
        rows.append({
            "name": s.name,
            "students": data["total_students"],
            "classes": data["total_classes"],
            "avg": data["school_average"],
            "att": _attendance_rate(data),
            "at_risk": at_risk,
            "top": top.get("name"),
            "top_avg": top.get("average"),
            "weak": weak,
            "strong": strong,
        })
    rows.sort(key=lambda r: r["avg"], reverse=True)
    lines = [f"School comparison across {len(rows)} schools:"]
    for i, r in enumerate(rows, 1):
        lines.append(
            f"{i}. {r['name']} — {r['students']} students · {r['classes']} classes · "
            f"avg {r['avg']}% · attendance {r['att']}% · at-risk {r['at_risk']} · "
            f"top: {r['top']} ({r['top_avg']}%) · "
            f"strongest subj: {r['strong']} · weakest subj: {r['weak']}"
        )
    if len(rows) >= 2:
        lines.append(
            f"Best: {rows[0]['name']} ({rows[0]['avg']}%). "
            f"Needs attention: {rows[-1]['name']} ({rows[-1]['avg']}%, {rows[-1]['at_risk']} at-risk)."
        )
    return "\n".join(lines)


def get_school_details(db: Session, schools: list[School], school_name: str,
                       _data: dict | None = None) -> str:
    """Drill into one school by name — returns that school's full summary."""
    if not school_name:
        return "Error: 'school_name' argument is required."
    target = None
    for s in schools:
        if school_name.strip().lower() in s.name.lower():
            target = s
            break
    if not target:
        names = ", ".join(s.name for s in schools) or "(none)"
        return (f"No school matching '{school_name}' found. "
                f"Overseen schools: {names}.")
    # Delegate to the principal's school summary tool
    per_school = _schools_data(db, schools, _data)
    return get_school_summary(db, target, _data=per_school[target.id])


def get_subject_leadership(db: Session, schools: list[School],
                          _data: dict | None = None) -> str:
    """Which school leads in each subject across the portfolio."""
    if not schools:
        return "No schools to compare."
    per_school = _schools_data(db, schools, _data)
    # Build subject_id -> [(school_name, avg)] across all schools
    subj_map: dict[int, list[tuple[str, float, str]]] = defaultdict(list)
    subj_name: dict[int, str] = {}
    for s in schools:
        data = per_school[s.id]
        for sub in data["subjects"]:
            subj_map[sub["subject_id"]].append((s.name, sub["average"], sub["name"]))
            subj_name[sub["subject_id"]] = sub["name"]
    if not subj_map:
        return "No subject data available across overseen schools."
    lines = [f"Subject leadership across {len(schools)} schools:"]
    for sid in sorted(subj_map.keys()):
        entries = sorted(subj_map[sid], key=lambda x: x[1], reverse=True)
        name = subj_name[sid]
        leader = entries[0]
        worst = entries[-1]
        gap = round(leader[1] - worst[1], 1)
        ranks = ", ".join(f"{n} ({a}%)" for n, a, _ in entries)
        lines.append(
            f"- {name}: leader {leader[0]} ({leader[1]}%) · "
            f"worst {worst[0]} ({worst[1]}%) · gap {gap} pts · "
            f"all: {ranks}"
        )
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# Chairperson TOOLS registry
# ─────────────────────────────────────────────────────────────────────────────
CHAIRPERSON_TOOLS: dict[str, dict] = {
    "get_school_comparison": {
        "description": (
            "Compare all overseen schools side by side — students, classes, "
            "average %, attendance %, at-risk count, top performer, and "
            "strongest/weakest subject for each school, ranked by average."
        ),
        "params": {},
        "function": get_school_comparison,
    },
    "get_school_details": {
        "description": (
            "Drill into one specific school by name. Returns that school's full "
            "summary (totals, average, at-risk count, top performer, weakest/strongest "
            "subject, per-grade roll-up). Use this after get_school_comparison to dig deeper."
        ),
        "params": {"school_name": "string (required) — the school's name (or part of it)"},
        "function": get_school_details,
    },
    "get_subject_leadership": {
        "description": (
            "Show which school leads in each subject across the portfolio, with the "
            "gap between leader and worst. Use this to spot cross-school strengths/weaknesses."
        ),
        "params": {},
        "function": get_subject_leadership,
    },
}
