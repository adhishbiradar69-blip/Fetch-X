from sqlalchemy import Column, Integer, String, ForeignKey, Text
from app.database import Base


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    full_name = Column(String, nullable=True)
    role = Column(String, nullable=False, default="class_teacher")
    # principal -> the school they manage
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=True)
    # class_teacher -> the class they teach
    assigned_class_id = Column(Integer, ForeignKey("classes.id"), nullable=True)
    # v16 admin data-management: staff "DESCRIPTION & DETAILS" text.
    # Added to existing SQLite DBs by admin.ensure_notes_columns() at startup.
    notes = Column(Text, nullable=True)
