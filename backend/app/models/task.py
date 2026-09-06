from sqlalchemy import Column, Integer, String, Date, ForeignKey
from app.database import Base

class Task(Base):
    __tablename__ = "tasks"
    id = Column(Integer, primary_key=True, index=True)
    subject_id = Column(Integer, ForeignKey("subjects.id"), nullable=False)
    title = Column(String, nullable=False)
    due_date = Column(Date, nullable=True)
    # v15 designer update: tasks are grouped per term in the class teacher's
    # console (1/2/3); NULL = unassigned (shown in every list as Term 1)
    term = Column(Integer, nullable=True)
    assigned_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    class_id = Column(Integer, ForeignKey("classes.id"), nullable=False, index=True)

class TaskCompletion(Base):
    __tablename__ = "task_completions"
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False, index=True)
    status = Column(String, nullable=False)