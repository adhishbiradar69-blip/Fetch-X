from sqlalchemy import Column, Integer, Float, ForeignKey
from app.database import Base


class Mark(Base):
    """A single score for a student in a subject for a given exam.
    The exam (admin-defined) carries the name / max_score / term."""
    __tablename__ = "marks"
    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False, index=True)
    subject_id = Column(Integer, ForeignKey("subjects.id"), nullable=False, index=True)
    exam_id = Column(Integer, ForeignKey("exams.id"), nullable=False, index=True)
    score = Column(Float, nullable=False)
