from pydantic import BaseModel, field_validator
from datetime import date
from typing import Optional

VALID_COMPLETION = {"completed", "pending"}


class TaskCreate(BaseModel):
    title: str
    due_date: Optional[date] = None
    class_id: int
    subject_id: int
    term: Optional[int] = None  # v15: 1..3

    @field_validator("title")
    @classmethod
    def validate_title(cls, v):
        s = (v or "").strip()
        if not s:
            raise ValueError("Title is required")
        if len(s) > 200:
            raise ValueError("Title must be at most 200 characters")
        return s


class TaskStatusUpdate(BaseModel):
    task_id: int
    student_id: int
    status: str

    @field_validator("status")
    @classmethod
    def validate_status(cls, v):
        if v not in VALID_COMPLETION:
            raise ValueError("Status must be 'completed' or 'pending'")
        return v
