from pydantic import BaseModel, field_validator, model_validator
from typing import Optional


class UserCreate(BaseModel):
    email: str
    password: str
    # SECURITY: self-registration is limited to school_admin ONLY. Every
    # other role — including super_admin — is provisioned by operators
    # (startup root-admin seed) or by a super_admin via /admin/accounts.
    role: str = "school_admin"
    full_name: Optional[str] = None
    school_id: Optional[int] = None
    assigned_class_id: Optional[int] = None

    @field_validator("role")
    @classmethod
    def validate_role(cls, v):
        if v != "school_admin":
            raise ValueError("Self-registration is only allowed for the school_admin role.")
        return v

    @model_validator(mode="after")
    def school_admin_needs_school(self):
        if self.role == "school_admin" and self.school_id is None:
            raise ValueError("school_admin registration requires a school_id.")
        return self


class UserLogin(BaseModel):
    email: str
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    email: str
    full_name: Optional[str] = None
    school_id: Optional[int] = None
    assigned_class_id: Optional[int] = None
