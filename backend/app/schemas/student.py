from pydantic import BaseModel, field_validator
from typing import Optional


class SchoolCreate(BaseModel):
    name: str


class ClassCreate(BaseModel):
    school_id: int
    grade: int
    section: str

    @field_validator("grade")
    @classmethod
    def validate_grade(cls, v):
        if v < 1 or v > 10:
            raise ValueError("Grade must be between 1 and 10")
        return v

    @field_validator("section")
    @classmethod
    def validate_section(cls, v):
        # Accept any short section label — house names like "Sapphire" are
        # allowed, not just A/B/C/D. Normalise whitespace, cap length.
        if not isinstance(v, str):
            raise ValueError("Section must be a string")
        s = v.strip()
        if not s:
            raise ValueError("Section is required")
        if len(s) > 20:
            raise ValueError("Section must be at most 20 characters")
        return s


class StudentCreate(BaseModel):
    name: str
    roll_no: Optional[str] = None
    class_id: int
    parent_user_id: Optional[int] = None
