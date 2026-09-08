#!/usr/bin/env bash
# Fetch-X one-command starter (macOS / Linux / Git Bash)
# Installs, seeds, and runs backend (:8000) + frontend (first free port >= 3000)
cd "$(dirname "$0")" || exit 1

command -v python3 >/dev/null || { echo "[!] python3 not found — install Python 3.10+ from python.org"; exit 1; }
command -v node    >/dev/null || { echo "[!] node not found — install Node 18+ from nodejs.org"; exit 1; }

echo "[1/4] Backend setup..."
cd backend || exit 1
[ -d .venv ] || python3 -m venv .venv
source .venv/bin/activate 2>/dev/null || source .venv/Scripts/activate
pip install -q -r requirements.txt || { echo "[!] pip install failed"; exit 1; }
python seed_demo.py || { echo "[!] seed failed"; exit 1; }
uvicorn app.main:app --port 8000 &
cd .. || exit 1

echo "[2/4] Frontend setup..."
cd frontend || exit 1
[ -d node_modules ] || npm install --no-audit --no-fund || { echo "[!] npm install failed"; exit 1; }

echo "[3/4] Finding a free port..."
PORT=3000
while command -v lsof >/dev/null && lsof -i :$PORT >/dev/null 2>&1; do PORT=$((PORT+1)); done

echo ""
echo "=================================================="
echo "   FETCH-X IS STARTING"
echo "   >>>  OPEN:  http://localhost:$PORT  <<<"
echo "   (backend on :8000 — keep this window open)"
echo "=================================================="
echo ""
echo "[4/4] Launching Vite on port $PORT..."
npm run dev -- --port $PORT
