from pydantic import BaseModel, field_validator
from datetime import date
from typing import List, Optional

VALID_STATUSES = {"P", "A", "L"}


class AttendanceMark(BaseModel):
    student_id: int
    status: Optional[str] = None  # null/empty ⇒ UNMARK (record deleted)

    @field_validator("status")
    @classmethod
    def validate_status(cls, v):
        # Only the three real statuses are ever persisted — free-text values
        # previously flowed straight into analytics and broke every average.
        if v is not None and v not in VALID_STATUSES:
            raise ValueError("Status must be one of P, A, L (or null to unmark)")
        return v


class AttendanceBulkCreate(BaseModel):
    class_id: int
    date: date
    marks: List[AttendanceMark]
