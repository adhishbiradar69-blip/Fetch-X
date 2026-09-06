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


# ─────────────────────────────────────────────────────────────────────────────
# v2 toolset — class drill-downs, rosters, comparisons, charts
# ─────────────────────────────────────────────────────────────────────────────
def _chart(spec: dict) -> str:
    """Wrap a chart payload in the fenced block the frontend renders."""
    import json as _json
    return "```chart\n" + _json.dumps(spec, ensure_ascii=False) + "\n```"


def _class_rows_by_label(data: dict) -> dict[str, dict]:
    return {c["label"].lower(): c for c in data["_class_rows"]}


def _find_class_row(data: dict, label: str) -> Optional[dict]:
    if not label:
        return None
    q = label.strip().lower()
    rows = _class_rows_by_label(data)
    if q in rows:
        return rows[q]
    for k, row in rows.items():
        if q in k:
            return row
    return None


def get_class_detail(db: Session, school: School, label: str,
                     _data: dict | None = None) -> str:
    """Full drill-down for one class (label like '9-Emerald'): averages,
    attendance, subject breakdown, top performers, at-risk students."""
    if not label:
        return "Error: 'label' is required (e.g. '9-Emerald')."
    data = _school_data(db, school, _data)
    row = _find_class_row(data, label)
    if not row:
        avail = ", ".join(sorted(_class_rows_by_label(data).keys())[:12])
        return (f"No class matching '{label}' at {school.name}. "
                f"Examples: {avail} …")
    lines = [
        f"Class {row['label']} at {school.name}:",
        f"- {row['students']} students · class average {row['average']}% · "
        f"attendance {row['attendance_rate']}% · at-risk {row['at_risk_count']}",
    ]
    strong = row.get("strongest_subject") or {}
    weak = row.get("weakest_subject") or {}
    if strong:
        lines.append(f"- Strongest subject: {strong.get('name')} ({strong.get('average')}%) · "
                     f"weakest: {weak.get('name')} ({weak.get('average')}%)")
    sa = row.get("subject_averages") or []
    if sa:
        sub_by_id = data["_subject_by_id"]
        lines.append("- Subject averages:")
        for s in sorted(sa, key=lambda x: -(x["average"] or 0)):
            sub = sub_by_id.get(s["subject_id"])
            lines.append(f"  · {sub.name if sub else '?'}: {s['average']}%")
    # top 5 + at-risk names from the student stats
    mates = [st for st in data["_student_stats"].values()
             if st.get("class_label") == row["label"]]
    mates.sort(key=lambda x: x["average"], reverse=True)
    if mates:
        lines.append("- Top students: " + "; ".join(
            f"{m['name']} ({m['average']}%)" for m in mates[:5]))
    risky = [m for m in mates if m["average"] < 50 or m["attendance_rate"] < 60]
    if risky:
        lines.append("- At-risk: " + "; ".join(
            f"{m['name']} (avg {m['average']}%, att {m['attendance_rate']}%)"
            for m in risky[:8]))
    return "\n".join(lines)


def get_class_roster(db: Session, school: School, label: str, limit: int = 15,
                     _data: dict | None = None) -> str:
    """Ranked roster (best → worst) for one class with averages + attendance."""
    try:
        limit = max(1, min(int(limit), 40))
    except (TypeError, ValueError):
        limit = 15
    data = _school_data(db, school, _data)
    row = _find_class_row(data, label)
    if not row:
        return f"No class matching '{label}' at {school.name}."
    mates = [st for st in data["_student_stats"].values()
             if st.get("class_label") == row["label"]]
    mates.sort(key=lambda x: x["average"], reverse=True)
    lines = [f"Roster of {row['label']} ({len(mates)} students, ranked):"]
    for m in mates[:limit]:
        lines.append(f"- {m['name']} — avg {m['average']}% · att {m['attendance_rate']}% "
                     f"(rank {m.get('rank_in_class')}/{m.get('class_size')})")
    if len(mates) > limit:
        lines.append(f"… and {len(mates) - limit} more.")
    return "\n".join(lines)


def get_class_at_risk(db: Session, school: School, label: str, limit: int = 10,
                      _data: dict | None = None) -> str:
    """At-risk students inside one class with reasons."""
    try:
        limit = max(1, min(int(limit), 30))
    except (TypeError, ValueError):
        limit = 10
    data = _school_data(db, school, _data)
    row = _find_class_row(data, label)
    if not row:
        return f"No class matching '{label}' at {school.name}."
    mates = [st for st in data["_student_stats"].values()
             if st.get("class_label") == row["label"]
             and (st["average"] < 50 or st["attendance_rate"] < 60)]
    mates.sort(key=lambda x: x["average"])
    if not mates:
        return f"No at-risk students in {row['label']} 🎉"
    lines = [f"At-risk students in {row['label']}: ({len(mates)})"]
    for m in mates[:limit]:
        weak = m.get("weakest_subject") or {}
        lines.append(f"- {m['name']} — avg {m['average']}% · att {m['attendance_rate']}% · "
                     f"weakest {weak.get('name', '?')} ({weak.get('average', '?')}%)")
    return "\n".join(lines)


def get_students_by_band(db: Session, school: School, min_avg: int = 80,
                         max_avg: int = 100, limit: int = 15,
                         _data: dict | None = None) -> str:
    """Students whose all-term average falls in [min_avg, max_avg]."""
    try:
        lo, hi = int(min_avg), int(max_avg)
    except (TypeError, ValueError):
        lo, hi = 80, 100
    try:
        limit = max(1, min(int(limit), 40))
    except (TypeError, ValueError):
        limit = 15
    data = _school_data(db, school, _data)
    picked = [st for st in data["_student_stats"].values() if lo <= st["average"] <= hi]
    picked.sort(key=lambda x: x["average"], reverse=True)
    if not picked:
        return f"No students with average between {lo}% and {hi}% at {school.name}."
    lines = [f"{len(picked)} students average {lo}–{hi}% at {school.name} (top {min(limit, len(picked))}):"]
    for m in picked[:limit]:
        lines.append(f"- {m['name']} ({m['class_label']}) — {m['average']}% · "
                     f"att {m['attendance_rate']}%")
    return "\n".join(lines)


def compare_students(db: Session, school: School, names: str,
                     _data: dict | None = None) -> str:
    """Side-by-side comparison of 2–3 students (comma-separated names):
    averages, ranks, attendance, best/worst subjects, improvement."""
    if not names:
        return "Error: 'names' is required — comma-separated, e.g. 'Ananya, Ira Reddy'."
    data = _school_data(db, school, _data)
    stats = data["_student_stats"]
    picked = []
    for part in str(names).split(","):
        q = part.strip()
        if not q:
            continue
        match = next((st for st in stats.values()
                      if st["name"].lower() == q.lower()), None)
        if match is None:
            match = next((st for st in stats.values()
                          if q.lower() in st["name"].lower()), None)
        if match:
            picked.append(match)
    if len(picked) < 2:
        return ("Need at least 2 matching students. Found: "
                + (", ".join(p["name"] for p in picked) or "none")
                + ". Use get_student_details for fuzzy single lookups.")
    lines = [f"Comparing {len(picked)} students:"]
    keys = [("Average", lambda s: f"{s['average']}%"),
            ("Class", lambda s: s["class_label"]),
            ("Rank in class", lambda s: f"{s.get('rank_in_class')}/{s.get('class_size')}"),
            ("Attendance", lambda s: f"{s['attendance_rate']}%"),
            ("Strongest", lambda s: f"{(s.get('strongest_subject') or {}).get('name', '?')} "
                                    f"({(s.get('strongest_subject') or {}).get('average', '?')}%)"),
            ("Weakest", lambda s: f"{(s.get('weakest_subject') or {}).get('name', '?')} "
                                  f"({(s.get('weakest_subject') or {}).get('average', '?')}%)"),
            ("Trend", lambda s: (f"{s['first_exam_average']}% → {s['last_exam_average']}% "
                                 f"({s['improvement_delta']:+}%)"
                                 if s.get("improvement_delta") is not None else "n/a"))]
    for label, fn in keys:
        lines.append(f"- {label}: " + " | ".join(f"{p['name']}: {fn(p)}" for p in picked))
    best = max(picked, key=lambda s: s["average"])
    lines.append(f"Overall strongest: {best['name']} ({best['average']}%).")
    return "\n".join(lines)


def get_teacher_report(db: Session, school: School, teacher_name: str,
                       _data: dict | None = None) -> str:
    """One teacher's teaching load: classes + subjects handled, and each
    class's average. Timetable-only extra teachers are NOT included."""
    if not teacher_name:
        return "Error: 'teacher_name' is required."
    from app.models.teacher_assignment import TeacherAssignment
    from app.models.user import User as _User
    data = _school_data(db, school, _data)
    q = teacher_name.strip().lower()
    matches = (db.query(_User)
                 .filter(_User.school_id == school.id,
                         _User.role == "class_teacher",
                         _User.full_name.ilike(f"%{q}%"))
                 .all())
    if not matches:
        return f"No teacher matching '{teacher_name}' at {school.name}."
    class_objs = {c.id: c for c in data["_classes"]}
    sub_by_id = data["_subject_by_id"]
    lines = [f"Teaching report for '{teacher_name}' at {school.name}:"]
    for u in matches[:3]:
        assigns = (db.query(TeacherAssignment)
                     .filter(TeacherAssignment.school_id == school.id,
                             TeacherAssignment.teacher_user_id == u.id)
                     .all())
        teaching, hods = [], []
        for a in assigns:
            sub = sub_by_id.get(a.subject_id)
            if a.class_id is not None and not a.is_hod and sub:
                cls = class_objs.get(a.class_id)
                if cls:
                    crow = _find_class_row(data, f"{cls.grade}-{cls.section}")
                    avg = crow["average"] if crow else "?"
                    teaching.append(f"{cls.grade}-{cls.section} — {sub.name} "
                                    f"(class avg {avg}%)")
            elif a.is_hod and a.class_id is None and sub:
                hods.append(sub.name)
        if not teaching and not hods:
            lines.append(f"- {u.full_name}: no teaching assignments recorded.")
            continue
        lines.append(f"- {u.full_name}:")
        lines.extend(f"  · {t}" for t in teaching)
        if hods:
            lines.append(f"  · HOD of: {', '.join(hods)}")
    return "\n".join(lines)


def get_attendance_summary(db: Session, school: School,
                           _data: dict | None = None) -> str:
    """School attendance overview: overall rate, best/worst classes,
    chronic absentees count."""
    data = _school_data(db, school, _data)
    stats = list(data["_student_stats"].values())
    if not stats:
        return f"No attendance data at {school.name}."
    overall = round(sum(s["attendance_rate"] for s in stats) / len(stats), 1)
    by_class: dict[str, list[float]] = {}
    for s in stats:
        by_class.setdefault(s["class_label"], []).append(s["attendance_rate"])
    class_avg = sorted(((k, round(sum(v) / len(v), 1)) for k, v in by_class.items()),
                       key=lambda x: x[1])
    chronic = [s for s in stats if s["attendance_rate"] < 60]
    lines = [
        f"Attendance overview at {school.name}:",
        f"- School-wide average: {overall}%",
        f"- Chronic absentees (<60%): {len(chronic)} students",
    ]
    if class_avg:
        worst = class_avg[:3]
        best = class_avg[-3:][::-1]
        lines.append("- Lowest-attendance classes: "
                     + ", ".join(f"{k} ({v}%)" for k, v in worst))
        lines.append("- Best-attendance classes: "
                     + ", ".join(f"{k} ({v}%)" for k, v in best))
    return "\n".join(lines)


def get_task_completion_stats(db: Session, school: School,
                              _data: dict | None = None) -> str:
    """Task-completion percentage per class — completed / (completed +
    pending), the exact same semantics as /principal/tasks/stats."""
    from app.models.task import Task, TaskCompletion
    data = _school_data(db, school, _data)
    class_objs = data["_classes"]
    if not class_objs:
        return f"No classes at {school.name}."
    rows = (db.query(TaskCompletion.status, Task.class_id)
              .join(Task, TaskCompletion.task_id == Task.id)
              .join(Class, Task.class_id == Class.id)
              .filter(Class.school_id == school.id)
              .all())
    if not rows:
        return f"No tasks recorded at {school.name}."
    acc: dict[int, dict[str, int]] = {}
    for status, cid in rows:
        b = acc.setdefault(cid, {"completed": 0, "pending": 0})
        if status == "completed":
            b["completed"] += 1
        else:
            b["pending"] += 1
    out = []
    name_of = {c.id: f"{c.grade}-{c.section}" for c in class_objs}
    for cid, b in acc.items():
        total = b["completed"] + b["pending"]
        if total:
            out.append((name_of.get(cid, f"#{cid}"),
                        round(b["completed"] / total * 100, 1)))
    if not out:
        return f"No task data recorded at {school.name}."
    out.sort(key=lambda x: x[1])
    lines = [f"Task completion at {school.name} (low → high):"]
    lines.extend(f"- {label}: {pct}%" for label, pct in out)
    return "\n".join(lines)


def get_grade_summary(db: Session, school: School, grade: int,
                      _data: dict | None = None) -> str:
    """One grade's roll-up: average, attendance, per-subject averages, top."""
    try:
        grade = int(grade)
    except (TypeError, ValueError):
        return f"Error: 'grade' must be an integer (got {grade!r})."
    data = _school_data(db, school, _data)
    grow = next((g for g in data["grades"] if g["grade"] == grade), None)
    if not grow:
        return f"No data for grade {grade} at {school.name}."
    sub_by_id = data["_subject_by_id"]
    lines = [
        f"Grade {grade} at {school.name}: {grow['students']} students · "
        f"{grow['classes']} sections · avg {grow['average']}% · "
        f"attendance {grow['attendance_rate']}%",
    ]
    sa = sorted(grow.get("subject_averages") or [],
                key=lambda x: -(x["average"] or 0))
    if sa:
        lines.append("- Subject averages: " + ", ".join(
            f"{(sub_by_id.get(s['subject_id']).name if sub_by_id.get(s['subject_id']) else '?')}: "
            f"{s['average']}%" for s in sa))
    mates = [st for st in data["_student_stats"].values() if st["grade"] == grade]
    if mates:
        top = max(mates, key=lambda x: x["average"])
        lines.append(f"- Top student: {top['name']} ({top['average']}%, {top['class_label']})")
        risky = sum(1 for m in mates if m["average"] < 50 or m["attendance_rate"] < 60)
        lines.append(f"- At-risk: {risky} of {len(mates)} students")
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# chart tools — return ready-to-render ```chart payloads
# ─────────────────────────────────────────────────────────────────────────────
def visualize_subject_averages(db: Session, school: School,
                               _data: dict | None = None) -> str:
    """Bar chart of every subject's school-wide average."""
    data = _school_data(db, school, _data)
    items = [{"label": s["name"], "val": s["average"]}
             for s in sorted(data["subjects"], key=lambda x: -x["average"])]
    if not items:
        return f"No subject data at {school.name}."
    return _chart({"type": "bar", "title": f"Subject averages — {school.name}",
                   "items": items})


def visualize_score_distribution(db: Session, school: School,
                                 _data: dict | None = None) -> str:
    """Distribution of students across score bands."""
    data = _school_data(db, school, _data)
    bands = {"<60": 0, "60-69": 0, "70-79": 0, "80-89": 0, "90-100": 0}
    for st in data["_student_stats"].values():
        a = st["average"]
        if a < 60:
            bands["<60"] += 1
        elif a < 70:
            bands["60-69"] += 1
        elif a < 80:
            bands["70-79"] += 1
        elif a < 90:
            bands["80-89"] += 1
        else:
            bands["90-100"] += 1
    total = sum(bands.values())
    return _chart({"type": "distro", "title": f"Score distribution — {school.name}",
                   "bands": [{"band": b, "count": n} for b, n in bands.items()],
                   "total": total})


def visualize_term_trends(db: Session, school: School, grade: Optional[int] = None) -> str:
    """Bar chart of average score per term (whole school or one grade)."""
    from sqlalchemy import case as sa_case
    from app.models.class_ import Class as _Cls
    q = (db.query(Exam.term,
                  func_avg_mark())
           .join(Mark, Mark.exam_id == Exam.id)
           .join(Student, Mark.student_id == Student.id)
           .join(_Cls, Student.class_id == _Cls.id)
           .filter(_Cls.school_id == school.id))
    if grade is not None:
        try:
            q = q.filter(_Cls.grade == int(grade))
        except (TypeError, ValueError):
            pass
    rows = q.group_by(Exam.term).all()
    if not rows:
        return f"No exam data at {school.name}."
    order = {"Term 1": 1, "Term 2": 2, "Term 3": 3}
    items = [{"label": r[0] or "?", "val": round(float(r[1] or 0), 1)} for r in rows]
    items.sort(key=lambda x: order.get(x["label"], 9))
    title = f"Term averages — {'grade ' + str(grade) if grade else school.name}"
    return _chart({"type": "bar", "title": title, "items": items})


def func_avg_mark():
    from sqlalchemy import func
    return func.avg(Mark.score)


def visualize_class_comparison(db: Session, school: School, grade: int,
                               _data: dict | None = None) -> str:
    """Bar chart comparing every section of one grade."""
    try:
        grade = int(grade)
    except (TypeError, ValueError):
        return f"Error: 'grade' must be an integer (got {grade!r})."
    data = _school_data(db, school, _data)
    rows = sorted((c for c in data["_class_rows"] if c["grade"] == grade),
                  key=lambda c: c["section"])
    if not rows:
        return f"No classes in grade {grade} at {school.name}."
    items = [{"label": c["label"], "val": c["average"]} for c in rows]
    return _chart({"type": "bar",
                   "title": f"Class comparison — Grade {grade}, {school.name}",
                   "items": items})


def visualize_attendance_trend(db: Session, school: School, days: int = 90) -> str:
    """Line chart of the school's daily attendance rate."""
    from datetime import date, timedelta
    from sqlalchemy import case as sa_case
    from app.models.class_ import Class as _Cls
    try:
        days = max(14, min(int(days), 180))
    except (TypeError, ValueError):
        days = 90
    start = date.today() - timedelta(days=days - 1)
    rows = (db.query(Attendance.date,
                     func_count_att(),
                     func_present())
              .join(Student, Attendance.student_id == Student.id)
              .join(_Cls, Student.class_id == _Cls.id)
              .filter(_Cls.school_id == school.id,
                      Attendance.date >= start)
              .group_by(Attendance.date)
              .order_by(Attendance.date)
              .all())
    if not rows:
        return f"No attendance records in the last {days} days at {school.name}."
    points = [{"date": r[0].isoformat() if hasattr(r[0], "isoformat") else str(r[0]),
               "pct": round((r[2] or 0) / r[1] * 100, 1)}
              for r in rows]
    return _chart({"type": "line",
                   "title": f"Attendance trend (last {days} days) — {school.name}",
                   "points": points})


def func_count_att():
    from sqlalchemy import func
    return func.count(Attendance.id)


def func_present():
    from sqlalchemy import case
    return func.sum(case((Attendance.status == "P", 1), else_=0))


# Register the v2 tools on the principal registry.
TOOLS.update({
    "get_class_detail": {
        "description": ("Full drill-down for ONE class (label like '9-Emerald'): size, "
                        "average, attendance, subject-by-subject averages, top students, "
                        "at-risk students."),
        "params": {"label": "string (required) — class label, e.g. '9-Emerald'"},
        "function": get_class_detail,
    },
    "get_class_roster": {
        "description": ("Ranked roster of one class (best → worst) with averages and "
                        "attendance. Use after get_class_detail when the user asks 'who "
                        "is in…' or 'list the students of…'."),
        "params": {"label": "string (required) — class label",
                   "limit": "integer (optional, default 15)"},
        "function": get_class_roster,
    },
    "get_class_at_risk": {
        "description": ("At-risk students inside ONE class with averages, attendance "
                        "and weakest subjects."),
        "params": {"label": "string (required) — class label",
                   "limit": "integer (optional, default 10)"},
        "function": get_class_at_risk,
    },
    "get_students_by_band": {
        "description": ("Students whose all-term average falls inside a score band, "
                        "e.g. 80–100 for toppers in a range or 35–50 for strugglers."),
        "params": {"min_avg": "integer (optional, default 80)",
                   "max_avg": "integer (optional, default 100)",
                   "limit": "integer (optional, default 15)"},
        "function": get_students_by_band,
    },
    "compare_students": {
        "description": ("Side-by-side comparison of 2–3 students (comma-separated): "
                        "averages, ranks, attendance, strongest/weakest subjects, trend."),
        "params": {"names": "string (required) — e.g. 'Ananya, Ira Reddy'"},
        "function": compare_students,
    },
    "get_teacher_report": {
        "description": ("One teacher's load: classes + subjects taught and each class's "
                        "average; also shows HOD roles. Does NOT include timetable-only "
                        "subject teachers."),
        "params": {"teacher_name": "string (required) — part or all of the name"},
        "function": get_teacher_report,
    },
    "get_attendance_summary": {
        "description": ("School attendance overview: overall rate, chronic absentees, "
                        "lowest- and best-attendance classes."),
        "params": {},
        "function": get_attendance_summary,
    },
    "get_task_completion_stats": {
        "description": ("Average task-completion percentage per class, lowest first. "
                        "Use for homework/task questions."),
        "params": {},
        "function": get_task_completion_stats,
    },
    "get_grade_summary": {
        "description": ("One grade's roll-up: students, sections, average, attendance, "
                        "per-subject averages, top student, at-risk count."),
        "params": {"grade": "integer (required)"},
        "function": get_grade_summary,
    },
    "visualize_subject_averages": {
        "description": ("Returns a bar CHART of every subject's school-wide average. "
                        "Copy the returned ```chart block verbatim into your answer."),
        "params": {},
        "function": visualize_subject_averages,
    },
    "visualize_score_distribution": {
        "description": ("Returns a CHART of how many students fall in each score band "
                        "(<60, 60s, 70s, 80s, 90+). Copy the ```chart block verbatim."),
        "params": {},
        "function": visualize_score_distribution,
    },
    "visualize_term_trends": {
        "description": ("Returns a bar CHART of average score per term (school-wide or "
                        "for one grade) — perfect for 'are we improving term over term?'. "
                        "Copy the ```chart block verbatim."),
        "params": {"grade": "integer (optional) — restrict to one grade"},
        "function": visualize_term_trends,
    },
    "visualize_class_comparison": {
        "description": ("Returns a bar CHART comparing every section of one grade by "
                        "average. Copy the ```chart block verbatim."),
        "params": {"grade": "integer (required)"},
        "function": visualize_class_comparison,
    },
    "visualize_attendance_trend": {
        "description": ("Returns a line CHART of the school's daily attendance rate for "
                        "the last N days (default 90). Copy the ```chart block verbatim."),
        "params": {"days": "integer (optional, default 90)"},
        "function": visualize_attendance_trend,
    },
})
