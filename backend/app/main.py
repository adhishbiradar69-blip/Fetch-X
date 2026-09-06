import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.database import engine, Base, SessionLocal, ensure_unique_indexes
from app.models import user, user_school, school, class_, student, attendance, task, mark, subject, grade_subject, exam, teacher_assignment
from app.models.school import School
from app.routers import auth, admin, attendance, tasks, academics, principal, chairperson, parent, timetable, ct
from app.rate_limit import limiter
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

app = FastAPI(title="SchoolAI API", version="1.1.0")

# ─────────────────────────────────────────────────────────────────────────────
# Rate limiter (slowapi)
# ─────────────────────────────────────────────────────────────────────────────
# Slowapi reads ``request.state.limiter`` and the client IP from the route
# handler's ``Request`` param. The exception handler converts the raised
# ``RateLimitExceeded`` into a clean 429 response.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ─────────────────────────────────────────────────────────────────────────────
# CORS — origins from env var (Task 7-bugs-security #7)
# ─────────────────────────────────────────────────────────────────────────────
_default_origins = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000"
_allowed = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", _default_origins).split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─────────────────────────────────────────────────────────────────────────────
# Security headers middleware (Task 7-bugs-security #7 + Task 10)
# ─────────────────────────────────────────────────────────────────────────────
# Industry-grade header set:
#   - Content-Security-Policy: restrict every fetch source. Inline scripts +
#     styles are allowed because Vite injects them during dev, and Google
#     Fonts CSS is the only 3rd-party stylesheet. Fonts are pulled from
#     gstatic. Images may come from any HTTPS source (user avatars etc).
#     connect-src pins fetch/XHR to our own origin + the local dev ports +
#     any *.onrender.com subdomain so production deploys can talk to each
#     other.
#   - Referrer-Policy: strict-origin-when-cross-origin — never leak the full
#     URL (which may contain query params) to third parties.
#   - Permissions-Policy: deny camera / microphone / geolocation by default.
#   - Strict-Transport-Security: HSTS — once a client has seen this over
#     HTTPS, they will refuse to downgrade to HTTP for a year (incl. subdomains).
#   - X-Content-Type-Options: nosniff — blocks MIME-sniffing.
#   - X-Frame-Options: DENY — clickjacking defence (CSP frame-ancestors
#     would be the modern equivalent; we ship both for defence-in-depth).
#   - X-XSS-Protection: legacy IE filter, harmless on modern browsers.
_CSP = (
    "default-src 'self'; "
    "script-src 'self' 'unsafe-inline'; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com; "
    "img-src 'self' data: https:; "
    "connect-src 'self' http://localhost:5173 http://localhost:8000 https://*.onrender.com"
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Content-Security-Policy"] = _CSP
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


# ─────────────────────────────────────────────────────────────────────────────
# Startup: create tables + data-integrity migration + ensure root super_admin
# ─────────────────────────────────────────────────────────────────────────────
Base.metadata.create_all(bind=engine)

# Collapse any pre-existing duplicate attendance/mark rows, then add the
# UNIQUE indexes that make duplicate writes impossible going forward.
try:
    ensure_unique_indexes()
except Exception as exc:  # pragma: no cover — startup should not crash on this
    print(f"[warn] ensure_unique_indexes failed: {exc}")

# Provision the hardcoded super_admin if missing.
try:
    _db: Session = SessionLocal()
    try:
        auth.ensure_root_admin(_db)
        print("Root admin ensured: root.schoolai@nexus-secure.internal")
    finally:
        _db.close()
except Exception as exc:  # pragma: no cover — startup should not crash on this
    print(f"[warn] ensure_root_admin failed: {exc}")

app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(attendance.router)
app.include_router(tasks.router)
app.include_router(academics.router)
app.include_router(principal.router)
app.include_router(chairperson.router)
app.include_router(parent.router)
app.include_router(timetable.router)
app.include_router(ct.router)


# Warm the chairperson's multi-school aggregation cache in the background so
# the first dashboard visit doesn't eat a ~15-20 s cold computation.
def _warm_chairperson_cache() -> None:
    import threading

    def _run():
        try:
            from app.routers.chairperson import _gather_all_schools_data_cached
            _db: Session = SessionLocal()
            try:
                schools = _db.query(School).order_by(School.id).all()
                if schools:
                    _gather_all_schools_data_cached(_db, schools)
                    print(f"[warm] chairperson cache warmed for {len(schools)} school(s)")
            finally:
                _db.close()
        except Exception as exc:  # never block startup on a warm-up
            print(f"[warn] chairperson cache warm-up skipped: {exc}")

    threading.Thread(target=_run, name="chairperson-cache-warmup", daemon=True).start()


_warm_chairperson_cache()


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    # Log the full traceback server-side only; never echo internal error
    # strings back to the client (information-disclosure hardening).
    import logging
    import traceback

    logging.getLogger("uvicorn.error").error(
        "Unhandled exception on %s %s:\n%s",
        request.method,
        request.url.path,
        traceback.format_exc(),
    )
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.get("/")
def root():
    return {"status": "running", "name": "SchoolAI API"}
