import os
import secrets

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
