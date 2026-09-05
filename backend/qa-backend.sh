#!/usr/bin/env bash
# qa-backend.sh — one-shot backend QA for the designer-data upgrade (Task 2-a).
# NOTE: the sandbox kills background processes between tool calls, so the
# server boot + seed + verification ALL happen inside this single run.
#
# Steps:
#   1. kill stale uvicorn, remove school.db (fresh schema incl. new tables)
#   2. boot uvicorn (venv, port 8000), wait for health
#   3. register/login admin@schoolai.test (super_admin)
#   4. POST /admin/seed-full (timed) and print counts
#   5. probe every new + legacy endpoint with role tokens, print HTTP codes
#   6. content assertions + samples via python; exit non-zero on any failure
set -u
ROOT="/home/z/School_Ai-reeboot"
BE="$ROOT/backend"
API="http://127.0.0.1:8000"
PY="$BE/venv/bin/python"
LOG=/tmp/qa-backend-uvicorn.log
OUT=/tmp/qa
FAILS=0
mkdir -p "$OUT"
log(){ echo "[$(date +%H:%M:%S)] $*"; }

# Cleanup trap: never leave a detached uvicorn behind (it would keep the
# calling shell's pipes open and can wedge the parent tool call).
UVICORN_PID=""
cleanup(){ [ -n "$UVICORN_PID" ] && kill "$UVICORN_PID" 2>/dev/null; }
trap cleanup EXIT TERM INT

# ── 1. clean slate ──────────────────────────────────────────────────────────
pkill -f "uvicorn app.main:app" 2>/dev/null
sleep 1
rm -f "$BE/school.db" "$BE/school.db-journal" "$BE/school.db-wal" "$BE/school.db-shm"

# ── 2. boot ─────────────────────────────────────────────────────────────────
log "booting uvicorn :8000 (fresh school.db so create_all builds the new tables)"
(cd "$BE" && setsid nohup ./venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 >"$LOG" 2>&1 < /dev/null &)
for i in $(seq 1 60); do curl -sf --max-time 5 "$API/" >/dev/null && break; sleep 0.5; done
curl -sf --max-time 5 "$API/" >/dev/null || { log "BACKEND FAILED TO START"; tail -30 "$LOG"; exit 1; }
UVICORN_PID=$(pgrep -f "uvicorn app.main:app" | head -1)
log "backend up (pid $UVICORN_PID): $(curl -s --max-time 5 "$API/")"

# ── 3. admin account + token ────────────────────────────────────────────────
code=$(curl -s --max-time 30 -o "$OUT/reg.json" -w '%{http_code}' -X POST "$API/auth/register" \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@schoolai.test","password":"admin123","role":"super_admin","full_name":"QA Admin"}')
log "register admin@schoolai.test -> HTTP $code (400 = already exists, fine)"

tok(){ curl -s --max-time 30 -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"$2\"}" | "$PY" -c 'import sys,json;print(json.load(sys.stdin).get("access_token",""))' 2>/dev/null; }

ADMIN=$(tok admin@schoolai.test admin123)
if [ -z "$ADMIN" ]; then log "FATAL: admin login failed"; tail -30 "$LOG"; exit 1; fi

# ── 3b. EMPTY-DB GRACE CHECK (fresh school + new endpoints must return
#        200 with empty lists / zeros, never 500) ──────────────────────────
log "--- EMPTY-DB GRACE CHECKS ---"
curl -s --max-time 30 -o /dev/null -X POST "$API/admin/schools" -H "Authorization: Bearer $ADMIN" \
  -H 'Content-Type: application/json' -d '{"name":"Empty State School"}'
probe_empty(){ # probe_empty <name> <label> <path>
  local name="$1" label="$2" path="$3" code
  code=$(curl -s --max-time 60 -o "$OUT/$name.json" -w '%{http_code}' -H "Authorization: Bearer $ADMIN" "$API$path")
  local ok=FAIL; [ "$code" = "200" ] && ok=PASS || FAILS=$((FAILS+1))
  printf '%-4s HTTP %s  %-46s %s\n' "$ok" "$code" "$label" "$path"
}
probe_empty empty_terms     "terms on empty school"      "/principal/terms"
probe_empty empty_tasks     "tasks/stats on empty school" "/principal/tasks/stats"
probe_empty empty_att       "attendance/series empty"    "/principal/attendance/series?scope=school&days=30"
probe_empty empty_dashboard "dashboard on empty school"  "/principal/dashboard"
probe_empty empty_compare   "classes/compare on empty"   "/principal/classes/compare"
"$PY" - "$OUT" <<'PYEOF'
import json, os, sys
OUT = sys.argv[1]
fails = []
def load(name):
    try: return json.load(open(os.path.join(OUT, name + ".json")))
    except Exception: return None
def chk(cond, label):
    print(("PASS " if cond else "FAIL ") + label)
    if not cond: fails.append(label)
t = load("empty_terms") or {}
chk(t.get("school") == {"t1": None, "t2": None, "t3": None} and t.get("classes") == [],
    f"empty terms: null school triple + no classes ({t})")
ts = load("empty_tasks") or {}
chk(ts.get("overall_pct") == 0.0 and ts.get("by_subject") == [] and ts.get("by_class") == [],
    f"empty tasks/stats: 0.0 overall + empty rows ({ts})")
ea = load("empty_att") or {}
pts = ea.get("points") or []
chk(len(pts) >= 18 and all(p.get("pct") is None for p in pts),
    f"empty attendance series: {len(pts)} points, all pct=null")
ed = load("empty_dashboard") or {}
chk(ed.get("school_average") == 0.0 and ed.get("classes") == [] and "school_rank" in ed,
    f"empty dashboard: zero average, no classes, school_rank present ({ed.get('school_rank')}/{ed.get('total_schools')})")
ec = load("empty_compare") or []
chk(ec == [], f"empty classes/compare: [] ({len(ec)} rows)")
print(f"EMPTY-DB CHECKS: {len(fails)} FAILED -> {fails}" if fails else "EMPTY-DB CHECKS: ALL PASSED")
sys.exit(1 if fails else 0)
PYEOF
PY_FAILS=$?
FAILS=$((FAILS + PY_FAILS))

# ── 4. seed-full (timed) ────────────────────────────────────────────────────
log "POST /admin/seed-full ..."
T0=$(date +%s)
code=$(curl -s --max-time 300 -o "$OUT/seed.json" -w '%{http_code}' -X POST -H "Authorization: Bearer $ADMIN" "$API/admin/seed-full")
T1=$(date +%s)
SEED_S=$((T1 - T0))
log "seed-full -> HTTP $code in ${SEED_S}s"
"$PY" - "$OUT/seed.json" <<'PYEOF'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception as e:
    print("  seed response NOT JSON:", e); raise SystemExit(1)
keys = ["schools", "classes", "students", "subjects", "exams", "marks", "attendance",
        "tasks", "task_completions", "teacher_assignments", "teachers", "parents", "accounts"]
print("  seed counts:", {k: d.get(k) for k in keys})
print("  school_admins:", d.get("school_admins"))
print("  principals:", d.get("principals"))
print("  chairperson:", d.get("chairperson"))
PYEOF
if [ "$code" != "200" ]; then FAILS=$((FAILS+1)); fi
if [ "$SEED_S" -gt 120 ]; then log "FAIL: seed took ${SEED_S}s (>120s)"; FAILS=$((FAILS+1)); fi

# ── 5. role tokens ──────────────────────────────────────────────────────────
PRIN=$(tok principal@greenwood.test principal123)
SADM=$(tok greenwood@admin.test school123)
CHAIR=$(tok chairperson@schoolai.test chair123)
PARENT=$(tok parent@greenwood.test parent123)
TEACH=$(tok teacher1.greenwood@schoolai.test teacher123)
for pair in "principal:$PRIN" "school_admin:$SADM" "chairperson:$CHAIR" "parent:$PARENT" "teacher:$TEACH"; do
  name="${pair%%:*}"; val="${pair#*:}"
  if [ -z "$val" ]; then log "FATAL: $name token empty"; FAILS=$((FAILS+1)); fi
done

probe(){ # probe <name> <label> <token> <path>
  local name="$1" label="$2" token="$3" path="$4"
  local code
  code=$(curl -s --max-time 60 -o "$OUT/$name.json" -w '%{http_code}' -H "Authorization: Bearer $token" "$API$path")
  local ok=FAIL
  [ "$code" = "200" ] && ok=PASS || FAILS=$((FAILS+1))
  printf '%-4s HTTP %s  %-46s %s\n' "$ok" "$code" "$label" "$path"
}

log "--- NEW ENDPOINTS ---"
probe terms            "terms (principal)"            "$PRIN"  "/principal/terms"
probe tasks_school     "tasks/stats (principal)"      "$PRIN"  "/principal/tasks/stats"
probe tasks_class      "tasks/stats?scope=class&id=1" "$PRIN"  "/principal/tasks/stats?scope=class&id=1"
probe att_school       "attendance/series school 30d" "$PRIN"  "/principal/attendance/series?scope=school&days=30"
probe att_class        "attendance/series class 1 90d" "$PRIN" "/principal/attendance/series?scope=class&id=1&days=90"
probe att_student      "attendance/series student 1"  "$PRIN"  "/principal/attendance/series?scope=student&id=1&days=90"
probe dashboard        "dashboard (principal)"        "$PRIN"  "/principal/dashboard"
probe compare          "classes/compare (principal)"  "$PRIN"  "/principal/classes/compare"
probe breakdown        "subjects/breakdown"           "$PRIN"  "/principal/subjects/breakdown"
probe profile          "students/1/profile"           "$PRIN"  "/principal/students/1/profile"
probe inspect          "classes/1/inspect"            "$PRIN"  "/principal/classes/1/inspect"
probe accounts         "admin/accounts (super_admin)" "$ADMIN" "/admin/accounts"
probe terms_sa         "terms (super_admin fallback)" "$ADMIN"  "/principal/terms"
probe dashboard_sa     "dashboard (super_admin fallback)" "$ADMIN" "/principal/dashboard"
probe tasks_sa         "tasks/stats (super_admin fallback)" "$ADMIN" "/principal/tasks/stats"

log "--- LOGIN CHECKS ---"
pc=$(curl -s --max-time 30 -o "$OUT/parent_login.json" -w '%{http_code}' -X POST "$API/auth/login" \
  -H 'Content-Type: application/json' -d '{"email":"parent@greenwood.test","password":"parent123"}')
ok=FAIL; [ "$pc" = "200" ] && ok=PASS || FAILS=$((FAILS+1))
printf '%-4s HTTP %s  %-46s %s\n' "$ok" "$pc" "parent login" "/auth/login parent@greenwood.test"
tc=$(curl -s --max-time 30 -o "$OUT/teacher_login.json" -w '%{http_code}' -X POST "$API/auth/login" \
  -H 'Content-Type: application/json' -d '{"email":"teacher1.greenwood@schoolai.test","password":"teacher123"}')
ok=FAIL; [ "$tc" = "200" ] && ok=PASS || FAILS=$((FAILS+1))
printf '%-4s HTTP %s  %-46s %s\n' "$ok" "$tc" "teacher login" "/auth/login teacher1.greenwood@..."

log "--- LEGACY / BACKWARD COMPATIBILITY ---"
probe trends           "trends (principal)"           "$PRIN"  "/principal/trends"
probe rankings         "rankings (principal)"         "$PRIN"  "/principal/rankings"
probe chair_overview   "chairperson/overview"         "$CHAIR" "/chairperson/overview"
probe class_exams      "academics class exams"        "$TEACH" "/academics/class/1/exams"
probe att_summary      "attendance summary class 1"   "$PRIN"  "/attendance/summary/1"
probe at_risk          "at-risk (principal)"          "$PRIN"  "/principal/at-risk"
probe students_page    "students explorer"            "$PRIN"  "/principal/students?limit=5"
probe schools_list     "admin/schools"                "$ADMIN" "/admin/schools"

# ── 6. content assertions + samples ─────────────────────────────────────────
log "--- CONTENT ASSERTIONS ---"
"$PY" - "$OUT" <<'PYEOF'
import json, os, sys

OUT = sys.argv[1]
fails = []

def load(name):
    try:
        return json.load(open(os.path.join(OUT, name + ".json")))
    except Exception:
        return None

def chk(cond, label):
    print(("PASS " if cond else "FAIL ") + label)
    if not cond:
        fails.append(label)

seed = load("seed") or {}
chk(seed.get("schools") == 3, "seed: 3 schools")
chk(seed.get("classes") == 90, "seed: 90 classes (30/school x 3)")
chk(seed.get("students") == 2700, "seed: 2700 students (900/school x 3)")
chk(seed.get("exams") == 180, "seed: 180 exams (60/school x 3)")
chk(seed.get("marks") == 113400, f"seed: 113400 marks (got {seed.get('marks')})")
chk(seed.get("tasks") == 360, "seed: 360 tasks (120/school x 3)")
chk(seed.get("task_completions") == 10800, f"seed: 10800 task completions (got {seed.get('task_completions')})")
chk(seed.get("teacher_assignments") == 540, "seed: 540 teacher assignments (180/school x 3)")
chk(seed.get("teachers") == 90, "seed: 90 teacher accounts (30/school x 3)")
chk(seed.get("parents") == 3, "seed: 3 parent accounts")
chk(seed.get("accounts") == 100, f"seed: 100 seeded accounts (got {seed.get('accounts')})")

terms = load("terms") or {}
s = terms.get("school") or {}
chk(s.get("t1") is not None and s.get("t2") is not None and s.get("t3") is not None,
    "terms: school t1/t2/t3 all present")
chk(None not in (s.get("t1"), s.get("t2"), s.get("t3")) and s["t1"] <= s["t2"] <= s["t3"],
    f"terms: improving trend T1<=T2<=T3 ({s.get('t1')} <= {s.get('t2')} <= {s.get('t3')})")
chk(len(terms.get("subjects") or []) >= 6, f"terms: {len(terms.get('subjects') or [])} subject rows (>=6)")
chk(len(terms.get("classes") or []) == 30, f"terms: {len(terms.get('classes') or [])} class rows (==30)")
sub0 = (terms.get("subjects") or [{}])[0]
print("     sample school:", s)
print("     sample subject:", sub0)

ts = load("tasks_school") or {}
chk(isinstance(ts.get("overall_pct"), (int, float)) and 50 <= ts["overall_pct"] <= 90,
    f"tasks/stats: overall_pct={ts.get('overall_pct')} in [50..90] (~70 expected)")
chk(len(ts.get("by_subject") or []) >= 6, f"tasks/stats: {len(ts.get('by_subject') or [])} by_subject rows (>=6)")
chk(len(ts.get("by_class") or []) == 30, f"tasks/stats: {len(ts.get('by_class') or [])} by_class rows (==30)")
tsc = load("tasks_class") or {}
chk(tsc.get("by_class") == [] and len(tsc.get("by_subject") or []) >= 1,
    "tasks/stats scope=class: by_class empty, by_subject present")
print("     sample by_subject[0]:", (ts.get("by_subject") or [None])[0])

ser = load("att_school") or {}
pts = ser.get("points") or []
chk(len(pts) >= 18, f"attendance series: {len(pts)} school-day points in 30d (>=18)")
chk(all(p.get("pct") is not None for p in pts), "attendance series: no null points (90d history covers range)")
chk(all(80 <= p["pct"] <= 96 for p in pts), "attendance series: pct within 80-96 band (~88 expected)")
serc = load("att_class") or {}
pclass = serc.get("points") or []
chk(len(pclass) >= 60 and all(p.get("pct") is not None for p in pclass),
    f"attendance series class 90d: {len(pclass)} points, all non-null")
sers = load("att_student") or {}
pstu = sers.get("points") or []
chk(len(pstu) >= 60 and all(p.get("pct") is not None for p in pstu),
    f"attendance series student 90d: {len(pstu)} points, all non-null")
print("     sample first/last:", pts[0] if pts else None, pts[-1] if pts else None)

dash = load("dashboard") or {}
chk("school_rank" in dash and "total_schools" in dash, "dashboard: school_rank + total_schools present")
chk(dash.get("total_schools") == 3, f"dashboard: total_schools={dash.get('total_schools')} (==3)")
chk(isinstance(dash.get("school_rank"), int) and 1 <= dash["school_rank"] <= 3,
    f"dashboard: school_rank={dash.get('school_rank')} in [1..3]")
chk("school_average" in dash and dash.get("classes"), "dashboard: legacy fields intact (school_average, classes)")
print("     sample:", {"school": dash.get("school"), "school_average": dash.get("school_average"),
                       "school_rank": dash.get("school_rank"), "total_schools": dash.get("total_schools")})

cmp_rows = load("compare") or {}
chk(len(cmp_rows) == 30, f"classes/compare: {len(cmp_rows)} rows (==30)")
r0 = cmp_rows[0] if cmp_rows else {}
chk(bool(r0.get("class_teacher_name")), f"classes/compare row1: class_teacher_name={r0.get('class_teacher_name')!r}")
st = r0.get("subject_teachers") or {}
chk(len(st) == 6 and st.get("Mathematics") == "Priya Sharma",
    f"classes/compare row1: 6 subject_teachers, Mathematics=Priya Sharma ({st})")
r1 = cmp_rows[1] if len(cmp_rows) > 1 else {}
chk(bool(r1.get("class_teacher_name")), f"classes/compare row2: class_teacher_name={r1.get('class_teacher_name')!r}")

bd = load("breakdown") or {}
hod_count = sum(1 for r in bd if r.get("hod_name"))
chk(len(bd) >= 6 and hod_count >= 6,
    f"subjects/breakdown: {len(bd)} rows, {hod_count} with HOD (core 6 subjects have HODs; others nullable)")
math_row = next((r for r in bd if r.get("name") == "Mathematics"), None)
chk(bool(math_row) and math_row.get("hod_name") == "Priya Sharma",
    f"subjects/breakdown: Mathematics HOD = {math_row.get('hod_name') if math_row else None}")
print("     sample:", [{"name": r.get("name"), "hod_name": r.get("hod_name")} for r in bd[:2]])

prof = load("profile") or {}
sta = prof.get("subject_term_averages") or {}
chk(len(sta) >= 6, f"student profile: {len(sta)} subjects in subject_term_averages (>=6)")
chk(all(set(v.keys()) == {"t1", "t2", "t3"} and None not in v.values() for v in sta.values()),
    "student profile: every subject has non-null t1/t2/t3")
chk("average" in prof and "attendance_rate" in prof and "subject_exam_grid" in prof,
    "student profile: legacy fields intact")
one = dict(list(sta.items())[:2])
print("     sample:", one)

insp = load("inspect") or {}
chk(bool(insp.get("class_teacher_name")) and len(insp.get("subject_teachers") or {}) == 6,
    f"class inspect: class_teacher_name={insp.get('class_teacher_name')!r}, 6 subject_teachers")

accs = load("accounts") or []
chk(len(accs) == 101, f"admin/accounts: {len(accs)} accounts (100 seeded + admin@schoolai.test)")
roles = {}
for a in accs:
    roles[a.get("role")] = roles.get(a.get("role"), 0) + 1
chk(roles.get("class_teacher") == 90, f"accounts: 90 class_teacher accounts ({roles})")
chk(roles.get("parent") == 3, f"accounts: 3 parent accounts")

pl = load("parent_login") or {}
chk(pl.get("role") == "parent", f"parent login: role={pl.get('role')}")
tl = load("teacher_login") or {}
chk(tl.get("role") == "class_teacher", f"teacher login: role={tl.get('role')}")

ex = load("class_exams") or {}
chk(len(ex) == 6 and sorted({e.get("term") for e in ex}) == ["Term 1", "Term 2", "Term 3"],
    f"legacy /academics/class/1/exams: 6 exams across Term 1/2/3 (got {sorted({e.get('term') for e in ex})})")

summ = load("att_summary") or {}
chk(len(summ) == 30 and all(70 <= r.get("attendance_rate", 0) <= 100 for r in summ),
    f"legacy /attendance/summary/1: {len(summ)} students, per-student rates ~88 (70-100 band)")

trends = load("trends") or {}
chk(len(trends.get("by_exam") or []) == 60, f"legacy /principal/trends: {len((trends.get('by_exam') or []))} exams")
chk(len(trends.get("by_grade") or []) == 10, "legacy /principal/trends: 10 grades")

rank = load("rankings") or {}
chk(len(rank.get("top_10") or []) == 10, "legacy /principal/rankings: top_10 has 10 rows")

print()
if fails:
    print(f"CONTENT CHECKS: {len(fails)} FAILED -> {fails}")
    sys.exit(1)
print("CONTENT CHECKS: ALL PASSED")
PYEOF
PY_FAILS=$?
FAILS=$((FAILS + PY_FAILS))

log "seed time: ${SEED_S}s"
if [ "$FAILS" -eq 0 ]; then
  log "QA RESULT: ALL GREEN"
else
  log "QA RESULT: $FAILS FAILURE(S)"
fi
exit "$FAILS"
