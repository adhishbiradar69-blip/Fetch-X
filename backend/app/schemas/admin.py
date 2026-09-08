from pydantic import BaseModel, Field, field_validator
from typing import Optional, List


class SubjectCreate(BaseModel):
    name: str
    color: Optional[str] = "#6366f1"

    @field_validator("name")
    @classmethod
    def validate_name(cls, v):
        s = (v or "").strip()
        if not s:
            raise ValueError("Name is required")
        if len(s) > 80:
            raise ValueError("Name must be at most 80 characters")
        return s


class GradeSubjectAdd(BaseModel):
    school_id: int
    grade: int
    subject_id: int


class GradeSubjectRange(BaseModel):
    school_id: int
    grade_from: int
    grade_to: int
    subject_ids: List[int]


class ExamCreate(BaseModel):
    school_id: int
    grade: int
    name: str
    max_score: int = Field(gt=0)  # 0/negative breaks every percentage downstream
    term: Optional[str] = None


class ExamRange(BaseModel):
    school_id: int
    grade_from: int
    grade_to: int
    name: str
    max_score: int = Field(gt=0)
    term: Optional[str] = None


class MarkItem(BaseModel):
    student_id: int
    subject_id: int
    score: float

class BulkMarksCreate(BaseModel):
    class_id: int
    exam_id: int
    marks: List[MarkItem]


class AccountCreate(BaseModel):
    """Admin creates a new account (no public registration)."""
    email: str
    password: str
    full_name: Optional[str] = None
    role: str                              # class_teacher | principal | chairperson | parent | school_admin
    school_id: Optional[int] = None        # for principal / school_admin
    assigned_class_id: Optional[int] = None  # for class_teacher
    school_ids: Optional[List[int]] = None  # for chairperson
    student_id: Optional[int] = None       # for parent (links to child)

class AssignBody(BaseModel):
    user_id: int


class ExtraTeacherCreate(BaseModel):
    """Timetable-only subject teacher (never appears in dashboards)."""
    name: str
    subject_id: Optional[int] = None   # academic coverage
    activity: Optional[str] = None     # activity coverage ('games', 'supw', …)
    max_daily: int = Field(default=7, ge=1, le=9)
    school_id: Optional[int] = None    # super_admin targets a specific school

    @field_validator("name")
    @classmethod
    def validate_name(cls, v):
        s = (v or "").strip()
        if not s:
            raise ValueError("Name is required")
        if len(s) > 120:
            raise ValueError("Name must be at most 120 characters")
        return s


class StudentUpdate(BaseModel):
    """v16 admin 'Edit Student' modal (PUT /admin/students/{id}).

    Target class may be given either directly (class_id) or as the
    (grade, section) pair the designer's CLASS (GRADE) + SECTION selects
    produce — if class_id is set it wins, otherwise grade + section must
    both be present and resolve to a class of the student's school.
    """
    name: Optional[str] = None
    class_id: Optional[int] = None
    grade: Optional[int] = None
    section: Optional[str] = None
    notes: Optional[str] = None


class StaffUpdate(BaseModel):
    """v16 admin 'Edit Staff' modal (PUT /admin/staff/{teacher_user_id}).

    - full_name: rename when provided.
    - subject_id: department transfer — every TeacherAssignment row of the
      teacher (their class_id=NULL HOD row + all teaching-load rows) moves
      to the new subject; when omitted the subject is unchanged.
    - ct_class_id: the CLASS TEACHER OF select. An explicit null means
      "— Not a class teacher —" (the post is cleared); a class id claims
      the post and displaces that class's previous CT. Omitted = unchanged.
    - notes: DESCRIPTION & DETAILS textarea (explicit null clears it).
    """
    full_name: Optional[str] = None
    subject_id: Optional[int] = None
    ct_class_id: Optional[int] = None
    notes: Optional[str] = None
