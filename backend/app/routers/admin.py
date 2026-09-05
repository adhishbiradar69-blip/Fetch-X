from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import date, timedelta, datetime, timezone
import random
from passlib.context import CryptContext

from app.database import get_db
from app.models.school import School
from app.models.class_ import Class
from app.models.student import Student
from app.models.user import User
from app.models.user_school import UserSchool
from app.models.attendance import Attendance
from app.models.mark import Mark
from app.models.subject import Subject
from app.models.grade_subject import GradeSubject
from app.models.exam import Exam
from app.models.task import Task, TaskCompletion
from app.models.teacher_assignment import TeacherAssignment
from app.schemas.student import SchoolCreate, ClassCreate, StudentCreate
from app.schemas.admin import (
    SubjectCreate, GradeSubjectAdd, ExamCreate, AccountCreate, AssignBody,
    GradeSubjectRange, ExamRange,
)
from app.dependencies import (
    get_current_user, require_role, require_super_admin, require_school_admin,
    assert_school_access,
)
from app.routers.auth import get_password_hash, _validate_email

router = APIRouter(prefix="/admin", tags=["admin"])
pwd = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


# ─────────────────────────────────────────────────────────────────────────────
# Audit logging (Task 10)
# ─────────────────────────────────────────────────────────────────────────────
# Every sensitive admin action (account creation, deletion, role assignment,
# full re-seed) prints a structured line to stdout with an ISO-8601 UTC
# timestamp, the acting user's email, and the action + target. This is the
# minimum bar for an audit trail; in production we'd forward this to a SIEM
# or a dedicated audit table, but for now stdout (which Render captures) is
# enough to satisfy the "every sensitive action is logged" requirement.
def _audit(actor_email: str, action: str, **details) -> None:
    ts = datetime.now(timezone.utc).isoformat(timespec="seconds")
    # Mask any obviously sensitive payload fields so we never log a password
    # hash in cleartext. (None of the callers pass one today, but this is
    # defence-in-depth.)
    safe = {k: ("***" if k in {"password", "hashed_password"} else v)
            for k, v in details.items() if v is not None}
    print(f'[AUDIT] {ts} actor={actor_email!r} action={action!r} {safe}', flush=True)


# ──────────────────────────────────────────────────────────────
# SCHOOLS  — super_admin only (create / delete). list is open.
# ──────────────────────────────────────────────────────────────
@router.post("/schools")
def create_school(data: SchoolCreate, db: Session = Depends(get_db), user=Depends(require_super_admin)):
    school = School(name=data.name)
    db.add(school)
    db.commit()
    db.refresh(school)
    return {"id": school.id, "name": school.name}


@router.get("/schools")
def list_schools(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return [{"id": s.id, "name": s.name} for s in db.query(School).order_by(School.id).all()]


@router.delete("/schools/{school_id}")
def delete_school(school_id: int, db: Session = Depends(get_db), user=Depends(require_super_admin)):
    s = db.query(School).filter(School.id == school_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="School not found")
    # cascade clean-up of children
    class_ids = [c.id for c in db.query(Class).filter(Class.school_id == school_id).all()]
    if class_ids:
        student_ids = [st.id for st in db.query(Student).filter(Student.class_id.in_(class_ids)).all()]
        if student_ids:
            db.query(Attendance).filter(Attendance.student_id.in_(student_ids)).delete(synchronize_session=False)
            db.query(Mark).filter(Mark.student_id.in_(student_ids)).delete(synchronize_session=False)
            db.query(Student).filter(Student.id.in_(student_ids)).delete(synchronize_session=False)
        db.query(Class).filter(Class.id.in_(class_ids)).delete(synchronize_session=False)
    db.query(Exam).filter(Exam.school_id == school_id).delete(synchronize_session=False)
    db.query(GradeSubject).filter(GradeSubject.school_id == school_id).delete(synchronize_session=False)
    db.query(UserSchool).filter(UserSchool.school_id == school_id).delete(synchronize_session=False)
    db.delete(s)
    db.commit()
    return {"status": "deleted", "school_id": school_id}


# ──────────────────────────────────────────────────────────────
# CLASSES
# ──────────────────────────────────────────────────────────────
@router.post("/classes")
def create_class(data: ClassCreate, db: Session = Depends(get_db), user=Depends(require_school_admin)):
    school = db.query(School).filter(School.id == data.school_id).first()
    if not school:
        raise HTTPException(status_code=404, detail="School not found")
    assert_school_access(user, data.school_id)
    cls = Class(school_id=data.school_id, grade=data.grade, section=data.section)
    db.add(cls)
    db.commit()
    db.refresh(cls)
    return {"id": cls.id, "school_id": cls.school_id, "grade": cls.grade, "section": cls.section,
            "class_teacher_id": cls.class_teacher_id}


@router.get("/classes")
def list_classes(db: Session = Depends(get_db), user=Depends(get_current_user)):
    rows = db.query(Class).order_by(Class.school_id, Class.grade, Class.section).all()
    out = []
    for c in rows:
        teacher = db.query(User).filter(User.id == c.class_teacher_id).first()
        out.append({
            "id": c.id, "school_id": c.school_id, "grade": c.grade, "section": c.section,
            "label": f"Grade {c.grade}-{c.section}",
            "class_teacher": {"id": teacher.id, "name": teacher.full_name or teacher.email} if teacher else None,
        })
    return out


@router.get("/classes/school/{school_id}")
def list_classes_by_school(school_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    rows = db.query(Class).filter(Class.school_id == school_id).order_by(Class.grade, Class.section).all()
    return [{"id": c.id, "grade": c.grade, "section": c.section, "label": f"Grade {c.grade}-{c.section}"}
            for c in rows]


# ──────────────────────────────────────────────────────────────
# STUDENTS
# ──────────────────────────────────────────────────────────────
@router.post("/students")
def create_student(data: StudentCreate, db: Session = Depends(get_db), user=Depends(require_school_admin)):
    cls = db.query(Class).filter(Class.id == data.class_id).first()
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found")
    assert_school_access(user, cls.school_id)
    student = Student(name=data.name, roll_no=data.roll_no, class_id=data.class_id,
                      parent_user_id=data.parent_user_id)
    db.add(student)
    db.commit()
    db.refresh(student)
    return {"id": student.id, "name": student.name, "class_id": student.class_id}


@router.get("/students/class/{class_id}")
def list_students_in_class(class_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    rows = db.query(Student).filter(Student.class_id == class_id).order_by(Student.roll_no).all()
    return [{"id": s.id, "name": s.name, "roll_no": s.roll_no,
             "parent_user_id": s.parent_user_id} for s in rows]


# ──────────────────────────────────────────────────────────────
# SUBJECTS + GRADE-SUBJECT CONFIG
# ──────────────────────────────────────────────────────────────
@router.post("/subjects")
def create_subject(data: SubjectCreate, db: Session = Depends(get_db), user=Depends(require_super_admin)):
    sub = Subject(name=data.name, color=data.color)
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return {"id": sub.id, "name": sub.name, "color": sub.color}


@router.get("/subjects")
def list_subjects(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return [{"id": s.id, "name": s.name, "color": s.color} for s in db.query(Subject).order_by(Subject.id).all()]


@router.post("/grade-subjects")
def add_grade_subject(data: GradeSubjectAdd, db: Session = Depends(get_db), user=Depends(require_school_admin)):
    assert_school_access(user, data.school_id)
    existing = db.query(GradeSubject).filter(
        GradeSubject.school_id == data.school_id,
        GradeSubject.grade == data.grade,
        GradeSubject.subject_id == data.subject_id,
    ).first()
    if existing:
        return {"status": "exists"}
    gs = GradeSubject(school_id=data.school_id, grade=data.grade, subject_id=data.subject_id)
    db.add(gs)
    db.commit()
    return {"status": "added"}


@router.delete("/grade-subjects")
def remove_grade_subject(school_id: int, grade: int, subject_id: int,
                         db: Session = Depends(get_db), user=Depends(require_school_admin)):
    assert_school_access(user, school_id)
    db.query(GradeSubject).filter(
        GradeSubject.school_id == school_id,
        GradeSubject.grade == grade,
        GradeSubject.subject_id == subject_id,
    ).delete()
    db.commit()
    return {"status": "removed"}


@router.get("/grade-subjects/{school_id}/{grade}")
def list_grade_subjects(school_id: int, grade: int, db: Session = Depends(get_db),
                        user=Depends(get_current_user)):
    rows = db.query(GradeSubject).filter(
        GradeSubject.school_id == school_id, GradeSubject.grade == grade
    ).all()
    out = []
    for gs in rows:
        sub = db.query(Subject).filter(Subject.id == gs.subject_id).first()
        if sub:
            out.append({"id": sub.id, "name": sub.name, "color": sub.color})
    return out


# ── RANGE: assign multiple subjects to a grade range ──
@router.post("/grade-subjects/range")
def grade_subjects_range(body: GradeSubjectRange, db: Session = Depends(get_db),
                         user=Depends(require_school_admin)):
    assert_school_access(user, body.school_id)
    if body.grade_from < 1 or body.grade_to > 10 or body.grade_from > body.grade_to:
        raise HTTPException(status_code=400, detail="Invalid grade range")
    created = 0
    for grade in range(body.grade_from, body.grade_to + 1):
        for sid in body.subject_ids:
            existing = db.query(GradeSubject).filter(
                GradeSubject.school_id == body.school_id,
                GradeSubject.grade == grade,
                GradeSubject.subject_id == sid,
            ).first()
            if not existing:
                db.add(GradeSubject(school_id=body.school_id, grade=grade, subject_id=sid))
                created += 1
    db.commit()
    return {"status": "ok", "created": created}


# ──────────────────────────────────────────────────────────────
# EXAMS
# ──────────────────────────────────────────────────────────────
@router.post("/exams")
def create_exam(data: ExamCreate, db: Session = Depends(get_db), user=Depends(require_school_admin)):
    assert_school_access(user, data.school_id)
    exam = Exam(school_id=data.school_id, grade=data.grade, name=data.name,
                max_score=data.max_score, term=data.term)
    db.add(exam)
    db.commit()
    db.refresh(exam)
    return {"id": exam.id, "name": exam.name, "max_score": exam.max_score,
            "grade": exam.grade, "term": exam.term}


@router.get("/exams")
def list_exams(school_id: int, grade: int, db: Session = Depends(get_db),
               user=Depends(get_current_user)):
    rows = db.query(Exam).filter(Exam.school_id == school_id, Exam.grade == grade).order_by(Exam.id).all()
    return [{"id": e.id, "name": e.name, "max_score": e.max_score, "term": e.term,
             "grade": e.grade, "school_id": e.school_id} for e in rows]


# ── RANGE: create an exam for all grades in a range ──
@router.post("/exams/range")
def exams_range(body: ExamRange, db: Session = Depends(get_db),
                user=Depends(require_school_admin)):
    assert_school_access(user, body.school_id)
    if body.grade_from < 1 or body.grade_to > 10 or body.grade_from > body.grade_to:
        raise HTTPException(status_code=400, detail="Invalid grade range")
    created = 0
    for grade in range(body.grade_from, body.grade_to + 1):
        db.add(Exam(school_id=body.school_id, grade=grade, name=body.name,
                    max_score=body.max_score, term=body.term))
        created += 1
    db.commit()
    return {"status": "ok", "created": created}


# ──────────────────────────────────────────────────────────────
# ACCOUNT CREATION — super_admin only
# ──────────────────────────────────────────────────────────────
@router.post("/accounts")
def create_account(data: AccountCreate, db: Session = Depends(get_db), user=Depends(require_super_admin)):
    _validate_email(data.email)
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    valid_roles = {"class_teacher", "principal", "chairperson", "parent", "school_admin"}
    if data.role not in valid_roles:
        raise HTTPException(status_code=400, detail=f"Role must be one of {valid_roles}")

    new_user = User(
        email=data.email,
        hashed_password=get_password_hash(data.password),
        full_name=data.full_name,
        role=data.role,
        school_id=data.school_id if data.role in ("principal", "school_admin") else None,
        assigned_class_id=data.assigned_class_id if data.role == "class_teacher" else None,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    if data.role == "chairperson" and data.school_ids:
        for sid in data.school_ids:
            db.add(UserSchool(user_id=new_user.id, school_id=sid))
        db.commit()

    if data.role == "parent" and data.student_id:
        student = db.query(Student).filter(Student.id == data.student_id).first()
        if student:
            student.parent_user_id = new_user.id
            db.commit()

    _audit(
        user.email, "account.create",
        target_user_id=new_user.id, target_email=new_user.email,
        role=new_user.role, school_id=new_user.school_id,
        assigned_class_id=new_user.assigned_class_id,
    )
    return {"id": new_user.id, "email": new_user.email, "role": new_user.role,
            "full_name": new_user.full_name}


@router.get("/accounts")
def list_accounts(db: Session = Depends(get_db), user=Depends(require_school_admin)):
    q = db.query(User).order_by(User.id)
    # school_admin only sees their own school's accounts
    if user.role == "school_admin":
        q = q.filter(User.school_id == user.school_id)
    rows = q.all()
    out = []
    for u in rows:
        item = {"id": u.id, "email": u.email, "role": u.role, "full_name": u.full_name,
                "school_id": u.school_id, "assigned_class_id": u.assigned_class_id}
        if u.role == "chairperson":
            links = db.query(UserSchool).filter(UserSchool.user_id == u.id).all()
            item["school_ids"] = [l.school_id for l in links]
        out.append(item)
    return out


@router.delete("/accounts/{user_id}")
def delete_account(user_id: int, db: Session = Depends(get_db), current=Depends(require_super_admin)):
    if user_id == current.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account.")
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="Account not found")
    target_email = u.email
    target_role = u.role
    db.query(UserSchool).filter(UserSchool.user_id == user_id).delete()
    db.delete(u)
    db.commit()
    _audit(
        current.email, "account.delete",
        target_user_id=user_id, target_email=target_email, target_role=target_role,
    )
    return {"status": "deleted"}


# ──────────────────────────────────────────────────────────────
# ASSIGNMENTS — super_admin only (cross-school)
# ──────────────────────────────────────────────────────────────
@router.post("/assign/class-teacher")
def assign_class_teacher(body: AssignBody, class_id: int, db: Session = Depends(get_db),
                         user=Depends(require_school_admin)):
    u = db.query(User).filter(User.id == body.user_id).first()
    cls = db.query(Class).filter(Class.id == class_id).first()
    if not u or not cls:
        raise HTTPException(status_code=404, detail="User or class not found")
    assert_school_access(user, cls.school_id)
    cls.class_teacher_id = u.id
    u.assigned_class_id = cls.id
    db.commit()
    return {"status": "assigned", "user_id": u.id, "class_id": cls.id}


@router.post("/assign/principal")
def assign_principal(body: AssignBody, school_id: int, db: Session = Depends(get_db),
                     user=Depends(require_super_admin)):
    u = db.query(User).filter(User.id == body.user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    u.school_id = school_id
    db.commit()
    _audit(
        user.email, "role.assign_principal",
        target_user_id=u.id, target_email=u.email, school_id=school_id,
    )
    return {"status": "assigned", "user_id": u.id, "school_id": school_id}


@router.post("/assign/chairperson")
def assign_chairperson(body: AssignBody, db: Session = Depends(get_db),
                      user=Depends(require_super_admin), school_ids: str = ""):
    u = db.query(User).filter(User.id == body.user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    db.query(UserSchool).filter(UserSchool.user_id == u.id).delete()
    ids = [int(x) for x in school_ids.split(",") if x.strip().isdigit()]
    for sid in ids:
        db.add(UserSchool(user_id=u.id, school_id=sid))
    db.commit()
    _audit(
        user.email, "role.assign_chairperson",
        target_user_id=u.id, target_email=u.email, school_ids=ids,
    )
    return {"status": "assigned", "user_id": u.id, "school_ids": ids}


# ──────────────────────────────────────────────────────────────
# SIMPLE SEED (creates Greenwood High + 1 class)
# Accepts super_admin OR school_admin. school_admin uses their own school_id.
# ──────────────────────────────────────────────────────────────
@router.post("/seed")
def seed_data(db: Session = Depends(get_db), user=Depends(require_school_admin)):
    if user.role == "school_admin":
        school = db.query(School).filter(School.id == user.school_id).first() if user.school_id else None
        if not school:
            raise HTTPException(status_code=400, detail="No school assigned to your account.")
    else:
        school = School(name="Greenwood High")
        db.add(school)
        db.commit()
        db.refresh(school)

    cls = Class(school_id=school.id, grade=10, section="B")
    db.add(cls)
    db.commit()
    db.refresh(cls)

    if user.role == "super_admin":
        db_user = db.query(User).filter(User.id == user.id).first()
        if db_user:
            db_user.assigned_class_id = cls.id
            db.commit()

    subjects = [
        Subject(name="Mathematics", color="#6366f1"),
        Subject(name="Science", color="#10b981"),
        Subject(name="English", color="#f59e0b"),
        Subject(name="Hindi", color="#ef4444"),
        Subject(name="Social Science", color="#8b5cf6"),
        Subject(name="Computer", color="#0ea5e9"),
    ]
    for sub in subjects:
        db.add(sub)
    db.commit()
    for sub in subjects:
        db.add(GradeSubject(school_id=school.id, grade=10, subject_id=sub.id))
    db.commit()

    exams = [
        Exam(school_id=school.id, grade=10, name="Midterm", max_score=100, term="Term 1"),
        Exam(school_id=school.id, grade=10, name="Unit Test 1", max_score=50, term="Term 1"),
    ]
    for e in exams:
        db.add(e)
    db.commit()

    first_names = ["Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Sai", "Arnav", "Ayaan",
                   "Krishna", "Ishaan", "Shaurya", "Atharv", "Aarush", "Kabir", "Darsh",
                   "Ananya", "Diya", "Saanvi", "Aadhya", "Navya", "Myra", "Pari", "Kavya",
                   "Sara", "Ira", "Aaradhya", "Meera", "Tara", "Riya", "Jiya"]
    students = []
    for i, name in enumerate(first_names, 1):
        s = Student(name=f"{name} Kumar", roll_no=str(i), class_id=cls.id)
        db.add(s)
        students.append(s)
    db.commit()

    today = date.today()
    statuses = ["P", "P", "P", "P", "A", "P", "P", "L", "P", "P"]
    for s in students:
        db.add(Attendance(student_id=s.id, date=today, status=random.choice(statuses), marked_by=user.id))
        for exam in exams:
            for sub in subjects:
                db.add(Mark(student_id=s.id, subject_id=sub.id, exam_id=exam.id,
                            score=round(random.uniform(0.4, 0.98) * exam.max_score, 1)))
    db.commit()
    return {"school_id": school.id, "class_id": cls.id, "students_created": len(students)}


# ──────────────────────────────────────────────────────────────
# FULL SEED — rich dataset (3 schools, 45 classes, ~1125 students)
# ──────────────────────────────────────────────────────────────
FIRST_NAMES = [
    "Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Sai", "Arnav", "Ayaan",
    "Krishna", "Ishaan", "Shaurya", "Atharv", "Aarush", "Kabir", "Darsh",
    "Reyansh", "Krish", "Aryan", "Rohan", "Rudra", "Sai", "Ved", "Dhruv",
    "Kabir", "Yash",
    "Ananya", "Diya", "Saanvi", "Aadhya", "Navya", "Myra", "Pari", "Kavya",
    "Sara", "Ira", "Aaradhya", "Meera", "Tara", "Riya", "Jiya",
    "Anika", "Naina", "Aditi", "Zara", "Diya", "Avni", "Aanya", "Ira",
    "Riya", "Sara",
]
SURNAMES = ["Kumar", "Sharma", "Singh", "Patel", "Reddy", "Nair", "Iyer", "Gupta", "Das", "Bose"]

SUBJECTS_DEF = [
    ("Mathematics", "#6366f1"),
    ("Science", "#10b981"),
    ("English", "#f59e0b"),
    ("Hindi", "#ef4444"),
    ("Social Science", "#8b5cf6"),
    ("Computer", "#0ea5e9"),
    ("Sanskrit", "#ec4899"),
    ("General Knowledge", "#14b8a6"),
]
# Subjects per grade band. 1-5 get 6 subjects, 6-10 get all 8.
GRADES_1_5_SUBJECTS = ["Mathematics", "English", "Hindi", "Science", "General Knowledge", "Computer"]

# Designer-specified house sections (Principal Dashboard: "10-Sapphire" etc.)
SECTION_NAMES = ["Sapphire", "Emerald", "Ruby"]

# The 6 core subjects that get a full teacher department (5 teachers each).
# Index 0 of each subject department is the HOD.
TEACHER_SUBJECT_NAMES = ["Mathematics", "Science", "English", "Hindi",
                         "Social Science", "Computer"]
TEACHERS_PER_SUBJECT = 5

TEACHER_NAMES = [
    "Priya Sharma", "Rahul Verma", "Anjali Mehta", "Suresh Iyer", "Kavitha Reddy",
    "Deepak Joshi", "Meera Nair", "Arvind Gupta", "Lata Pillai", "Ramesh Rao",
    "Neha Kulkarni", "Vikram Singh", "Shanti Devi", "Rajesh Menon", "Pooja Bhatt",
    "Anil Kapoor", "Geeta Rao", "Mohit Jain", "Sunita Bose", "Kiran Desai",
    "Farhan Khan", "Lakshmi Subramanian", "Harish Patel", "Divya Saxena", "Manoj Tiwari",
    "Rekha Nambiar", "Sanjay Chopra", "Aarti Pandey", "Naveen Kumar", "Swati Mishra",
]

TASK_TITLES = [
    "Chapter Review Worksheet", "Problem Set Practice", "Reading Comprehension",
    "Science Lab Report", "Group Project Draft", "Essay Assignment",
    "Quiz Preparation", "Practice Homework Sheet",
]

# Mild improvement trend: Term 3 >= Term 2 >= Term 1 on average.
# Offsets are added to the gaussian draw (0-1 scale) BEFORE clamping.
TERM_OFFSETS = {1: 0.00, 2: 0.03, 3: 0.06}

# Attendance distribution: 88% present / 7% late / 5% absent.
ATT_WEIGHTS = (0.88, 0.95)  # P if r < 0.88, L if r < 0.95, else A

# Bulk-insert buffer threshold (rows) — keeps seed time sane on SQLite.
BULK_BUFFER = 5000


def _wipe_all(db: Session, keep_user_id: int):
    """Delete every row except the calling super_admin account.

    Order matters: child tables (TaskCompletion, TeacherAssignment, Mark,
    Attendance) are wiped before their parents (Task, Student, Class, ...).
    """
    db.query(Mark).delete()
    db.query(Attendance).delete()
    db.query(TaskCompletion).delete()
    db.query(Task).delete()
    db.query(TeacherAssignment).delete()
    db.query(Student).delete()
    db.query(Exam).delete()
    db.query(GradeSubject).delete()
    db.query(Class).delete()
    db.query(Subject).delete()
    db.query(UserSchool).delete()
    db.query(School).delete()
    # Wipe all users except the calling super_admin.
    db.query(User).filter(User.id != keep_user_id).delete()
    db.commit()


@router.post("/seed-full")
def seed_full(db: Session = Depends(get_db), user=Depends(require_super_admin)):
    """Full designer-spec seed. Wipes everything except the calling super_admin.

    Per school (Greenwood High / Sunrise Public School / Radiant International
    Academy):
      - 30 classes: grades 1-10 x house sections Sapphire/Emerald/Ruby
      - GradeSubjects: grades 1-5 -> 6 subjects, grades 6-10 -> all 8
      - 30 students per class (900)
      - 6 exams per grade: 2 per term x 3 terms ("Term 1".."Term 3"),
        max_score 100 (Midterm) / 50 (Final) alternating
      - Marks: student x grade-subjects x 6 exams, gaussian ~65% sigma 13
        clamp 5-99 with +0%/+3%/+6% term offsets (T3 >= T2 >= T1 trend)
      - Attendance: every school day (Mon-Fri) of the last 90 calendar days,
        88% P / 7% L / 5% A, marked_by the class teacher
      - 4 tasks per class + TaskCompletion rows (~70% completed)
      - TeacherAssignment: 5 class_teacher users per core subject (6 -> 30),
        index 0 = HOD, classes distributed round-robin (6 classes each);
        class ci's CT post goes to teacher slot (ci % 5) of subject (ci % 6)
      - 1 parent account linked to the first student of the first class
    """
    _audit(user.email, "seed_full.start", note="wiping all data + reseeding")
    _wipe_all(db, keep_user_id=user.id)

    schools_data = ["Greenwood High", "Sunrise Public School", "Radiant International Academy"]
    schools = []
    for name in schools_data:
        s = School(name=name)
        db.add(s)
        schools.append(s)
    db.flush()  # get IDs

    # Subjects (global)
    subject_objs = {name: Subject(name=name, color=color) for name, color in SUBJECTS_DEF}
    for sub in subject_objs.values():
        db.add(sub)
    db.flush()
    # Build name -> id
    subject_id = {name: sub.id for name, sub in subject_objs.items()}

    # School days (Mon-Fri) within the last 90 calendar days, chronological.
    today = date.today()
    school_days = []
    for off in range(90):
        d = today - timedelta(days=off)
        if d.weekday() < 5:  # 0-4 = Mon-Fri
            school_days.append(d)
    school_days.reverse()
    att_cut_1, att_cut_2 = ATT_WEIGHTS

    total_classes = 0
    total_students = 0
    total_exams = 0
    total_marks = 0
    total_attendance = 0
    total_tasks = 0
    total_task_completions = 0
    total_teacher_assignments = 0
    total_teachers = 0
    total_parents = 0
    total_accounts = 0

    school_admins = []
    principals = []
    first_class_id = None

    for school in schools:
        school_prefix = school.name.split()[0].lower()

        # ── Classes: grades 1-10 x 3 house sections ─────────────────────────
        school_classes = []  # list of (class_obj, grade, section)
        for grade in range(1, 11):
            for section in SECTION_NAMES:
                cls = Class(school_id=school.id, grade=grade, section=section)
                db.add(cls)
                school_classes.append((cls, grade, section))
        db.flush()
        if first_class_id is None and school_classes:
            first_class_id = school_classes[0][0].id
        total_classes += len(school_classes)

        # ── GradeSubject: grades 1-5 get 6 subjects; grades 6-10 get all 8 ──
        grade_subject_objs = []
        for grade in range(1, 11):
            subject_names = GRADES_1_5_SUBJECTS if grade <= 5 else list(subject_id.keys())
            for sname in subject_names:
                grade_subject_objs.append(
                    GradeSubject(school_id=school.id, grade=grade, subject_id=subject_id[sname])
                )
        db.add_all(grade_subject_objs)
        db.flush()

        # ── Teacher department: 5 class_teacher users per core subject ──────
        teachers_by_subject = []  # index si -> list of 5 User objects
        for si, sname in enumerate(TEACHER_SUBJECT_NAMES):
            dept = []
            for t in range(TEACHERS_PER_SUBJECT):
                n = si * TEACHERS_PER_SUBJECT + t + 1
                u = User(
                    email=f"teacher{n}.{school_prefix}@schoolai.test",
                    hashed_password=get_password_hash("teacher123"),
                    full_name=TEACHER_NAMES[(si * TEACHERS_PER_SUBJECT + t) % len(TEACHER_NAMES)],
                    role="class_teacher",
                    school_id=school.id,
                )
                db.add(u)
                dept.append(u)
                total_accounts += 1
                total_teachers += 1
            db.flush()
            teachers_by_subject.append(dept)
        db.flush()

        # TeacherAssignment: subject si covers every class, round-robin over
        # its 5 teachers (teacher slot = ci % 5) -> each teacher teaches 6
        # classes of exactly one subject; slot 0 is the HOD.
        for si, sname in enumerate(TEACHER_SUBJECT_NAMES):
            dept = teachers_by_subject[si]
            for ci, (cls, _g, _s) in enumerate(school_classes):
                db.add(TeacherAssignment(
                    school_id=school.id,
                    teacher_user_id=dept[ci % TEACHERS_PER_SUBJECT].id,
                    subject_id=subject_id[sname],
                    class_id=cls.id,
                    is_hod=(ci % TEACHERS_PER_SUBJECT == 0),
                ))
        total_teacher_assignments += len(TEACHER_SUBJECT_NAMES) * len(school_classes)
        db.flush()

        # Class-teacher posts: class ci -> teacher of subject (ci % 6), slot
        # (ci % 5). Every class gets exactly one CT; every teacher ends with
        # exactly one CT post.
        for ci, (cls, _g, _s) in enumerate(school_classes):
            teacher = teachers_by_subject[ci % len(TEACHER_SUBJECT_NAMES)][ci % TEACHERS_PER_SUBJECT]
            cls.class_teacher_id = teacher.id
            teacher.assigned_class_id = cls.id
        db.flush()

        # ── Accounts: school_admin + principal (existing behavior) ─────────
        sa_email = f"{school_prefix}@admin.test"
        sa_user = User(
            email=sa_email,
            hashed_password=get_password_hash("school123"),
            full_name=f"{school.name} Admin",
            role="school_admin",
            school_id=school.id,
        )
        db.add(sa_user)
        db.flush()
        school_admins.append(sa_user)
        total_accounts += 1

        # school_admin also stays CT of the first class (kept behavior).
        # The displaced teacher loses the CT post (but keeps teaching it).
        if school_classes:
            first_cls = school_classes[0][0]
            prev_ct_id = first_cls.class_teacher_id
            first_cls.class_teacher_id = sa_user.id
            sa_user.assigned_class_id = first_cls.id
            if prev_ct_id:
                prev_teacher = db.query(User).filter(User.id == prev_ct_id).first()
                if prev_teacher and prev_teacher.assigned_class_id == first_cls.id:
                    prev_teacher.assigned_class_id = None
            db.commit()

        p_email = f"principal@{school_prefix}.test"
        p_user = User(
            email=p_email,
            hashed_password=get_password_hash("principal123"),
            full_name=f"Principal {school.name}",
            role="principal",
            school_id=school.id,
        )
        db.add(p_user)
        db.flush()
        principals.append(p_user)
        total_accounts += 1
        db.commit()

        # ── Exams: 6 per grade = 2 per term x 3 terms ───────────────────────
        school_exams = []  # (exam_obj, grade, max_score, term_no)
        for grade in range(1, 11):
            for term_no in (1, 2, 3):
                ex_mid = Exam(school_id=school.id, grade=grade,
                              name=f"Term {term_no} Midterm",
                              max_score=100, term=f"Term {term_no}")
                ex_fin = Exam(school_id=school.id, grade=grade,
                              name=f"Term {term_no} Final",
                              max_score=50, term=f"Term {term_no}")
                db.add(ex_mid)
                db.add(ex_fin)
                school_exams.append((ex_mid, grade, 100, term_no))
                school_exams.append((ex_fin, grade, 50, term_no))
        db.flush()
        total_exams += len(school_exams)

        # ── Students (30 per class) + Marks + Attendance ────────────────────
        mark_buf = []
        att_buf = []
        class_students_map = {}
        for (cls, grade, section) in school_classes:
            gs_subject_ids = []
            if grade <= 5:
                gs_subject_ids = [subject_id[n] for n in GRADES_1_5_SUBJECTS]
            else:
                gs_subject_ids = [subject_id[n] for n in subject_id.keys()]

            grade_exams = [(e, mx, tn) for (e, g, mx, tn) in school_exams if g == grade]
            ct_id = cls.class_teacher_id

            student_objs = []
            for i in range(1, 31):
                first = FIRST_NAMES[(total_students + i) % len(FIRST_NAMES)]
                surname = SURNAMES[(total_students + i) % len(SURNAMES)]
                name = f"{first} {surname}"
                s = Student(name=name, roll_no=str(i), class_id=cls.id)
                db.add(s)
                student_objs.append(s)
            db.flush()
            total_students += len(student_objs)
            class_students_map[cls.id] = student_objs

            for s in student_objs:
                # Marks: grade subjects x 6 exams, gaussian ~65% sigma 13,
                # clamp 5-99, +3%/+6% term offsets before clamping.
                for sid in gs_subject_ids:
                    for (ex, mx, tn) in grade_exams:
                        base = random.gauss(0.65, 0.13) + TERM_OFFSETS[tn]
                        base = max(0.05, min(0.99, base))
                        mark_buf.append(Mark(student_id=s.id, subject_id=sid,
                                             exam_id=ex.id, score=round(base * mx, 1)))
                # Attendance: every school day of the last 90 calendar days,
                # 88% P / 7% L / 5% A, marked by the class teacher.
                for day in school_days:
                    r = random.random()
                    status = "P" if r < att_cut_1 else ("L" if r < att_cut_2 else "A")
                    att_buf.append(Attendance(student_id=s.id, date=day,
                                              status=status, marked_by=ct_id))

            if len(mark_buf) >= BULK_BUFFER or len(att_buf) >= BULK_BUFFER:
                if mark_buf:
                    db.bulk_save_objects(mark_buf)
                    total_marks += len(mark_buf)
                    mark_buf = []
                if att_buf:
                    db.bulk_save_objects(att_buf)
                    total_attendance += len(att_buf)
                    att_buf = []
                db.commit()

        if mark_buf or att_buf:
            if mark_buf:
                db.bulk_save_objects(mark_buf)
                total_marks += len(mark_buf)
                mark_buf = []
            if att_buf:
                db.bulk_save_objects(att_buf)
                total_attendance += len(att_buf)
                att_buf = []
            db.commit()

        # ── Tasks (4 per class) + TaskCompletion (~70% completed) ───────────
        tc_buf = []
        for ci, (cls, grade, _s) in enumerate(school_classes):
            gs_subject_ids = []
            if grade <= 5:
                gs_subject_ids = [subject_id[n] for n in GRADES_1_5_SUBJECTS]
            else:
                gs_subject_ids = [subject_id[n] for n in subject_id.keys()]
            students_of_class = class_students_map[cls.id]
            new_tasks = []
            for ti in range(4):
                t = Task(
                    title=TASK_TITLES[(ci * 4 + ti) % len(TASK_TITLES)],
                    # rotate the subject index by class so all of the grade's
                    # subjects get task data across the school
                    subject_id=gs_subject_ids[(ti + ci) % len(gs_subject_ids)],
                    due_date=today - timedelta(days=((ci * 4 + ti) % 30) + 1),
                    assigned_by=cls.class_teacher_id,
                    class_id=cls.id,
                )
                db.add(t)
                new_tasks.append(t)
            db.flush()
            total_tasks += len(new_tasks)
            for t in new_tasks:
                for s in students_of_class:
                    status = "completed" if random.random() < 0.7 else "pending"
                    tc_buf.append(TaskCompletion(task_id=t.id, student_id=s.id,
                                                 status=status))
            if len(tc_buf) >= BULK_BUFFER:
                db.bulk_save_objects(tc_buf)
                total_task_completions += len(tc_buf)
                tc_buf = []
                db.commit()

        if tc_buf:
            db.bulk_save_objects(tc_buf)
            total_task_completions += len(tc_buf)
            tc_buf = []
            db.commit()

        # ── Parent account linked to first student of the first class ──────
        parent_user = User(
            email=f"parent@{school_prefix}.test",
            hashed_password=get_password_hash("parent123"),
            full_name=f"Parent ({school.name})",
            role="parent",
        )
        db.add(parent_user)
        db.flush()
        total_accounts += 1
        total_parents += 1
        first_cls = school_classes[0][0]
        first_student = (db.query(Student)
                         .filter(Student.class_id == first_cls.id)
                         .order_by(Student.id)
                         .first())
        if first_student:
            first_student.parent_user_id = parent_user.id
        db.commit()

    # Chairperson — oversees all 3 schools
    chair = User(
        email="chairperson@schoolai.test",
        hashed_password=get_password_hash("chair123"),
        full_name="Chairperson (All Schools)",
        role="chairperson",
    )
    db.add(chair)
    db.flush()
    for s in schools:
        db.add(UserSchool(user_id=chair.id, school_id=s.id))
    db.commit()
    total_accounts += 1

    # super_admin: assign_class_id = first_class_id (for preview)
    db_user = db.query(User).filter(User.id == user.id).first()
    if db_user and first_class_id:
        db_user.assigned_class_id = first_class_id
        db.commit()

    result = {
        "schools": len(schools),
        "classes": total_classes,
        "students": total_students,
        "subjects": len(subject_id),
        "exams": total_exams,
        "marks": total_marks,
        "attendance": total_attendance,
        "tasks": total_tasks,
        "task_completions": total_task_completions,
        "teacher_assignments": total_teacher_assignments,
        "teachers": total_teachers,
        "parents": total_parents,
        "accounts": total_accounts,
        "school_admins": [u.email for u in school_admins],
        "principals": [u.email for u in principals],
        "chairperson": chair.email,
    }
    _audit(
        user.email, "seed_full.complete",
        schools=result["schools"], classes=result["classes"],
        students=result["students"], accounts=result["accounts"],
    )
    return result
