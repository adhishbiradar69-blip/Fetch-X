#!/bin/bash
# Idempotent starter for the Fetch-X preview stack:
#   FastAPI :8000 (real backend)
#   fx-shim  :3010 (single-file app + /api proxy) — gateway-friendly
curl -s -o /dev/null --max-time 2 http://127.0.0.1:8000/docs || {
  cd /home/z/Fetch-X/backend
  nohup /home/z/.venv/bin/python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000 >> /tmp/fx-backend.log 2>&1 &
}
curl -s -o /dev/null --max-time 2 http://127.0.0.1:3010/api/healthz || {
  cd /home/z/my-project
  nohup /home/z/.venv/bin/python3 scripts/fx-shim.py >> /tmp/fx-shim.log 2>&1 &
}
for i in $(seq 1 20); do
  b=$(curl -s -o /dev/null --max-time 2 -w "%{http_code}" http://127.0.0.1:8000/docs)
  s=$(curl -s -o /dev/null --max-time 2 -w "%{http_code}" http://127.0.0.1:3010/api/healthz)
  [ "$b" = "200" ] && [ "$s" = "200" ] && { echo "STACK_UP"; exit 0; }
  sleep 1
done
echo "STACK_DEGRADED be=$b shim=$s"; exit 1
