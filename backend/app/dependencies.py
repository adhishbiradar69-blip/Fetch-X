from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from sqlalchemy.orm import Session
from datetime import datetime, timezone
from app.database import get_db
from app.models.user import User
from app import config

# auto_error=False so a MISSING Authorization header can be reported as a
# proper 401 (with WWW-Authenticate) instead of FastAPI's default 403.
# RFC 7235: missing/invalid credentials => 401 Unauthorized; 403 is reserved
# for "authenticated but not allowed". Frontend treats 401/403 identically,
# so this only makes the API standards-correct for other clients.
security = HTTPBearer(auto_error=False)

def _credentials_exception():
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )

# All admin-style roles. `super_admin` is the website owner (can manage
# schools + accounts), `school_admin` is a school-scoped admin.
ADMIN_ROLES = ("super_admin", "school_admin")

# Every role the platform recognises. Any JWT whose user has a role outside
# this set is rejected — even if the row somehow exists in the DB (e.g. an
# old DB from a previous schema or a hand-edited row).
ALLOWED_ROLES = frozenset({
    "super_admin", "school_admin", "principal", "vice_principal",
    "chairperson", "class_teacher", "parent",
})


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security), db: Session = Depends(get_db)):
    if credentials is None:
        raise _credentials_exception()
    token = credentials.credentials
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, config.SECRET_KEY, algorithms=[config.ALGORITHM])
        user_id = payload.get("sub")
        # Input validation: `sub` MUST be present and be a valid integer.
        # We accept either an int or a numeric string (the auth module
        # encodes it as str(user.id)), but we explicitly reject anything
        # that isn't an integer (e.g. an email, a UUID, an arbitrary
        # string). This blocks a class of token-substitution attacks where
        # a malformed `sub` could be used to confuse downstream lookups.
        if user_id is None:
            raise credentials_exception
        try:
            user_id_int = int(user_id)
        except (TypeError, ValueError):
            raise credentials_exception
        if user_id_int <= 0:
            raise credentials_exception

        # Explicit exp check — jose already rejects expired tokens, but we
        # require `exp` to be present and to fall within [now, now + 24h].
        # The upper bound caps token lifetime at 24 hours even if
        # `ACCESS_TOKEN_EXPIRE_MINUTES` is set higher in config — so a
        # leaked token is useless after one day.
        exp = payload.get("exp")
        if exp is None:
            raise credentials_exception
        now = datetime.now(timezone.utc).timestamp()
        try:
            exp_f = float(exp)
        except (TypeError, ValueError):
            raise credentials_exception
        if now > exp_f:
            # expired
            raise credentials_exception
        max_lifetime_seconds = 24 * 60 * 60
        if (exp_f - now) > max_lifetime_seconds:
            # token lifetime exceeds 24h — reject
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.query(User).filter(User.id == user_id_int).first()
    if user is None:
        raise credentials_exception

    # Role allow-list: reject any user whose role isn't one of the known
    # roles. This is a defence-in-depth check — even if a row exists in
    # the DB with a typo'd role (e.g. "principla"), we refuse to issue a
    # session for them.
    if user.role not in ALLOWED_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account role is not permitted.",
        )
    return user


def require_role(*roles):
    """Dependency factory: allows access only to users whose role is in `roles`."""
    allowed = set(roles)

    def dependency(current_user: User = Depends(get_current_user)):
        if current_user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to access this resource.",
            )
        return current_user

    return dependency


# Convenience: a super_admin-only dependency (website owner).
require_super_admin = require_role("super_admin")

# Convenience: any admin-style role (super_admin OR school_admin).
# school_admin will additionally need school-scope checks inside the route.
require_school_admin = require_role("super_admin", "school_admin")


def assert_school_access(user: User, school_id: int):
    """For `school_admin` users, verify they only touch their assigned school.
    `super_admin` can act on any school."""
    if user.role == "super_admin":
        return
    if user.role != "school_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to manage this school.",
        )
    if user.school_id is None or user.school_id != school_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only manage your own school.",
        )


# ─────────────────────────────────────────────────────────────────────────────
# Object-level (IDOR) guards — every class/student-scoped route must call one
# of these so a user can never read or write another tenant's data by guessing
# ids. Read roles (principal / chairperson / parent) are handled explicitly so
# the checks stay obvious and auditable.
# ─────────────────────────────────────────────────────────────────────────────
WRITE_CLASS_ROLES = ("class_teacher", "school_admin", "super_admin")


def assert_class_access(user: User, cls, write: bool = False):
    """Raise 403 unless `user` may access the ORM `Class` object.

    write=True restricts to roles allowed to mutate class data (attendance,
    marks, tasks). Read access additionally covers principal (own school).
    """
    role = user.role
    if role == "super_admin":
        return
    if role == "chairperson":
        if write:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Chairpersons have read-only access.",
            )
        return
    if role in ("school_admin", "principal", "vice_principal"):
        if user.school_id is None or cls is None or cls.school_id != user.school_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only access classes in your own school.",
            )
        return
    if role == "class_teacher":
        if cls is None or not (cls.class_teacher_id == user.id or user.assigned_class_id == cls.id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only access your assigned class.",
            )
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You do not have permission to access this resource.",
    )


def assert_student_access(user: User, student, db: Session):
    """Raise 403 unless `user` may read this student's records.

    school_admin / principal / vice_principal → student's class must be in
    their school; class_teacher → student must be in their assigned class;
    parent → student.parent_user_id must point at them.
    """
    from app.models.class_ import Class  # local import avoids a circular dep

    role = user.role
    if role == "super_admin":
        return
    if role == "chairperson":
        return
    cls = db.query(Class).filter(Class.id == student.class_id).first() if student else None
    if role in ("school_admin", "principal", "vice_principal"):
        if user.school_id is None or cls is None or cls.school_id != user.school_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only access students in your own school.",
            )
        return
    if role == "class_teacher":
        if cls is None or user.assigned_class_id != cls.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only access students in your assigned class.",
            )
        return
    if role == "parent":
        if student is None or student.parent_user_id != user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only view your own child.",
            )
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You do not have permission to access this resource.",
    )
