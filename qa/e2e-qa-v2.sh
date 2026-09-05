#!/usr/bin/env bash
# e2e-qa-v2.sh — E2E QA for the Fetch-X rework (one call: boot -> API smoke -> browser QA -> teardown)
export AGENT_BROWSER_SESSION="${AGENT_BROWSER_SESSION:-qa-auto-v2}"
B="http://127.0.0.1:3000"
API="http://127.0.0.1:8000"
OUT="/tmp/qa2"
ROOT="/home/z/School_Ai-reeboot"
PY="$ROOT/backend/venv/bin/python"
mkdir -p "$OUT"
log(){ echo "[$(date +%H:%M:%S)] $*"; }

# ---------- 0. clean slate ----------
pkill -f "uvicorn app.main:app" 2>/dev/null
pkill -f "vite" 2>/dev/null
sleep 1

# ---------- 1. boot stack ----------
log "booting backend (8000) + frontend (3000)"
(cd "$ROOT/backend" && setsid nohup ./venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 >/tmp/fx-backend.log 2>&1 < /dev/null &)
(cd "$ROOT/frontend" && setsid nohup npm run dev >/tmp/fx-frontend.log 2>&1 < /dev/null &)
ok=1
for i in $(seq 1 60); do curl -sf "$API/" >/dev/null && break; sleep 0.5; done
curl -sf "$API/" >/dev/null || { log "BACKEND FAILED"; ok=0; }
for i in $(seq 1 60); do curl -sf "$B/" >/dev/null && break; sleep 0.5; done
curl -sf "$B/" >/dev/null || { log "FRONTEND FAILED"; ok=0; }
log "backend: $(curl -s -o /dev/null -w '%{http_code}' "$API/")  frontend: $(curl -s -o /dev/null -w '%{http_code}' "$B/")"
[ "$ok" = "1" ] || { pkill -f "uvicorn app.main"; pkill -f vite; exit 1; }

# ---------- 2. API smoke ----------
log "--- API SMOKE ---"
tok(){ curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | "$PY" -c 'import sys,json;print(json.load(sys.stdin)["access_token"])'; }
PT=$(tok principal@greenwood.test principal123)
[ -n "$PT" ] && [ "$PT" != "null" ] && log "principal login OK" || { log "PRINCIPAL LOGIN FAILED"; }
smoke(){ local c; c=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $PT" "$API$1"); echo "$c  $1"; }
for ep in /principal/stats /principal/term-averages /principal/score-distribution "/principal/attendance-series?range=1Y" "/principal/class-comparison?metric=tasks" "/principal/classes?grade=7" /principal/class-detail/29 /principal/tasks-summary /principal/school-rank "/principal/radar?scope=school" "/principal/students?page=1&page_size=5" /principal/student-report/33 /principal/dashboard /principal/rankings /principal/insights; do smoke "$ep"; done
CT=$(tok chairperson@schoolai.test chair123); AT=$(tok admin@schoolai.test admin123); ST=$(tok greenwood@admin.test school123)
s2(){ local c; c=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $2" "$API$1"); echo "$c  [$3] $1"; }
s2 /chairperson/overview "$CT" chair
s2 /admin/schools "$AT" superadmin
s2 /attendance/teacher/classes "$ST" legacy
s2 /tasks/class/1 "$ST" legacy

# ---------- 3. browser QA ----------
ui(){ local name="$1" path="$2"; agent-browser open "$B$path" >/dev/null 2>&1; sleep 4; agent-browser screenshot "$OUT/${name}.png" >/dev/null 2>&1; agent-browser console > "$OUT/console-${name}.txt" 2>/dev/null; }
claim(){ local name="$1" pat="$2"; if agent-browser read 2>/dev/null | grep -qiE "$pat"; then log "PASS $name"; else log "FAIL $name (pattern: $pat)"; fi; }

log "--- UI QA ---"
agent-browser close --all >/dev/null 2>&1

# 3a. landing
ui "00-landing" "/"
claim "landing hero" "finally intelligent"
claim "landing team" "VISION & GROWTH"
agent-browser screenshot "$OUT/00-landing.png" >/dev/null 2>&1

# 3b. landing sign-in modal -> real principal login
agent-browser click 'button:has-text("Sign In")' >/dev/null 2>&1 || agent-browser click '.btn-primary' >/dev/null 2>&1
sleep 1.5
agent-browser fill 'input[type="email"]' "principal@greenwood.test" >/dev/null 2>&1
agent-browser fill 'input[type="password"]' "principal123" >/dev/null 2>&1
agent-browser click 'input[type="checkbox"]' >/dev/null 2>&1
agent-browser click 'button[type="submit"]' >/dev/null 2>&1
sleep 5
agent-browser screenshot "$OUT/01-after-modal-login.png" >/dev/null 2>&1
claim "modal login landed on principal dashboard" "principal/dashboard"

# 3c. principal dashboard — new page with real data
ui "02-principal-dash" "/principal/dashboard"
claim "dash h1" "Principal Dashboard"
claim "dash houses (real data)" "Sapphire"
claim "dash rank (real)" "of 3"
agent-browser screenshot "$OUT/02-principal-dash.png" >/dev/null 2>&1

# 3d. dark mode
agent-browser click '.pagehead .btn-mode' >/dev/null 2>&1
sleep 1.5
agent-browser screenshot "$OUT/03-principal-dash-dark.png" >/dev/null 2>&1
agent-browser click '.pagehead .btn-mode' >/dev/null 2>&1

# 3e. class detail via hash
ui "04-class-detail" "/principal/dashboard#class=29"
claim "class detail title" "10-Emerald"
claim "class detail CT" "Divya Saxena"
agent-browser screenshot "$OUT/04-class-detail.png" >/dev/null 2>&1

# 3f. report card modal (click first student row in class detail)
agent-browser click '.srow' >/dev/null 2>&1
sleep 3
agent-browser screenshot "$OUT/05-report-modal.png" >/dev/null 2>&1
agent-browser press Escape >/dev/null 2>&1

# 3g. compare + academic modals
ui "06-compare-modal" "/principal/dashboard"
agent-browser click '.btn-compare' >/dev/null 2>&1
sleep 3
agent-browser screenshot "$OUT/06-compare-modal.png" >/dev/null 2>&1
agent-browser press Escape >/dev/null 2>&1
sleep 1
agent-browser click '.btn-aperf' >/dev/null 2>&1
sleep 3
agent-browser screenshot "$OUT/07-academic-modal.png" >/dev/null 2>&1
agent-browser press Escape >/dev/null 2>&1

# 3h. legacy pages still render (new theme compat)
login2(){ agent-browser open "$B/login" >/dev/null 2>&1; sleep 2.5; agent-browser fill 'input[type="email"]' "$1" >/dev/null 2>&1; agent-browser fill 'input[type="password"]' "$2" >/dev/null 2>&1; agent-browser click 'input[type="checkbox"]' >/dev/null 2>&1; agent-browser click 'button[type="submit"]' >/dev/null 2>&1; sleep 4; }
login2 chairperson@schoolai.test chair123
ui "08-chair-dash" "/chairperson/dashboard"
claim "chair dash renders" "Portfolio\|portfolio\|Health"
login2 admin@schoolai.test admin123
ui "09-admin-dash" "/admin/dashboard"
claim "admin dash renders" "Overview\|Schools\|Dashboard"
login2 greenwood@admin.test school123
ui "10-teacher-attendance" "/teacher/attendance"
claim "teacher attendance renders" "Attendance\|Present\|attendance"

# ---------- 4. console error summary ----------
log "--- CONSOLE ERROR SUMMARY ---"
for f in "$OUT"/console-*.txt; do
  n=$(basename "$f")
  errs=$(grep -iE "error|uncaught|failed" "$f" 2>/dev/null | grep -viE "favicon|DevTools|sourcemap" | sort -u | head -3)
  if [ -n "$errs" ]; then echo "== $n"; echo "$errs"; fi
done
log "QA COMPLETE — artifacts in $OUT"
pkill -f "uvicorn app.main" 2>/dev/null
pkill -f vite 2>/dev/null
echo "TEARDOWN OK"
