# Fetch-X backend — FastAPI + SQLite (volume-mounted)
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# deps first for layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# app + seeding script (the SQLite file itself lives on a mounted volume)
COPY app ./app
COPY seed_demo.py .

# non-root user; /app/data is where the compose file points the DB
RUN useradd -m appuser && mkdir -p /app/data && chown -R appuser:appuser /app
USER appuser

# the DB file is created inside /app/data (mounted volume) — see
# SCHOOLAI_DATABASE_URL in docker-compose.yml
ENV SCHOOLAI_DATABASE_URL=sqlite:////app/data/school.db

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
