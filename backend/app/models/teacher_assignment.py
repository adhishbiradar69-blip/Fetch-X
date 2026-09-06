from sqlalchemy import Column, Integer, Boolean, ForeignKey, UniqueConstraint
from app.database import Base


class TeacherAssignment(Base):
    """Maps a teacher (a user with the class_teacher role) to a subject they
    teach, optionally scoped to one class of a school.

    Two row kinds are produced by the seeder (and understood by the
    principal dashboard "teacher pills"):

      - Teaching load: one row per (teacher, subject, class) with
        ``class_id`` set. The class-teacher (CT) post is flagged with
        ``is_class_teacher=True`` on the row where the teacher teaches
        their own subject in the class they are responsible for.
      - Department head: one row per (school, subject) with
        ``class_id = NULL`` and ``is_hod=True`` — the HOD of that subject.

    Uniqueness: a teacher can hold at most one assignment for the same
    (school, subject, class) triple. NULL class_id rows (HODs) are exempt
    because SQL UNIQUE treats NULLs as distinct.
    """
    __tablename__ = "teacher_assignments"
    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False, index=True)
    teacher_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    subject_id = Column(Integer, ForeignKey("subjects.id"), nullable=False, index=True)
    class_id = Column(Integer, ForeignKey("classes.id"), nullable=True, index=True)
    is_hod = Column(Boolean, nullable=False, default=False)
    is_class_teacher = Column(Boolean, nullable=False, default=False)
    __table_args__ = (
        UniqueConstraint("school_id", "teacher_user_id", "subject_id", "class_id",
                         name="uq_teacher_assignment"),
    )
