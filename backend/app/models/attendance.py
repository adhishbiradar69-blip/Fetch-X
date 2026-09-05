from sqlalchemy import Column, Integer, String, Date, ForeignKey
from app.database import Base

class Attendance(Base):
    __tablename__ = "attendance"
    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False, index=True)
    date = Column(Date, nullable=False)
    status = Column(String, nullable=False)  # P, A, L
    marked_by = Column(Integer, ForeignKey("users.id"), nullable=True)