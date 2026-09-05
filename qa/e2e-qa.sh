#!/usr/bin/env bash
# e2e-qa.sh — one-shot E2E QA for SchoolAI (boots stack + drives agent-browser + API smoke)
# NOTE: sandbox kills background processes between tool calls, so everything runs in ONE call.
export AGENT_BROWSER_SESSION="${AGENT_BROWSER_SESSION:-qa-auto}"
B="http://127.0.0.1:5173"
API="http://127.0.0.1:8000"
OUT="/tmp/qa"
ROOT="/home/z/School_Ai-reeboot"
PY="$ROOT/backend/venv/bin/python"
mkdir -p "$OUT"
log(){ echo "[$(date +%H:%M:%S)] $*"; }

# ---------- 0. clean slate ----------
pkill -f "uvicorn app.main:app" 2>/dev/null
pkill -f "vite" 2>/dev/null
sleep 1

# ---------- 1. boot stack ----------
log "booting backend + frontend"
(cd "$ROOT/backend" && setsid nohup ./venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 >/tmp/schoolai-backend.log 2>&1 < /dev/null &)
(cd "$ROOT/frontend" && setsid nohup npm run dev -- --host 127.0.0.1 --port 5173 --strictPort >/tmp/schoolai-frontend.log 2>&1 < /dev/null &)
ok=1
for i in $(seq 1 60); do curl -sf "$API/" >/dev/null && break; sleep 0.5; done
curl -sf "$API/" >/dev/null || { log "BACKEND FAILED TO START"; ok=0; }
for i in $(seq 1 60); do curl -sf "$B/" >/dev/null && break; sleep 0.5; done
curl -sf "$B/" >/dev/null || { log "FRONTEND FAILED TO START"; ok=0; }
log "backend: $(curl -s -o /dev/null -w '%{http_code}' "$API/")  frontend: $(curl -s -o /dev/null -w '%{http_code}' "$B/")"
[ "$ok" = "1" ] || exit 1

# ---------- 2. API smoke (all roles) ----------
log "--- API SMOKE ---"
tok(){ curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | "$PY" -c 'import sys,json;print(json.load(sys.stdin)["access_token"])'; }
PT=$(tok principal@greenwood.test principal123)
CT2=$(tok chairperson@schoolai.test chair123)
AT=$(tok admin@schoolai.test admin123)
ST=$(tok greenwood@admin.test school123)
smoke(){ local label="$1" tokval="$2" path="$3"; local code; code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $tokval" "$API$path"); echo "$code  $label  $path"; }
smoke "principal" "$PT" "/principal/dashboard"
smoke "principal" "$PT" "/principal/classes/compare"
smoke "principal" "$PT" "/principal/subjects/breakdown"
smoke "principal" "$PT" "/principal/at-risk"
smoke "principal" "$PT" "/principal/trends"
smoke "principal" "$PT" "/principal/rankings"
smoke "principal" "$PT" "/principal/insights"
smoke "principal" "$PT" "/principal/students?limit=5"
smoke "principal" "$PT" "/principal/students/1/profile"
smoke "principal" "$PT" "/principal/grades/10/inspect"
smoke "principal" "$PT" "/principal/attendance/analytics"
smoke "principal" "$PT" "/principal/subjects/1/deep-dive"
smoke "chairperson" "$CT2" "/chairperson/overview"
smoke "chairperson" "$CT2" "/chairperson/schools"
smoke "chairperson" "$CT2" "/chairperson/compare"
smoke "chairperson" "$CT2" "/chairperson/rankings"
smoke "chairperson" "$CT2" "/chairperson/insights"
smoke "superadmin" "$AT" "/admin/schools"
smoke "superadmin" "$AT" "/admin/classes"
smoke "superadmin" "$AT" "/admin/subjects"
smoke "superadmin" "$AT" "/admin/exams"
smoke "superadmin" "$AT" "/admin/accounts"
smoke "schooladmin" "$ST" "/attendance/teacher/classes"
smoke "schooladmin" "$ST" "/attendance/summary/1"
smoke "schooladmin" "$ST" "/tasks/class/1"
smoke "schooladmin" "$ST" "/academics/class/1/exams"
smoke "schooladmin" "$ST" "/academics/class/1/report"
EXID=$(curl -s -H "Authorization: Bearer $ST" "$API/academics/class/1/exams" | "$PY" -c 'import sys,json;d=json.load(sys.stdin);print(d[0]["id"] if isinstance(d,list) and d else "")' 2>/dev/null)
smoke "schooladmin" "$ST" "/academics/class/1/marks?exam_id=${EXID:-1}"

# ---------- 3. browser UI QA ----------
ui(){ # ui <name> <path>  — open, wait, screenshot, console
  local name="$1" path="$2"
  agent-browser open "$B$path" >/dev/null 2>&1
  sleep 4
  agent-browser screenshot "$OUT/${name}.png" >/dev/null 2>&1
  agent-browser console > "$OUT/console-${name}.txt" 2>/dev/null
  local errs; errs=$(grep -ciE "error|uncaught|failed" "$OUT/console-${name}.txt" 2>/dev/null || true)
  log "UI $name -> $path  (console error lines: $errs)"
}
login(){ # login <email> <pass>
  agent-browser open "$B/login" >/dev/null 2>&1
  sleep 2.5
  agent-browser fill 'input[type="email"]' "$1" >/dev/null 2>&1
  agent-browser fill 'input[type="password"]' "$2" >/dev/null 2>&1
  agent-browser click 'input[type="checkbox"]' >/dev/null 2>&1
  agent-browser click 'button[type="submit"]' >/dev/null 2>&1
  sleep 4
}

log "--- UI QA ---"
agent-browser close --all >/dev/null 2>&1
ui "00-landing" "/"
login principal@greenwood.test principal123
agent-browser screenshot "$OUT/01-after-login.png" >/dev/null 2>&1
ui "01-principal-dashboard" "/principal/dashboard"
ui "02-principal-students" "/principal/students"
ui "03-principal-grades" "/principal/grades"
ui "04-principal-subjects" "/principal/subjects"
ui "05-principal-atrisk" "/principal/at-risk"
ui "06-principal-compare" "/principal/compare"

login chairperson@schoolai.test chair123
ui "07-chair-dashboard" "/chairperson/dashboard"
ui "08-chair-rankings" "/chairperson/rankings"
ui "09-chair-compare" "/chairperson/compare"

login admin@schoolai.test admin123
ui "10-admin-dashboard" "/admin/dashboard"

login greenwood@admin.test school123
ui "11-teacher-attendance" "/teacher/attendance"
ui "12-teacher-tasks" "/teacher/tasks"
ui "13-teacher-marks" "/teacher/marks"
ui "14-class-report" "/class-teacher/report"
ui "15-public-about" "/about"
ui "16-public-terms" "/terms"
ui "17-public-privacy" "/privacy"

log "--- CONSOLE ERROR SUMMARY ---"
for f in "$OUT"/console-*.txt; do
  n=$(basename "$f")
  errs=$(grep -iE "error|uncaught|failed" "$f" | grep -viE "favicon|DevTools" | sort -u | head -4)
  if [ -n "$errs" ]; then echo "== $n"; echo "$errs"; fi
done
log "QA COMPLETE — artifacts in $OUT"
