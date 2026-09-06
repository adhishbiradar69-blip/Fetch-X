from sqlalchemy import Column, Integer, String, ForeignKey
from app.database import Base


class Exam(Base):
    """Admin-defined exam for a grade in a school. Carries the max score
    (total marks) that the class teacher must enter scores against."""
    __tablename__ = "exams"
    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False)
    grade = Column(Integer, nullable=False)
    name = Column(String, nullable=False)        # e.g. "Midterm", "Unit Test 1"
    max_score = Column(Integer, nullable=False)  # e.g. 100
    term = Column(String, nullable=True)         # e.g. "Term 1"
