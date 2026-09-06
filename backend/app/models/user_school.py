from sqlalchemy import Column, Integer, ForeignKey
from app.database import Base


class UserSchool(Base):
    """Many-to-many link between a chairperson and the schools they oversee."""
    __tablename__ = "user_schools"
    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    school_id = Column(Integer, ForeignKey("schools.id"), primary_key=True)
