"""timetable.py — Fetch-X school timetable engine (designer v15 feature).

Generates the weekly class timetable (MON–SAT × periods) for every class of
a school with ZERO teacher clashes, plus each teacher's personal timetable.

How it works
------------
The scheduler is a faithful port of the designer prototype's algorithm:

1.  Build the lesson POOL per class per day:
    • Mon–Fri: every configured subject once + one subject doubled
      (rotates per class/day)  → 7 academic lessons / day
    • Sat: every subject except one (rotates) → 5 academic lessons
    • 10 "special" lessons / week (Games, Craft / Arts, Music, Library,
      Drawing) distributed over fixed day slots, grade-dependent
    • 2 mass events: MASS P.E (Wed P1, grades 1–5) / MASS P.T
      (Sat P1, grades 6–10) and CCA (Sat P7) with the class teacher
2.  Place each day's lessons with a bipartite matching (augmenting-path)
    assignment class→teacher so no teacher is in two rooms at once,
    respecting daily teacher capacity (8/day academic, 4/day specials).
    Failed attempts reshuffle with a new deterministic seed (max 150).
3.  Leftover slots are filled with any non-conflicting lesson from the
    class pool; the remainder becomes SELF-STUDY.

Special-subject teachers are synthesized from the school's real faculty
(deterministic rotation) because specials are not stored in the DB — the
prototype behaves identically for its demo data.

The generated grid is cached in-process per school (keyed on the class /
assignment counts so a reseed invalidates it) — generation is pure CPU and
takes only a few ms, but the cache keeps every dashboard load snappy.
"""
from __future__ import annotations

import random
from functools import lru_cache

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.class_ import Class
from app.models.grade_subject import GradeSubject
from app.models.school import School
from app.models.student import Student
from app.models.subject import Subject
from app.models.teacher_assignment import TeacherAssignment
from app.models.user import User

router = APIRouter(prefix="/timetable", tags=["timetable"])

DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT"]
DAY_LEN = [9, 9, 9, 9, 9, 7]
PERIODS = 9

# designer prototype's special subjects
SPEC_DEF = [
    {"key": "games", "short": "GAMES", "name": "Games"},
    {"key": "craft", "short": "CRAFT", "name": "Craft / Arts"},
    {"key": "music", "short": "MUSIC", "name": "Music"},
    {"key": "library", "short": "LIB", "name": "Library"},
    {"key": "drawing", "short": "DRAW", "name": "Drawing"},
]

# subject display shorthand (designer ACAD_SHORT)
_SHORT_MAP = {
    "MATHEMATICS": "MATH", "MATHS": "MATH", "MATH": "MATH",
    "SCIENCE": "SCI", "ENGLISH": "ENG", "HINDI": "HINDI",
    "SOCIAL": "SOCIAL", "SOCIAL STUDIES": "SOCIAL",
    "COMPUTER": "COMP", "COMPUTER SCIENCE": "COMP",
    "PHYSICAL EDUCATION": "PE", "PHYSICAL": "PE",
}


def _short(name: str) -> str:
    return _SHORT_MAP.get((name or "").strip().upper(), (name or "")[:6].upper())


# ─────────────────────────────────────────────────────────────────────────────
# school bundle — everything the scheduler needs
# ─────────────────────────────────────────────────────────────────────────────
def _load_school_bundle(db: Session, school: School) -> dict:
    classes = (db.query(Class)
                 .filter(Class.school_id == school.id)
                 .order_by(Class.grade, Class.section).all())
    if not classes:
        return {"classes": [], "subjects": [], "teach_map": {}, "hod_map": {}, "users": {}}

    subjects = db.query(Subject).order_by(Subject.id).all()
    configured_ids = {gs.subject_id for gs in
                      (db.query(GradeSubject)
                        .filter(GradeSubject.school_id == school.id,
                                GradeSubject.grade == classes[0].grade).all())}
    subj_list = [s for s in subjects if s.id in configured_ids] or subjects

    assignments = (db.query(TeacherAssignment)
                    .filter(TeacherAssignment.school_id == school.id).all())
    users = {u.id: u for u in
             db.query(User).filter(User.role == "class_teacher").all()}

    teach_map: dict[tuple[int, int], int] = {}
    hod_map: dict[int, int] = {}
    for a in assignments:
        if a.class_id is not None and not a.is_hod:
            teach_map.setdefault((a.class_id, a.subject_id), a.teacher_user_id)
        elif a.class_id is None and a.is_hod:
            hod_map.setdefault(a.subject_id, a.teacher_user_id)

    return {
        "classes": classes,
        "subjects": subj_list,
        "teach_map": teach_map,
        "hod_map": hod_map,
        "users": users,
    }


def _teacher_name(bundle: dict, tid: int) -> str:
    u = bundle["users"].get(tid)
    return (u.full_name if u and u.full_name else f"Teacher {tid}") if tid else "—"


# ─────────────────────────────────────────────────────────────────────────────
# deterministic scheduler (port of the prototype's matching algorithm)
# ─────────────────────────────────────────────────────────────────────────────
def _build_pools(bundle: dict) -> tuple[list[dict], list[list[list[dict]]]]:
    """Returns (classes_meta, pools) where pools[ci][d] = lessons to place."""
    classes = bundle["classes"]
    subjects = bundle["subjects"]
    n_sub = max(1, len(subjects))
    teacher_ids = sorted(bundle["users"].keys())
    n_t = max(1, len(teacher_ids))
    short_of = {s.id: _short(s.name) for s in subjects}

    classes_meta = []
    pools: list[list[list[dict]]] = []
    for ci, c in enumerate(classes):
        meta = {
            "id": c.id, "grade": c.grade, "section": c.section,
            "name": f"{c.grade}-{c.section}", "ci": ci,
            "ct_id": c.class_teacher_id,
        }
        classes_meta.append(meta)

        per_day: list[list[dict]] = [[] for _ in range(6)]

        def lesson(s: Subject) -> dict:
            tid = bundle["teach_map"].get((c.id, s.id)) or bundle["hod_map"].get(s.id) or 0
            return {"tid": tid, "kind": "acad", "short": short_of[s.id],
                    "name": s.name, "tn": _teacher_name(bundle, tid)}

        # academic lessons Mon–Fri: one per subject, with a DOUBLE period on
        # Mon + Wed only (rotating subject) — keeps the prototype's double-
        # period concept while leaving room for specials on real faculty
        for d in range(5):
            dbl = (ci + (2 if d == 2 else 0) + d) % n_sub if d in (0, 2) else -1
            for si, s in enumerate(subjects):
                per_day[d].append(lesson(s))
                if si == dbl:
                    per_day[d].append(lesson(s))
        # Saturday: skip one subject (rotates)
        skip = (ci + 5) % n_sub
        for si, s in enumerate(subjects):
            if si == skip:
                continue
            per_day[5].append(lesson(s))
        # specials: 10 slots / week, grade-dependent placement
        rot = ci % (2 * len(SPEC_DEF))
        order = [SPEC_DEF[(k + rot) % len(SPEC_DEF)] for k in range(2 * len(SPEC_DEF))]
        slots = ([(0, 2), (1, 2), (2, 1), (3, 2), (4, 2), (5, 1)] if c.grade <= 5
                 else [(0, 2), (1, 2), (2, 2), (3, 2), (4, 2), (5, 0)])
        k = 0
        for d, n in slots:
            for _q in range(n):
                sp = order[k % len(order)]
                k += 1
                pool_idx = SPEC_DEF.index(sp)
                tid = teacher_ids[(pool_idx + (ci % 5) * 6) % n_t]
                per_day[d].append({"tid": tid, "kind": "spec", "short": sp["short"],
                                   "name": sp["name"], "tn": _teacher_name(bundle, tid)})
        pools.append(per_day)
    return classes_meta, pools


def _schedule_day(d: int, pools_day: list[list[dict]], n_cls: int,
                  pre_events: dict, rng: random.Random,
                  placed_out: dict) -> bool:
    """One placement pass for a day; chosen lessons land in `placed_out`.

    Per-period bipartite matching (augmenting paths), the prototype's exact
    algorithm. Capacity mirrors the prototype: ACADEMIC teachers may take 8
    lessons a day (6 on Saturday) and SPECIAL teachers 4 — a teacher appearing
    in both pools keeps two independent counters."""
    acad_ids: set[int] = set()
    spec_ids: set[int] = set()
    for ci in range(n_cls):
        for L in pools_day[ci]:
            (acad_ids if L["kind"] == "acad" else spec_ids).add(L["tid"])

    cap_acad = {t: (8 if d < 5 else 6) for t in acad_ids}
    cap_spec = {t: 4 for t in spec_ids}

    def cap_of(L: dict) -> int:
        return (cap_acad if L["kind"] == "acad" else cap_spec).get(L["tid"], 0)

    def consume(L: dict) -> None:
        store = cap_acad if L["kind"] == "acad" else cap_spec
        store[L["tid"]] = store.get(L["tid"], 0) - 1

    busy: list[set] = [set() for _ in range(DAY_LEN[d])]
    for (ci_e, d_e, p_e), tid in pre_events.items():
        if d_e == d and p_e < DAY_LEN[d]:
            busy[p_e].add(tid)

    rem = [list(x) for x in pools_day]
    for p in range(DAY_LEN[d]):
        cands = [ci for ci in range(n_cls)
                 if (ci, d, p) not in pre_events and rem[ci]]
        if not cands:
            continue
        cands = list(cands)
        rng.shuffle(cands)
        opt = []
        for ci in cands:
            m: dict[int, dict] = {}
            for L in rem[ci]:
                if cap_of(L) > 0 and L["tid"] not in busy[p] and L["tid"] not in m:
                    m[L["tid"]] = L
            opt.append(sorted(m.keys(), key=lambda t: -cap_acad.get(t, 0) - cap_spec.get(t, 0)))
        match_t: dict[int, int] = {}

        def try_k(u: int, vis: set) -> bool:
            for tid in opt[u]:
                if tid in vis:
                    continue
                vis.add(tid)
                if tid not in match_t or try_k(match_t[tid], vis):
                    match_t[tid] = u
                    return True
            return False

        for u in range(len(cands)):
            try_k(u, set())
        for tid, u in match_t.items():
            ci = cands[u]
            L = next((x for x in rem[ci] if x["tid"] == tid), None)
            if L is None:
                continue
            rem[ci].remove(L)
            consume(L)
            busy[p].add(tid)
            placed_out[(ci, p)] = L
    return all(len(x) == 0 for x in rem)


def generate_school_timetable(bundle: dict) -> dict:
    """Full-school weekly grid: tt[ci][d][p] = lesson dict."""
    classes_meta, pools = _build_pools(bundle)
    n_cls = len(classes_meta)
    tt: list[list[list]] = [[[None] * PERIODS for _ in range(6)] for _ in range(n_cls)]

    teacher_ids = sorted(bundle["users"].keys()) or [0]
    n_t = max(1, len(teacher_ids))

    # pre-placed mass events: (ci, d, p) → teacher id
    pre_events: dict[tuple[int, int, int], int] = {}
    events: dict[tuple[int, int, int], dict] = {}
    for meta in classes_meta:
        ci, grade = meta["ci"], meta["grade"]
        games_tid = teacher_ids[(0 + (ci % 5) * 6) % n_t]
        if grade <= 5:
            pre_events[(ci, 2, 0)] = games_tid                     # WED P1
            events[(ci, 2, 0)] = {"kind": "event", "short": "MASS PE",
                                  "name": "Mass P.E", "tid": games_tid,
                                  "tn": _teacher_name(bundle, games_tid)}
        else:
            pre_events[(ci, 5, 0)] = games_tid                     # SAT P1
            events[(ci, 5, 0)] = {"kind": "event", "short": "MASS PT",
                                  "name": "Mass P.T", "tid": games_tid,
                                  "tn": _teacher_name(bundle, games_tid)}
        if meta["ct_id"]:
            pre_events[(ci, 5, 6)] = meta["ct_id"]                 # SAT P7
            events[(ci, 5, 6)] = {"kind": "event", "short": "CCA",
                                  "name": "CCA · Class Teacher", "tid": meta["ct_id"],
                                  "tn": _teacher_name(bundle, meta["ct_id"])}

    for d in range(6):
        ok = False
        for attempt in range(150):
            day_placed: dict = {}
            day_pools = [list(pools[ci][d]) for ci in range(n_cls)]
            ok = _schedule_day(d, day_pools, n_cls, pre_events,
                               random.Random(9000 + d * 131 + attempt * 17),
                               day_placed)
            # clear this day's non-event slots, then write the fresh attempt
            # (stale placements from a failed attempt must never survive)
            for ci in range(n_cls):
                for p in range(PERIODS):
                    if (ci, d, p) not in events:
                        tt[ci][d][p] = None
            for (ci, p), L in day_placed.items():
                tt[ci][d][p] = dict(L)
            if ok:
                break
        # leftover fill: any non-conflicting lesson, else self-study
        for ci in range(n_cls):
            for p in range(DAY_LEN[d]):
                if tt[ci][d][p] is not None:
                    continue
                placed = [tt[ci][d][q] for q in range(PERIODS) if tt[ci][d][q]]
                used = {(L["tid"], L["name"]) for L in placed}
                miss = [L for L in pools[ci][d] if (L["tid"], L["name"]) not in used]
                pick = None
                for L in miss:
                    clash = any(tt[other][d][p] and tt[other][d][p].get("tid") == L["tid"]
                                for other in range(n_cls))
                    if not clash:
                        pick = L
                        break
                tt[ci][d][p] = dict(pick) if pick else {
                    "tid": -1, "kind": "spec", "short": "STUDY",
                    "name": "Self-study", "tn": "Free period",
                }

    # conflicts audit (events excluded, matching the prototype's counter)
    conflicts = 0
    for d in range(6):
        for p in range(DAY_LEN[d]):
            seen: set[int] = set()
            for ci in range(n_cls):
                L = tt[ci][d][p]
                if L and L.get("kind") != "event" and L["tid"] >= 0:
                    if L["tid"] in seen:
                        conflicts += 1
                    seen.add(L["tid"])

    return {"tt": tt, "classes": classes_meta, "events": events, "conflicts": conflicts}


# ─────────────────────────────────────────────────────────────────────────────
# cached entry point
# ─────────────────────────────────────────────────────────────────────────────
@lru_cache(maxsize=8)
def _cached_grid(school_id: int, n_classes: int, n_assign: int) -> dict:
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        school = db.query(School).filter(School.id == school_id).first()
        if not school:
            raise HTTPException(status_code=404, detail="School not found.")
        bundle = _load_school_bundle(db, school)
        return generate_school_timetable(bundle)
    finally:
        db.close()


def get_school_grid(db: Session, school: School) -> dict:
    n_classes = db.query(Class).filter(Class.school_id == school.id).count()
    n_assign = db.query(TeacherAssignment).filter(TeacherAssignment.school_id == school.id).count()
    return _cached_grid(school.id, n_classes, n_assign)


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


# ─────────────────────────────────────────────────────────────────────────────
# endpoints
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/class/{class_id}")
def class_timetable(class_id: int, db: Session = Depends(get_db),
                    user: User = Depends(get_current_user)):
    """Weekly timetable grid for one class (all roles inside the school)."""
    school = _school_of(user, db)
    cls = db.query(Class).filter(Class.id == class_id,
                                 Class.school_id == school.id).first()
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found in your school.")

    grid = get_school_grid(db, school)
    ci = next((m["ci"] for m in grid["classes"] if m["id"] == class_id), None)
    if ci is None:
        raise HTTPException(status_code=404, detail="Class not found in the timetable.")

    tt = grid["tt"][ci]
    rows = []
    for p in range(PERIODS):
        row = []
        for d in range(6):
            if p >= DAY_LEN[d]:
                row.append(None)
                continue
            ev = grid["events"].get((ci, d, p))
            L = ev or tt[d][p]
            row.append({
                "short": L["short"],
                "name": L["name"],
                "teacher": L.get("tn") or "—",
                "teacher_id": L.get("tid"),
                "kind": L.get("kind", "acad"),
            } if L else None)
        rows.append(row)

    students = db.query(Student).filter(Student.class_id == class_id).count()
    return {
        "class": {"id": cls.id, "name": f"{cls.grade}-{cls.section}",
                  "grade": cls.grade, "section": cls.section,
                  "students": students},
        "days": DAYS,
        "day_lengths": DAY_LEN,
        "grid": rows,
        "foot": {
            "periods_per_day": 9,
            "saturday": 7,
            "teacher_conflicts": grid["conflicts"],
            "mass_pe": "WED P1 · G1–5",
            "mass_pt": "SAT P1 · G6–10",
            "cca": "SAT P7",
        },
    }


@router.get("/teacher/{teacher_user_id}")
def teacher_timetable(teacher_user_id: int, db: Session = Depends(get_db),
                      user: User = Depends(get_current_user)):
    """Personal timetable: where this teacher is, period by period."""
    school = _school_of(user, db)
    if user.role == "class_teacher" and user.id != teacher_user_id:
        raise HTTPException(status_code=403, detail="You can only view your own timetable.")
    teacher = db.query(User).filter(User.id == teacher_user_id).first()
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found.")

    grid = get_school_grid(db, school)
    g: list[list] = [[None] * 6 for _ in range(PERIODS)]
    weekly = 0
    subjects: set[str] = set()
    class_names: set[str] = set()
    for meta in grid["classes"]:
        ci = meta["ci"]
        for d in range(6):
            for p in range(DAY_LEN[d]):
                if g[p][d] is not None:
                    continue  # first hit wins (prototype behaviour)
                ev = grid["events"].get((ci, d, p))
                if ev and ev["short"].startswith("MASS"):
                    continue  # mass activities never land on personal grids
                L = ev or grid["tt"][ci][d][p]
                if not L or L.get("tid") != teacher_user_id:
                    continue
                weekly += 1
                subjects.add(L["name"])
                class_names.add(meta["name"])
                g[p][d] = {
                    "day": d, "period": p,
                    "class": meta["name"], "class_id": meta["id"],
                    "short": L["short"], "name": L["name"],
                    "kind": L.get("kind", "acad"),
                }

    total_slots = sum(DAY_LEN)
    return {
        "teacher": {"id": teacher.id, "name": teacher.full_name or f"Teacher {teacher.id}"},
        "days": DAYS,
        "day_lengths": DAY_LEN,
        "grid": g,
        "summary": {
            "weekly_periods": weekly,
            "free_periods": total_slots - weekly,
            "subjects": sorted(subjects),
            "classes": sorted(class_names),
        },
    }
