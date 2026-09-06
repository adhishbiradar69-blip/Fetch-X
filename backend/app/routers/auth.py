from fastapi import APIRouter, Depends, HTTPException, Request
import os
from sqlalchemy.orm import Session
from passlib.context import CryptContext
from jose import jwt
from datetime import datetime, timedelta, timezone
import re
import secrets
import time
from collections import defaultdict

from app.database import get_db
from app.models.user import User
from app.models.school import School
from app.schemas.auth import UserCreate, UserLogin, Token
from app import config
from app.rate_limit import limiter

router = APIRouter(prefix="/auth", tags=["auth"])

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

# Bootstrap super_admin (created on startup only if missing). The password is
# NEVER hardcoded here: operators set SCHOOLAI_ROOT_PASSWORD, and if unset we
# generate a strong random one and print it ONCE to the server log on first
# provisioning. A credential committed to source = instant account takeover.
ROOT_ADMIN_EMAIL = os.environ.get("SCHOOLAI_ROOT_EMAIL", "root.schoolai@nexus-secure.internal")
ROOT_ADMIN_FULL_NAME = "System Root"


# ─────────────────────────────────────────────────────────────────────────────
# Email validation (Task 10)
# ─────────────────────────────────────────────────────────────────────────────
# Reasonable RFC-5322-ish regex — good enough to reject obvious garbage
# without false-positiving the long tail of valid-but-exotic addresses.
# We deliberately keep this permissive on the local-part (allows +, ., etc)
# and strict on the domain (must have at least one dot, no consecutive dots).
_EMAIL_RE = re.compile(
    r"^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.\-]+"
    r"@[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?"
    r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?)+$"
)


def _validate_email(email: str) -> None:
    """Reject anything that doesn't look like a valid email.

    Raises 400 with a specific message. Used on both /register and /login
    so attackers can't probe the lockout / login flow with garbage that
    would otherwise be looked up against the DB.
    """
    if not isinstance(email, str) or not email.strip():
        raise HTTPException(status_code=400, detail="A valid email address is required.")
    if len(email) > 320:  # RFC 3696 upper bound
        raise HTTPException(status_code=400, detail="Email address is too long.")
    if not _EMAIL_RE.match(email.strip()):
        raise HTTPException(status_code=400, detail="Please enter a valid email address.")


# ─────────────────────────────────────────────────────────────────────────────
# Account lockout (Task 10)
# ─────────────────────────────────────────────────────────────────────────────
# After MAX_FAILED_ATTEMPTS failed logins for a given email, the account is
# locked for LOCKOUT_DURATION_SECONDS. We track this in memory keyed by the
# (lowercased) email with the timestamp of the 5th failure. Attempts that
# arrive while the lockout is active are rejected with 423 Locked without
# even touching the DB. Successful logins + lockout expiry clear the state.
#
# This is intentionally in-memory: it's per-process, which is fine for a
# single-instance Render deployment. For multi-instance we'd move this to
# Redis, but the principal of "slow the attacker down" still holds.
MAX_FAILED_ATTEMPTS = 5
LOCKOUT_DURATION_SECONDS = 15 * 60

# { email: {"count": int, "locked_until": float|None} }
_failed_attempts: dict[str, dict] = defaultdict(lambda: {"count": 0, "locked_until": None})


def _is_locked(email: str) -> bool:
    """Return True if `email` is currently in a lockout window.

    Side-effect: if the lockout window has expired, clears the entry so the
    user can try again.
    """
    if not email:
        return False
    key = email.lower().strip()
    state = _failed_attempts.get(key)
    if not state or state.get("locked_until") is None:
        return False
    if time.time() >= state["locked_until"]:
        # Lockout window expired — reset.
        _failed_attempts.pop(key, None)
        return False
    return True


def _record_failed(email: str) -> None:
    """Increment the failed-attempt counter for `email` and lock if the
    threshold is crossed. No-op for empty emails."""
    if not email:
        return
    key = email.lower().strip()
    if len(_failed_attempts) >= LOCKOUT_TABLE_MAX_ENTRIES and key not in _failed_attempts:
        # Evict ~10% oldest entries (defaultdict preserves insertion order).
        for k in list(_failed_attempts.keys())[: LOCKOUT_TABLE_MAX_ENTRIES // 10]:
            _failed_attempts.pop(k, None)
    state = _failed_attempts[key]
    state["count"] += 1
    if state["count"] >= MAX_FAILED_ATTEMPTS and state.get("locked_until") is None:
        state["locked_until"] = time.time() + LOCKOUT_DURATION_SECONDS


def _record_success(email: str) -> None:
    """Clear any pending failed-attempt state for `email`."""
    if not email:
        return
    _failed_attempts.pop(email.lower().strip(), None)


# Cap the in-memory lockout table so unique-email floods can't grow it
# without bound (memory DoS). Oldest entries are evicted first.
LOCKOUT_TABLE_MAX_ENTRIES = 10_000


def get_password_hash(password):
    return pwd_context.hash(password)


def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=config.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, config.SECRET_KEY, algorithm=config.ALGORITHM)


def _token_for(user: User) -> dict:
    return {
        "access_token": create_access_token(data={"sub": str(user.id)}),
        "token_type": "bearer",
        "role": user.role,
        "email": user.email,
        "full_name": user.full_name,
        "school_id": user.school_id,
        "assigned_class_id": user.assigned_class_id,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Password strength
# ─────────────────────────────────────────────────────────────────────────────
def _validate_password_strength(password: str) -> None:
    """Enforce a basic but sane password policy on self-registration:
    - at least 8 characters
    - at least one letter
    - at least one number

    Raises 400 if the password is too weak. Note: the hardcoded root admin
    bypasses this (it's set via :func:`ensure_root_admin`).
    """
    if not isinstance(password, str) or len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters long.")
    if not re.search(r"[A-Za-z]", password):
        raise HTTPException(status_code=400, detail="Password must contain at least one letter.")
    if not re.search(r"\d", password):
        raise HTTPException(status_code=400, detail="Password must contain at least one number.")


# ─────────────────────────────────────────────────────────────────────────────
# Root super_admin bootstrap
# ─────────────────────────────────────────────────────────────────────────────
def ensure_root_admin(db: Session) -> None:
    """Create the bootstrap super_admin account if it doesn't exist.

    Called on app startup from ``main.py`` after tables are created. Safe to
    call repeatedly — it's a no-op once the user exists. The password comes
    from the SCHOOLAI_ROOT_PASSWORD env var, or is generated randomly and
    printed once to the server log so the operator can retrieve it.
    """
    existing = db.query(User).filter(User.email == ROOT_ADMIN_EMAIL).first()
    if existing:
        # Already provisioned. (We deliberately do NOT overwrite the password
        # here — if an operator rotated it via the admin UI, we keep it.)
        return
    password = os.environ.get("SCHOOLAI_ROOT_PASSWORD")
    generated = False
    if not password:
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*"
        password = "".join(secrets.choice(alphabet) for _ in range(20))
        generated = True
    root = User(
        email=ROOT_ADMIN_EMAIL,
        hashed_password=get_password_hash(password),
        role="super_admin",
        full_name=ROOT_ADMIN_FULL_NAME,
        school_id=None,
        assigned_class_id=None,
    )
    db.add(root)
    db.commit()
    db.refresh(root)
    if generated:
        # One-time reveal so the operator can claim the account, then it is
        # never printed again (the row exists on subsequent boots).
        print(f"[setup] Bootstrap super_admin created: {ROOT_ADMIN_EMAIL}")
        print(f"[setup] Password (shown once — store it now): {password}")


@router.post("/register", response_model=Token)
@limiter.limit("60/minute")
def register(request: Request, user: UserCreate, db: Session = Depends(get_db)):
    # SECURITY hardening: self-signup may only ever create a school_admin
    # bound to an existing school. super_admin accounts are provisioned
    # exclusively by the startup root-admin seed / operator action.
    # On top of that, sign-up is OFF in production unless the operator
    # explicitly opts in (SCHOOLAI_ALLOW_SIGNUP=true) — otherwise anyone who
    # finds the deployment could make themselves an admin of a real school.
    if config.IS_PRODUCTION and os.environ.get("SCHOOLAI_ALLOW_SIGNUP", "").strip().lower() not in ("1", "true", "yes"):
        raise HTTPException(status_code=403, detail="Self-registration is disabled on this deployment.")
    if user.role != "school_admin":
        raise HTTPException(status_code=403, detail="Self-registration is only allowed for the school_admin role.")
    _validate_email(user.email)
    school = db.query(School).filter(School.id == user.school_id).first()
    if not school:
        raise HTTPException(status_code=404, detail="School not found")
    db_user = db.query(User).filter(User.email == user.email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    _validate_password_strength(user.password)
    new_user = User(
        email=user.email,
        hashed_password=get_password_hash(user.password),
        role=user.role,
        full_name=user.full_name,
        school_id=user.school_id,
        assigned_class_id=user.assigned_class_id,
    )
    db.add(new_user)
    try:
        db.commit()
    except Exception:
        # Concurrent registrations with the same email can race past the
        # existence check; the UNIQUE constraint is the arbiter of truth.
        db.rollback()
        raise HTTPException(status_code=400, detail="Email already registered")
    db.refresh(new_user)
    return _token_for(new_user)


@router.post("/login", response_model=Token)
@limiter.limit("60/minute")
def login(request: Request, user: UserLogin, db: Session = Depends(get_db)):
    # Validate email format up-front so garbage input can't even reach the
    # DB or the lockout table.
    _validate_email(user.email)

    # Account lockout: if this email has tripped the threshold, reject with
    # 423 Locked (and a Retry-After hint) without touching the DB. This
    # means a determined attacker can't brute-force even at 60 req/min.
    if _is_locked(user.email):
        raise HTTPException(
            status_code=423,
            detail="Too many failed login attempts. Please try again in 15 minutes.",
        )

    db_user = db.query(User).filter(User.email == user.email).first()
    if not db_user or not verify_password(user.password, db_user.hashed_password):
        _record_failed(user.email)
        # Use a deliberately generic message so the response doesn't leak
        # whether the email exists in the DB.
        raise HTTPException(status_code=400, detail="Invalid email or password")
    _record_success(user.email)
    return _token_for(db_user)
