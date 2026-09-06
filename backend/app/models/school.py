from sqlalchemy import Column, Integer, String
from app.database import Base

class School(Base):
    __tablename__ = "schools"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)