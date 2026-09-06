"""timetable.py — Fetch-X school timetable engine v2.

Generates the weekly class timetable (MON–SAT × 9 periods) for every class
of a school with ZERO teacher clashes, plus each teacher's personal grid.

v2 rules (product spec)
-----------------------
• 9 periods every day. Per class per day: **7 academic + 2 activity**
  periods (Games / SUPW / Drawing / Library / Music / Craft, rotating).
• Weekly academic demand comes from REAL data: every (class × subject)
  gets a weekly quota derived from TeacherAssignment + GradeSubject with
  core-subject weighting; subjects with quota > 6 spread their extra
  lessons as planned double periods on different days.
• Every teacher is packed toward **7 taught / ~2 free periods per day**
  (average 2, zero allowed, hard daily cap). Teacher capacity is derived
  entirely from the live pool — the algorithm is fully variable in the
  number of teachers/classes.
• **Subject teachers** (ExtraTeacher rows — timetable-only staff with no
  user account) cover (class, subject) pairs the regular faculty can't,
  and activity periods when an activity-tagged extra exists; otherwise
  activities fall to the class teacher. Whatever still can't be placed
  becomes SELF-STUDY and is reported.

Algorithm
---------
1.  Demand: per class, split each subject's weekly quota across the 6 days
    (round-robin with a per-class offset) → per-day pools totalling 7
    academic lessons/day, + 2 activity lessons/day.
2.  Placement (per day): period-by-period bipartite matching (augmenting
    paths) class→teacher — teachers ordered by least daily load first so
    the ~2-free-periods rule emerges from the packing itself. Any class
    that can't match keeps its slot for the greedy fill pass; the rest
    become self-study.
3.  Repair: a bounded min-conflicts pass swaps self-study slots with
    placeable lessons from other slots (same class, both teachers free).
4.  Deterministic: seeded RNG per day/attempt. The grid is cached per
    school, keyed on classes + assignments + extra-teacher fingerprint.
"""
from __future__ import annotations

import random
from functools import lru_cache
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, require_school_admin
from app.models.class_ import Class
from app.models.extra_teacher import ExtraTeacher
from app.models.grade_subject import GradeSubject
from app.models.school import School
from app.models.student import Student
from app.models.subject import Subject
from app.models.teacher_assignment import TeacherAssignment
from app.models.user import User

router = APIRouter(prefix="/timetable", tags=["timetable"])

DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT"]
DAY_LEN = [9, 9, 9, 9, 9, 9]          # v2: 9 periods every day
PERIODS = 9
ACAD_PER_DAY = 7                       # 7 academic + 2 activity = 9
WEEK_ACADEMIC = ACAD_PER_DAY * 6       # 42 lessons / class / week
TEACHER_DAILY_MAX = 7                  # ⇒ ~2 free periods / day (spec)
MAX_ATTEMPTS = 150
REPAIR_BUDGET = 4000

# activity periods — the class's 2 non-academic periods each day
ACTIVITY_DEFS = [
    {"key": "games", "short": "GAMES", "name": "Games"},
    {"key": "supw", "short": "SUPW", "name": "SUPW"},
    {"key": "drawing", "short": "DRAW", "name": "Drawing"},
    {"key": "library", "short": "LIB", "name": "Library"},
    {"key": "music", "short": "MUSIC", "name": "Music"},
    {"key": "craft", "short": "CRAFT", "name": "Craft"},
]
ACTIVITY_KEYS = [a["key"] for a in ACTIVITY_DEFS]

# weekly academic weighting — core subjects carry a little more load.
def _subject_weight(name: str) -> float:
    n = (name or "").upper()
    if "MATH" in n:
        return 8.0
    if "SCIENCE" in n:
        return 8.0
    if "ENGLISH" in n:
        return 8.0
    if "SOCIAL" in n:
        return 7.0
    if "COMPUTER" in n:
        return 7.0
    if "PHYSICAL" in n or n == "PE":
        return 6.0
    return 7.0


def _short(name: str) -> str:
    m = {
        "MATHEMATICS": "MATH", "MATHS": "MATH", "MATH": "MATH",
        "SCIENCE": "SCI", "ENGLISH": "ENG", "HINDI": "HINDI",
        "SOCIAL": "SOCIAL", "SOCIAL STUDIES": "SOCIAL",
        "COMPUTER": "COMP", "COMPUTER SCIENCE": "COMP",
        "PHYSICAL EDUCATION": "PE", "PHYSICAL": "PE",
    }
    return m.get((name or "").strip().upper(), (name or "")[:6].upper())


# ─────────────────────────────────────────────────────────────────────────────
# school bundle — everything the scheduler needs
# ─────────────────────────────────────────────────────────────────────────────
def _load_school_bundle(db: Session, school: School) -> dict:
    classes = (db.query(Class)
                 .filter(Class.school_id == school.id)
                 .order_by(Class.grade, Class.section).all())
    if not classes:
        return {"classes": [], "subjects": [], "teach_map": {}, "hod_map": {},
                "users": {}, "extras": []}

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

    extras = (db.query(ExtraTeacher)
                .filter(ExtraTeacher.school_id == school.id)
                .order_by(ExtraTeacher.id).all())

    return {
        "classes": classes,
        "subjects": subj_list,
        "teach_map": teach_map,
        "hod_map": hod_map,
        "users": users,
        "extras": extras,
    }


def _extra_name(bundle: dict, tid: int) -> str:
    """Resolve a negative (extra-teacher) id to a display name."""
    xid = -tid
    for x in bundle.get("extras", []):
        if x.id == xid:
            return x.name
    return f"Subject teacher {xid}"


def _teacher_name(bundle: dict, tid: int) -> str:
    if tid is None or tid == 0:
        return "—"
    if tid < 0:
        return _extra_name(bundle, tid)
    u = bundle["users"].get(tid)
    return (u.full_name if u and u.full_name else f"Teacher {tid}")


def _acad_teacher_for(bundle: dict, cls, subject) -> Optional[int]:
    """Real faculty for a (class, subject): the assigned teacher, else the
    subject's HOD, else an extra subject teacher, else None."""
    tid = bundle["teach_map"].get((cls.id, subject.id))
    if tid:
        return tid
    tid = bundle["hod_map"].get(subject.id)
    if tid:
        return tid
    for x in bundle.get("extras", []):
        if x.subject_id == subject.id:
            return -x.id
    return None


def _activity_teacher_for(bundle: dict, cls, activity_key: str) -> Optional[int]:
    """Activities never consume academic-teacher capacity (that's what keeps
    the ~2-free-periods rule feasible): an activity-tagged subject teacher
    leads them when one exists, otherwise the period runs unsupervised."""
    for x in bundle.get("extras", []):
        if (x.activity or "") == activity_key:
            return -x.id
    return None


# ─────────────────────────────────────────────────────────────────────────────
# demand — weekly quotas → per-class per-day lesson pools
# ─────────────────────────────────────────────────────────────────────────────
def _weekly_quotas(bundle: dict, cls) -> dict[int, int]:
    """Subject id → lessons per week for this class (weights normalised so
    the class's academic week sums to exactly WEEK_ACADEMIC)."""
    weights = {s.id: _subject_weight(s.name) for s in bundle["subjects"]}
    total_w = sum(weights.values()) or 1.0
    raw = {sid: w / total_w * WEEK_ACADEMIC for sid, w in weights.items()}
    quotas = {sid: int(v) for sid, v in raw.items()}
    # distribute the rounding remainder to the largest fractional parts
    order = sorted(raw, key=lambda sid: raw[sid] - quotas[sid], reverse=True)
    i = 0
    while sum(quotas.values()) < WEEK_ACADEMIC and order:
        quotas[order[i % len(order)]] += 1
        i += 1
    while sum(quotas.values()) > WEEK_ACADEMIC and order:
        sid = order[i % len(order)]
        if quotas[sid] > 1:
            quotas[sid] -= 1
        i += 1
    return quotas


def _split_week_over_days(quota: int, days: int, offset: int) -> list[int]:
    """Spread `quota` lessons over `days` as evenly as possible; a day may
    get 2 (a planned double period) but never 3+."""
    base, rem = divmod(quota, days)
    counts = [base] * days
    i = 0
    while rem > 0:
        idx = (offset + i) % days
        if counts[idx] < base + 2:      # avoid triple periods on one day
            counts[idx] += 1
            rem -= 1
        i += 1
    return counts


def _build_pools(bundle: dict) -> tuple[list[dict], list[list[list[dict]]]]:
    """Returns (classes_meta, pools): pools[ci][d] = that day's lessons
    (7 academic + 2 activity), already carrying their teacher."""
    classes = bundle["classes"]
    subjects = bundle["subjects"]
    short_of = {s.id: _short(s.name) for s in subjects}

    classes_meta = []
    pools: list[list[list[dict]]] = []
    for ci, c in enumerate(classes):
        meta = {"id": c.id, "grade": c.grade, "section": c.section,
                "name": f"{c.grade}-{c.section}", "ci": ci,
                "ct_id": c.class_teacher_id}
        classes_meta.append(meta)

        quotas = _weekly_quotas(bundle, c)
        # subject → per-day counts (offset by class index so parallel
        # sections don't all put Mathematics first on Monday)
        per_day_counts: list[dict[int, int]] = [dict() for _ in range(6)]
        for si, s in enumerate(subjects):
            q = quotas.get(s.id, 0)
            if q <= 0:
                continue
            counts = _split_week_over_days(q, 6, offset=ci + si)
            for d, n in enumerate(counts):
                if n:
                    per_day_counts[d][s.id] = n

        # rebalance so every day lands on exactly ACAD_PER_DAY academic
        # lessons: move single lessons from heavy days to light days
        for _pass in range(12):
            loads = [sum(d.values()) for d in per_day_counts]
            hi = max(range(6), key=lambda d: loads[d])
            lo = min(range(6), key=lambda d: loads[d])
            if loads[hi] - loads[lo] <= 1:
                break
            movable = [(sid, n) for sid, n in per_day_counts[hi].items() if n >= 1]
            if not movable:
                break
            sid = movable[0][0]
            per_day_counts[hi][sid] -= 1
            if per_day_counts[hi][sid] == 0:
                del per_day_counts[hi][sid]
            per_day_counts[lo][sid] = per_day_counts[lo].get(sid, 0) + 1

        def acad_lesson(s: Subject, tid: Optional[int]) -> dict:
            return {"tid": tid or 0, "kind": "acad", "short": short_of[s.id],
                    "name": s.name, "tn": _teacher_name(bundle, tid),
                    "unassigned": tid is None}

        day_pools: list[list[dict]] = []
        for d in range(6):
            day: list[dict] = []
            for s in subjects:
                n = per_day_counts[d].get(s.id, 0)
                tid = _acad_teacher_for(bundle, c, s)
                for _ in range(n):
                    day.append(acad_lesson(s, tid))
            # 2 activity periods (9 − academic count), rotating mix
            act_n = max(0, DAY_LEN[d] - len(day))
            for k in range(act_n):
                act = ACTIVITY_DEFS[(ci + d + k * 3) % len(ACTIVITY_DEFS)]
                tid = _activity_teacher_for(bundle, c, act["key"])
                day.append({"tid": tid or 0, "kind": "act", "short": act["short"],
                            "name": act["name"], "tn": _teacher_name(bundle, tid),
                            "unassigned": tid is None})
            day_pools.append(day)
        pools.append(day_pools)
    return classes_meta, pools


# ─────────────────────────────────────────────────────────────────────────────
# placement — one day at a time, bipartite matching per period
# ─────────────────────────────────────────────────────────────────────────────
def _schedule_day(bundle: dict, d: int, pools_day: list[list[dict]], n_cls: int,
                  pre_events: dict, rng: random.Random,
                  placed_out: dict, load_day: dict) -> bool:
    """Place every class's lessons for one day.

    Per period: bipartite match classes → (lesson, teacher). Candidate
    teachers for a class are the teachers of its remaining lessons, ordered
    by least daily load (the ~2-free-periods packing) — real teachers before
    extras for the same subject. `load_day[t]` tracks taught count so far.
    """
    for t in list(load_day.keys()):
        load_day[t] = 0

    busy: list[set] = [set() for _ in range(DAY_LEN[d])]
    for (ci_e, d_e, p_e), tid in pre_events.items():
        if d_e == d and p_e < DAY_LEN[d]:
            busy[p_e].add(tid)
            load_day[tid] = load_day.get(tid, 0) + 1

    def cap_of(L: dict) -> int:
        tid = L["tid"]
        if tid == 0:
            # unsupervised activity / unstaffed subject — no teacher load
            return 99 if L["kind"] == "act" else 0
        for x in bundle.get("extras", []):
            if -x.id == tid:
                return max(1, x.max_daily)
        return TEACHER_DAILY_MAX

    def cap_left(L: dict) -> int:
        return cap_of(L) - load_day.get(L["tid"], 0)

    rem = [list(x) for x in pools_day]
    for p in range(DAY_LEN[d]):
        cands = [ci for ci in range(n_cls)
                 if (ci, d, p) not in pre_events and rem[ci]]
        if not cands:
            continue
        cands = list(cands)
        rng.shuffle(cands)
        opt: list[list[int]] = []
        lesson_of: dict[int, dict] = {}   # per class: tid → chosen lesson
        for ci in cands:
            seen: dict[int, dict] = {}
            # real teacher first, then extras, then unassigned-capable
            rem[ci].sort(key=lambda L: (
                0 if L["tid"] > 0 else (1 if L["tid"] < 0 else 2),
                L["tid"]))
            for L in rem[ci]:
                # tid 0 = unsupervised activity — no teacher, never clashes
                if L["tid"] == 0 or (cap_left(L) > 0 and L["tid"] not in busy[p]
                                     and L["tid"] not in seen):
                    seen[L["tid"]] = L
            order = sorted(seen.keys(),
                           key=lambda t: (load_day.get(t, 0), t))
            opt.append(order)
            lesson_of[ci] = seen
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
        placed_ci = set()
        for tid, u in match_t.items():
            ci = cands[u]
            L = lesson_of[ci].get(tid)
            if L is None:
                continue
            rem[ci].remove(L)
            busy[p].add(tid)
            load_day[tid] = load_day.get(tid, 0) + 1
            placed_out[(ci, p)] = L
            placed_ci.add(ci)
        # greedy fill for classes the matching couldn't place
        for ci in cands:
            if ci in placed_ci or not rem[ci]:
                continue
            pick = None
            for L in rem[ci]:
                if L["tid"] == 0 or (cap_left(L) > 0 and L["tid"] not in busy[p]):
                    pick = L
                    break
            if pick is not None:
                rem[ci].remove(pick)
                busy[p].add(pick["tid"])
                load_day[pick["tid"]] = load_day.get(pick["tid"], 0) + 1
                placed_out[(ci, p)] = pick
    return all(not x for x in rem)


def _repair_week(bundle: dict, tt, n_cls: int, pools, pre_events: dict,
                 rng: random.Random) -> int:
    """Min-conflicts repair: move placeable lessons into self-study slots.
    A move keeps both the source and target slot clash-free. Returns the
    number of repairs made."""
    def teacher_busy(tt, d, p, tid, skip_ci=None) -> bool:
        for ci in range(n_cls):
            if ci == skip_ci:
                continue
            L = tt[ci][d][p]
            if L and L.get("tid") == tid:
                return True
        return False

    def _day_load(tt, tid, d, skip=None) -> int:
        """How many lessons `tid` teaches on day `d` (optionally excluding
        one (ci, d, p) slot — used when a lesson is about to move out)."""
        n = 0
        for ci in range(n_cls):
            for p2 in range(DAY_LEN[d]):
                if skip and skip == (ci, d, p2):
                    continue
                L = tt[ci][d][p2]
                if L and L.get("tid") == tid:
                    n += 1
        return n

    def _cap_for(tid: int) -> int:
        if tid == 0:
            return 99
        if tid < 0:
            for x in bundle.get("extras", []):
                if -x.id == tid:
                    return max(1, x.max_daily)
        return TEACHER_DAILY_MAX

    repairs = 0
    for _ in range(REPAIR_BUDGET):
        hole = None
        for ci in range(n_cls):
            for d in range(6):
                for p in range(DAY_LEN[d]):
                    if tt[ci][d][p] and tt[ci][d][p].get("tid") == 0 \
                            and tt[ci][d][p].get("kind") == "study":
                        hole = (ci, d, p)
                        break
                if hole:
                    break
            if hole:
                break
        if hole is None:
            return repairs
        ci, d, p = hole
        done = False
        # try other slots of the same class: take a real lesson, leave study
        slots = [(d2, p2) for d2 in range(6) for p2 in range(DAY_LEN[d2])
                 if (d2, p2) != (d, p)
                 and tt[ci][d2][p2] and tt[ci][d2][p2].get("tid") != 0
                 and (ci, d2, p2) not in pre_events]
        rng.shuffle(slots)
        for d2, p2 in slots:
            L = tt[ci][d2][p2]
            tid = L["tid"]
            if tid == 0 or teacher_busy(tt, d, p, tid, skip_ci=ci):
                continue
            # daily-cap guard: the move must not push either teacher over
            # their per-day limit (extras carry their own max_daily). The
            # hole currently holds self-study, so nothing moves out of
            # (d, p); (d2, p2) frees exactly L.
            if _day_load(tt, tid, d) + 1 > _cap_for(tid):
                continue
            old = tt[ci][d][p]
            if old and old.get("tid") and old.get("tid") != 0:
                if teacher_busy(tt, d2, p2, old["tid"], skip_ci=ci):
                    continue
                if _day_load(tt, old["tid"], d2, skip=(ci, d2, p2)) + 1 > _cap_for(old["tid"]):
                    continue
            tt[ci][d][p] = L
            tt[ci][d2][p2] = old or {
                "tid": 0, "kind": "study", "short": "STUDY",
                "name": "Self-study", "tn": "Free period",
            }
            repairs += 1
            done = True
            break
        if not done:
            # nothing movable into this hole right now — try the next hole
            # by marking it permanently (rare): swap lists so we terminate
            tt[ci][d][p]["pinned"] = True
            if all(
                (tt[c2][d3][p3] or {}).get("pinned")
                for c2 in range(n_cls) for d3 in range(6)
                for p3 in range(DAY_LEN[d3])
                if tt[c2][d3][p3] and tt[c2][d3][p3].get("tid") == 0
            ):
                return repairs
    return repairs


def generate_school_timetable(bundle: dict) -> dict:
    """Full-school weekly grid: tt[ci][d][p] = lesson dict."""
    classes_meta, pools = _build_pools(bundle)
    n_cls = len(classes_meta)
    tt: list[list[list]] = [[[None] * PERIODS for _ in range(6)] for _ in range(n_cls)]

    # pre-placed mass events (consume one activity slot; teacher counted busy)
    pre_events: dict[tuple[int, int, int], int] = {}
    events: dict[tuple[int, int, int], dict] = {}
    games_pool = sorted({-x.id for x in bundle.get("extras", [])
                         if (x.activity or "") == "games"})
    # mass events are school-wide (many classes at once) — they can never be
    # assigned to one real teacher; they run unsupervised unless we later
    # model grade-level instructors
    fallback_pool = [0]
    for meta in classes_meta:
        ci, grade = meta["ci"], meta["grade"]
        games_tid = fallback_pool[ci % len(fallback_pool)]
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
        for attempt in range(MAX_ATTEMPTS):
            day_placed: dict = {}
            day_pools = [list(pools[ci][d]) for ci in range(n_cls)]
            load_day: dict[int, int] = {t: 0 for t in
                                        _all_teacher_ids(bundle)}
            ok = _schedule_day(bundle, d, day_pools, n_cls, pre_events,
                               random.Random(9000 + d * 131 + attempt * 17),
                               day_placed, load_day)
            for ci in range(n_cls):
                for p in range(PERIODS):
                    if (ci, d, p) not in events:
                        tt[ci][d][p] = None
            for (ci, p), L in day_placed.items():
                tt[ci][d][p] = dict(L)
            if ok:
                break
        # leftover fill: cap-aware, real teachers first; an activity whose
        # extra teacher is capped out degrades to unsupervised (tid 0), an
        # unstaffed subject is shown honestly with teacher "—", and only
        # then does SELF-STUDY appear
        def _cap_left_of(L):
            tid = L["tid"]
            if tid == 0:
                return 99 if L["kind"] == "act" else 0
            cap = TEACHER_DAILY_MAX
            if tid < 0:
                for x in bundle.get("extras", []):
                    if -x.id == tid:
                        cap = max(1, x.max_daily)
                        break
            return cap - load_day.get(tid, 0)

        for ci in range(n_cls):
            for p in range(DAY_LEN[d]):
                if tt[ci][d][p] is not None:
                    continue
                placed = [tt[ci][d][q] for q in range(PERIODS) if tt[ci][d][q]]
                used = {(L["tid"], L["name"]) for L in placed}
                miss = [L for L in pools[ci][d] if (L["tid"], L["name"]) not in used]
                miss.sort(key=lambda L: 0 if L["tid"] != 0 else 1)
                pick = None
                for L in miss:
                    if L["tid"] == 0:
                        pick = L   # unsupervised activity / unstaffed subject
                        break
                    if _cap_left_of(L) <= 0:
                        if L["kind"] == "act":
                            # activity teacher exhausted → run unsupervised
                            pick = {**L, "tid": 0, "tn": "—", "unassigned": True}
                            break
                        continue
                    clash = any(tt[other][d][p] and tt[other][d][p].get("tid") == L["tid"]
                                for other in range(n_cls))
                    if not clash:
                        pick = L
                        break
                tt[ci][d][p] = dict(pick) if pick else {
                    "tid": 0, "kind": "study", "short": "STUDY",
                    "name": "Self-study", "tn": "Free period",
                }

    rng = random.Random(4242)
    _repair_week(bundle, tt, n_cls, pools, pre_events, rng)

    # conflicts audit (should always be 0 — matching guarantees it)
    conflicts = 0
    for d in range(6):
        for p in range(DAY_LEN[d]):
            seen: set[int] = set()
            for ci in range(n_cls):
                L = tt[ci][d][p]
                if L and L.get("kind") != "event" and L["tid"] != 0:
                    if L["tid"] in seen:
                        conflicts += 1
                    seen.add(L["tid"])

    report = _build_report(bundle, tt, n_cls)
    return {"tt": tt, "classes": classes_meta, "events": events,
            "conflicts": conflicts, "report": report}


def _all_teacher_ids(bundle: dict) -> list[int]:
    ids = set(bundle["users"].keys())
    for x in bundle.get("extras", []):
        ids.add(-x.id)
    return sorted(ids)


def _build_report(bundle: dict, tt, n_cls: int) -> dict:
    """Teacher loads + free periods (the ~2-free-per-day spec) and the
    self-study count — surfaced via /timetable/report."""
    per_day: dict[int, list[int]] = {}
    weekly: dict[int, int] = {}
    self_study = 0
    for d in range(6):
        for p in range(DAY_LEN[d]):
            for ci in range(n_cls):
                L = tt[ci][d][p]
                if not L:
                    continue
                if L.get("kind") == "study":
                    self_study += 1
                    continue
                tid = L.get("tid")
                if not tid or L.get("kind") == "event":
                    continue
                per_day.setdefault(tid, [0] * 6)[d] += 1
                weekly[tid] = weekly.get(tid, 0) + 1

    teachers = []
    for tid in sorted(per_day.keys()):
        days_taught = per_day[tid]
        free = [DAY_LEN[d] - days_taught[d] for d in range(6)]
        teachers.append({
            "teacher_id": tid,
            "name": _teacher_name(bundle, tid),
            "kind": "extra" if tid < 0 else "staff",
            "daily_taught": days_taught,
            "daily_free": free,
            "avg_free_per_day": round(sum(free) / 6, 1),
            "weekly_periods": weekly.get(tid, 0),
        })
    teachers.sort(key=lambda t: t["avg_free_per_day"])
    avg_free = round(sum(t["avg_free_per_day"] for t in teachers) /
                     max(len(teachers), 1), 1)
    return {
        "teachers": teachers,
        "avg_free_per_day": avg_free,
        "self_study_slots": self_study,
        "teachers_over_target": sum(1 for t in teachers
                                    if t["avg_free_per_day"] < 2),
    }


# ─────────────────────────────────────────────────────────────────────────────
# cached entry point
# ─────────────────────────────────────────────────────────────────────────────
@lru_cache(maxsize=8)
def _cached_grid(school_id: int, n_classes: int, n_assign: int,
                 n_extra: int, max_extra_id: int) -> dict:
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
    extras = db.query(ExtraTeacher.id).filter(ExtraTeacher.school_id == school.id).all()
    n_extra = len(extras)
    max_extra = max((r[0] for r in extras), default=0)
    return _cached_grid(school.id, n_classes, n_assign, n_extra, max_extra)


def _school_of(user: User, db: Session) -> School:
    if user.role == "super_admin":
        s = db.query(School).order_by(School.id).first()
        if not s:
            raise HTTPException(status_code=404, detail="No schools configured. Seed data first.")
        return s
    if not user.school_id:
        raise HTTPException(status_code=403, detail="No school assigned to your account.")
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
            "saturday": 9,
            "academic_per_day": ACAD_PER_DAY,
            "activities_per_day": PERIODS - ACAD_PER_DAY,
            "teacher_conflicts": grid["conflicts"],
            "self_study_slots": grid["report"]["self_study_slots"],
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
            "avg_free_per_day": round((total_slots - weekly) / 6, 1),
            "subjects": sorted(subjects),
            "classes": sorted(class_names),
        },
    }


@router.get("/report")
def timetable_report(db: Session = Depends(get_db),
                     user: User = Depends(require_school_admin)):
    """Feasibility + load report: teacher free periods (spec: ~2/day),
    self-study slots, and conflicts. Admin-only."""
    school = _school_of(user, db)
    grid = get_school_grid(db, school)
    rep = grid["report"]
    rep["conflicts"] = grid["conflicts"]
    rep["classes"] = len(grid["classes"])
    return rep
