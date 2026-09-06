from sqlalchemy import Column, Integer, ForeignKey, UniqueConstraint
from app.database import Base


class GradeSubject(Base):
    """Configures which Subjects are taught for a given grade in a school.
    Admin-controlled: this drives how many subjects a class teacher marks."""
    __tablename__ = "grade_subjects"
    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False)
    grade = Column(Integer, nullable=False)
    subject_id = Column(Integer, ForeignKey("subjects.id"), nullable=False)
    __table_args__ = (UniqueConstraint("school_id", "grade", "subject_id", name="uq_grade_subject"),)
