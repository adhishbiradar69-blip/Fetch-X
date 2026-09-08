from sqlalchemy import Column, Integer, String, ForeignKey, Text
from app.database import Base

class Student(Base):
    __tablename__ = "students"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    roll_no = Column(String, nullable=True)
    class_id = Column(Integer, ForeignKey("classes.id"), index=True)
    parent_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    # v16 admin data-management: free-form "DESCRIPTION & DETAILS" text.
    # Added to existing SQLite DBs by admin.ensure_notes_columns() at startup.
    notes = Column(Text, nullable=True)