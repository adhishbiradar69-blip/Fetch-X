from pydantic import BaseModel
from datetime import date
from typing import List, Optional

class AttendanceMark(BaseModel):
    student_id: int
    status: Optional[str] = None  # null/empty ⇒ UNMARK (record deleted)

class AttendanceBulkCreate(BaseModel):
    class_id: int
    date: date
    marks: List[AttendanceMark]