import os
import secrets


def _load_dotenv(path: str = None) -> None:
    """Minimal .env loader (no python-dotenv dependency).

    backend/.env is the documented place for local secrets (GROQ_API_KEY,
    SCHOOLAI_SECRET_KEY, SCHOOLAI_ROOT_PASSWORD). Without this loader the
    file was silently ignored and the AI quietly degraded to its fallback.
    Real environment variables always win — the file never overrides them.
    """
    if path is None:
        path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value
    except OSError:
        pass  # no .env file — nothing to do


_load_dotenv()

# ─────────────────────────────────────────────────────────────────────────────
# JWT signing key — SECURITY CRITICAL
# ─────────────────────────────────────────────────────────────────────────────
# The signing key MUST come from the environment in production. If it is not
# set we deliberately generate a random ephemeral key instead of falling back
# to a hardcoded literal: a committed fallback would let anyone who reads the
# repo forge valid tokens for any user (full auth bypass). The trade-off is
# that tokens are invalidated on every restart until the operator sets the
# variable — which is exactly the nudge we want.
SECRET_KEY = os.environ.get("SCHOOLAI_SECRET_KEY")
if not SECRET_KEY:
    SECRET_KEY = secrets.token_hex(32)
    print(
        "[warn] SCHOOLAI_SECRET_KEY is not set — using an ephemeral random key. "
        "All sessions are invalidated on restart. Set SCHOOLAI_SECRET_KEY in "
        "production (e.g. `python -c \"import secrets; print(secrets.token_hex(32))\"`)."
    )
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.environ.get("SCHOOLAI_TOKEN_EXPIRE_MINUTES", "480"))

# Non-production flag: demo seed endpoints (/admin/seed, /admin/seed-full)
# wipe and repopulate the whole database with well-known demo passwords, so
# they must never run against a real deployment. Set SCHOOLAI_ENV=production
# to disable them at the API level.
ENVIRONMENT = os.environ.get("SCHOOLAI_ENV", "development").strip().lower()
IS_PRODUCTION = ENVIRONMENT in ("production", "prod")
