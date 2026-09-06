from sqlalchemy import Column, Integer, String, ForeignKey
from app.database import Base


class Class(Base):
    __tablename__ = "classes"
    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False)
    grade = Column(Integer, nullable=False)            # 1 - 10
    section = Column(String, nullable=False)          # A, B, C ...
    class_teacher_id = Column(Integer, ForeignKey("users.id"), nullable=True)
