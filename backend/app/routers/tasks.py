from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.task import Task, TaskCompletion
from app.models.student import Student
from app.models.class_ import Class
from app.models.subject import Subject
from app.schemas.task import TaskCreate, TaskStatusUpdate
from app.dependencies import get_current_user, require_role, assert_class_access
from datetime import date

router = APIRouter(prefix="/tasks", tags=["tasks"])
_write = require_role("class_teacher", "super_admin", "school_admin")

_VALID_COMPLETION = {"completed", "pending"}


@router.get("/subjects")
def get_subjects(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return [{"id": s.id, "name": s.name, "color": s.color}
            for s in db.query(Subject).order_by(Subject.id).all()]


@router.post("/")
def create_task(data: TaskCreate, db: Session = Depends(get_db), user=Depends(_write)):
    cls = db.query(Class).filter(Class.id == data.class_id).first()
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found")
    # IDOR guard: can only create tasks for classes you control.
    assert_class_access(user, cls, write=True)
    subject = db.query(Subject).filter(Subject.id == data.subject_id).first()
    if not subject:
        raise HTTPException(status_code=400, detail="Subject not found")
    task = Task(title=data.title.strip(), due_date=data.due_date, class_id=data.class_id,
                subject_id=data.subject_id, assigned_by=user.id)
    db.add(task)
    db.commit()
    db.refresh(task)
    return {"id": task.id, "title": task.title, "class_id": task.class_id,
            "subject_id": task.subject_id}


@router.get("/class/{class_id}")
def get_class_tasks(class_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    cls = db.query(Class).filter(Class.id == class_id).first()
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found")
    # IDOR guard: task lists include student names — scope them like marks.
    assert_class_access(user, cls)

    tasks = db.query(Task).filter(Task.class_id == class_id).order_by(Task.id.desc()).all()
    students = db.query(Student).filter(Student.class_id == class_id).all()
    today = date.today()

    result = []
    for task in tasks:
        subject = db.query(Subject).filter(Subject.id == task.subject_id).first()
        completions = db.query(TaskCompletion).filter(TaskCompletion.task_id == task.id).all()
        comp_map = {c.student_id: c.status for c in completions}

        students_data = []
        for s in students:
            status = comp_map.get(s.id, "pending")
            if task.due_date and task.due_date < today and status == "pending":
                status = "late"
            students_data.append({"id": s.id, "name": s.name, "status": status})

        result.append({
            "task_id": task.id,
            "title": task.title,
            "due_date": str(task.due_date) if task.due_date else None,
            "subject": {"id": subject.id, "name": subject.name, "color": subject.color}
                       if subject else {"id": 0, "name": "General", "color": "#64748b"},
            "students": students_data,
        })
    return result


@router.post("/status")
def update_task_status(data: TaskStatusUpdate, db: Session = Depends(get_db), user=Depends(_write)):
    task = db.query(Task).filter(Task.id == data.task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    cls = db.query(Class).filter(Class.id == task.class_id).first()
    assert_class_access(user, cls, write=True)
    if data.status not in _VALID_COMPLETION:
        raise HTTPException(status_code=400, detail="Status must be 'completed' or 'pending'.")
    student = db.query(Student).filter(Student.id == data.student_id,
                                       Student.class_id == task.class_id).first()
    if not student:
        raise HTTPException(status_code=400, detail="Student does not belong to this task's class.")

    existing = db.query(TaskCompletion).filter(
        TaskCompletion.task_id == data.task_id,
        TaskCompletion.student_id == data.student_id
    ).first()
    if existing:
        existing.status = data.status
    else:
        db.add(TaskCompletion(task_id=data.task_id, student_id=data.student_id, status=data.status))
    db.commit()
    return {"status": "updated"}


@router.delete("/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db), user=Depends(_write)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    cls = db.query(Class).filter(Class.id == task.class_id).first()
    # IDOR guard: teachers/admins can only delete tasks in their own scope.
    assert_class_access(user, cls, write=True)
    db.query(TaskCompletion).filter(TaskCompletion.task_id == task_id).delete()
    db.delete(task)
    db.commit()
    return {"status": "deleted"}
