#!/usr/bin/env python
"""seed_demo.py — idempotent full demo reseed for the Fetch-X rebuild.

Usage (from the backend directory):
    venv/bin/python seed_demo.py

What it does
============
Wipes every business table (marks, attendance, tasks, students, classes,
exams, grade-subjects, subjects, teacher assignments, school links) and
reseeds the three demo schools to the designer-approved spec:

  - Classes: grades 1-10 x house sections Sapphire/Emerald/Ruby (30/school)
  - Students: 30 per class (900/school), deterministic fake names
  - Subjects (6, global): Mathematics, English, Science, Social Studies,
    Computer Science, Physical Education — configured as GradeSubject for
    every grade
  - Exams: one per grade per term ("Term 1"/"Term 2"/"Term 3"), max_score 100
  - Marks: one per student x subject x term, modelled from a stable
    per-student "ability" plus per-subject jitter and a positive per-term
    uplift (T3 >= T2 >= T1 on average), clamped to 5..99
  - Attendance: the last 90 school days (Mon-Fri) per student,
    ~93% P / ~5% A / ~2% L with a per-student bias
  - Tasks: 10 per class spread across the year + TaskCompletion rows
    (~60-90% per task with per-student diligence)
  - Teachers: 30 class_teacher users per school, 5 per subject; the first
    teacher of each subject is that subject's HOD (TeacherAssignment row
    with class_id NULL); every class gets exactly one class teacher (CT)

Accounts are PRESERVED, never deleted: the root super admin, all existing
demo logins (teachers / school admins / principals / parents / chairperson)
keep their emails, passwords and user ids. Missing demo accounts are
created with the documented credentials listed in ``print_summary``.

Runtime budget: well under 90 s (bulk rows use chunked Core inserts,
committing every ~5000 rows).
"""
from __future__ import annotations

import os
import random
import sys
import time
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import inspect  # noqa: E402

from app.database import Base, SessionLocal, engine  # noqa: E402
from app.models.attendance import Attendance  # noqa: E402
from app.models.class_ import Class  # noqa: E402
from app.models.exam import Exam  # noqa: E402
from app.models.grade_subject import GradeSubject  # noqa: E402
from app.models.mark import Mark  # noqa: E402
from app.models.school import School  # noqa: E402
from app.models.student import Student  # noqa: E402
from app.models.subject import Subject  # noqa: E402
from app.models.task import Task, TaskCompletion  # noqa: E402
from app.models.teacher_assignment import TeacherAssignment  # noqa: E402
from app.models.user import User  # noqa: E402
from app.models.user_school import UserSchool  # noqa: E402
from app.routers.auth import get_password_hash  # noqa: E402

# ─────────────────────────────────────────────────────────────────────────────
# Seed specification constants
# ─────────────────────────────────────────────────────────────────────────────
SCHOOL_NAMES = [
    "Greenwood High",
    "Sunrise Public School",
    "Radiant International Academy",
]
SECTION_NAMES = ["Sapphire", "Emerald", "Ruby"]
SUBJECTS_DEF = [
    ("Mathematics", "#5b4fe9"),
    ("English", "#0ea5e9"),
    ("Science", "#10b981"),
    ("Social Studies", "#f59e0b"),
    ("Computer Science", "#8b5cf6"),
    ("Physical Education", "#ef4444"),
]
TERMS = ["Term 1", "Term 2", "Term 3"]
GRADES = list(range(1, 11))
STUDENTS_PER_CLASS = 30
TEACHERS_PER_SUBJECT = 5
ATTENDANCE_SCHOOL_DAYS = 90      # weekdays per student
TASKS_PER_CLASS = 10

# Demo credentials (documented in the final report + worklog).
PASSWORDS = {
    "teacher": "teacher123",
    "school_admin": "school123",
    "principal": "principal123",
    "parent": "parent123",
    "chairperson": "chair123",
}

# Same 30 teacher names as routers/admin.py so HOD names stay stable
# across seeding paths (QA asserts Mathematics HOD = "Priya Sharma").
TEACHER_NAMES = [
    "Priya Sharma", "Rahul Verma", "Anjali Mehta", "Suresh Iyer", "Kavitha Reddy",
    "Deepak Joshi", "Meera Nair", "Arvind Gupta", "Lata Pillai", "Ramesh Rao",
    "Neha Kulkarni", "Vikram Singh", "Shanti Devi", "Rajesh Menon", "Pooja Bhatt",
    "Anil Kapoor", "Geeta Rao", "Mohit Jain", "Sunita Bose", "Kiran Desai",
    "Farhan Khan", "Lakshmi Subramanian", "Harish Patel", "Divya Saxena", "Manoj Tiwari",
    "Rekha Nambiar", "Sanjay Chopra", "Aarti Pandey", "Naveen Kumar", "Swati Mishra",
]

STUDENT_FIRST = [
    "Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Sai", "Arnav", "Ayaan",
    "Krishna", "Ishaan", "Shaurya", "Atharv", "Aarush", "Kabir", "Darsh",
    "Reyansh", "Krish", "Aryan", "Rohan", "Rudra", "Ved", "Dhruv", "Yash",
    "Ananya", "Diya", "Saanvi", "Aadhya", "Navya", "Myra", "Pari", "Kavya",
    "Sara", "Ira", "Aaradhya", "Meera", "Tara", "Riya", "Jiya", "Anika",
    "Naina", "Aditi", "Zara", "Avni",
]
STUDENT_SURNAMES = [
    "Kumar", "Sharma", "Singh", "Patel", "Reddy", "Nair", "Iyer", "Gupta",
    "Das", "Bose", "Menon", "Joshi", "Chopra", "Mehta", "Bhatt",
]

TASK_TITLES = [
    "Chapter Review Worksheet", "Problem Set Practice", "Reading Comprehension",
    "Lab Report Submission", "Group Project Draft", "Essay Assignment",
    "Quiz Preparation", "Practice Homework Sheet", "Map Work Exercise",
    "Coding Worksheet", "Fitness Log Entry", "Book Report",
]

# Marks model: stable per-student ability + per-subject jitter + term uplift.
ABILITY_MEAN, ABILITY_SIGMA = 68.0, 12.0
SUBJECT_JITTER_SIGMA = 5.0
TERM_UPLIFT = 2.5          # added per term index (T2 = +2.5, T3 = +5.0)
MARK_NOISE_SIGMA = 3.0
MARK_MIN, MARK_MAX = 5.0, 99.0

# Attendance model: ~93% P / ~5% A / ~2% L with per-student bias.
ATT_P_BASE = 0.93
ATT_L_RATE = 0.02

CHUNK_ROWS = 5000          # commit every ~5000 bulk rows
RNG_SEED = 20240917        # fixed -> reseeds are byte-for-byte reproducible


# ─────────────────────────────────────────────────────────────────────────────
# Schema migration (teacher_assignments gained is_class_teacher + nullable
# class_id in this task; SQLite cannot ALTER ADD CONSTRAINT, so an old-shape
# table is dropped and recreated empty by create_all).
# ─────────────────────────────────────────────────────────────────────────────
def _migrate_schema() -> None:
    insp = inspect(engine)
    if not insp.has_table("teacher_assignments"):
        return
    cols = {c["name"] for c in insp.get_columns("teacher_assignments")}
    if not {"is_hod", "is_class_teacher"} <= cols:
        print("[migrate] dropping stale teacher_assignments table (old schema)")
        Base.metadata.drop_all(engine, tables=[TeacherAssignment.__table__])


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


# ─────────────────────────────────────────────────────────────────────────────
# Wipe
# ─────────────────────────────────────────────────────────────────────────────
def _wipe_business_data(db) -> None:
    """Delete all business rows. Users and schools are KEPT (see module doc)."""
    db.query(TaskCompletion).delete(synchronize_session=False)
    db.query(Task).delete(synchronize_session=False)
    db.query(Mark).delete(synchronize_session=False)
    db.query(Attendance).delete(synchronize_session=False)
    db.query(TeacherAssignment).delete(synchronize_session=False)
    db.query(Student).delete(synchronize_session=False)
    db.query(Exam).delete(synchronize_session=False)
    db.query(GradeSubject).delete(synchronize_session=False)
    db.query(Class).delete(synchronize_session=False)
    db.query(Subject).delete(synchronize_session=False)
    db.query(UserSchool).delete(synchronize_session=False)
    db.commit()


# ─────────────────────────────────────────────────────────────────────────────
# Accounts (preserved; missing ones are created with documented credentials)
# ─────────────────────────────────────────────────────────────────────────────
def _ensure_user(db, email: str, password: str, full_name: str, role: str,
                 school_id: int | None = None) -> tuple[User, bool]:
    """Fetch-or-create a user by email. Existing accounts keep their password."""
    u = db.query(User).filter(User.email == email).first()
    created = False
    if u is None:
        u = User(email=email, hashed_password=get_password_hash(password),
                 full_name=full_name, role=role, school_id=school_id)
        db.add(u)
        db.flush()
        created = True
    else:
        # Repair drift so preserved accounts still resolve correctly.
        if u.role != role:
            u.role = role
        if school_id is not None and u.school_id != school_id:
            u.school_id = school_id
        db.flush()
    return u, created


def _ensure_root_admin(db) -> None:
    """Guarantee the hardcoded root super admin exists (never resets password)."""
    root = db.query(User).filter(User.email == "root.schoolai@nexus-secure.internal").first()
    if root is None:
        db.add(User(
            email="root.schoolai@nexus-secure.internal",
            hashed_password=get_password_hash("Tr!umphant-Str@tik-9173"),
            full_name="System Root", role="super_admin",
            school_id=None, assigned_class_id=None,
        ))
        db.commit()
        print("[accounts] root super admin created")


def _school_prefix(school_name: str) -> str:
    return school_name.split()[0].lower()


def _ensure_school_accounts(db, school: School) -> dict:
    """Ensure the full demo account set for one school. Returns handles."""
    prefix = _school_prefix(school.name)

    teachers = []
    teacher_created = 0
    for i in range(1, 31):
        u, created = _ensure_user(
            db, f"teacher{i}.{prefix}@schoolai.test", PASSWORDS["teacher"],
            TEACHER_NAMES[i - 1], "class_teacher", school.id,
        )
        teachers.append(u)
        teacher_created += created

    school_admin, sa_created = _ensure_user(
        db, f"{prefix}@admin.test", PASSWORDS["school_admin"],
        f"{school.name} Admin", "school_admin", school.id,
    )
    principal, pr_created = _ensure_user(
        db, f"principal@{prefix}.test", PASSWORDS["principal"],
        f"Principal {school.name}", "principal", school.id,
    )
    parent, pa_created = _ensure_user(
        db, f"parent@{prefix}.test", PASSWORDS["parent"],
        f"Parent ({school.name})", "parent", None,
    )
    return {
        "teachers": teachers,
        "school_admin": school_admin,
        "principal": principal,
        "parent": parent,
        "created": teacher_created + sa_created + pr_created + pa_created,
    }


def _ensure_chairperson(db, schools: list[School]) -> User:
    chair, _ = _ensure_user(
        db, "chairperson@schoolai.test", PASSWORDS["chairperson"],
        "Chairperson (All Schools)", "chairperson", None,
    )
    db.query(UserSchool).filter(UserSchool.user_id == chair.id).delete()
    db.flush()
    for s in schools:
        db.add(UserSchool(user_id=chair.id, school_id=s.id))
    db.commit()
    return chair


# ─────────────────────────────────────────────────────────────────────────────
# Bulk insert helper (Core executemany, commit every CHUNK_ROWS)
# ─────────────────────────────────────────────────────────────────────────────
def _bulk_insert(db, model, rows: list[dict]) -> int:
    total = 0
    for i in range(0, len(rows), CHUNK_ROWS):
        db.connection().execute(model.__table__.insert(), rows[i:i + CHUNK_ROWS])
        db.commit()
        total += len(rows[i:i + CHUNK_ROWS])
    return total


# ─────────────────────────────────────────────────────────────────────────────
# Per-school seeding
# ─────────────────────────────────────────────────────────────────────────────
def _school_days(count: int, today: date) -> list[date]:
    """The last `count` weekdays (Mon-Fri), chronological, ending today."""
    days: list[date] = []
    d = today
    while len(days) < count:
        if d.weekday() < 5:
            days.append(d)
        d -= timedelta(days=1)
    days.reverse()
    return days


def _seed_school(db, school: School, subjects: list[Subject], rng: random.Random,
                 school_days: list[date], today: date) -> dict:
    prefix = _school_prefix(school.name)
    accounts = _ensure_school_accounts(db, school)
    teachers = accounts["teachers"]
    subject_ids = [s.id for s in subjects]

    # ── Classes: grades 1-10 x house sections ──────────────────────────────
    school_classes: list[Class] = []
    for grade in GRADES:
        for section in SECTION_NAMES:
            school_classes.append(Class(school_id=school.id, grade=grade,
                                        section=section))
    db.add_all(school_classes)
    db.flush()

    # ── GradeSubject: all 6 subjects for every grade ───────────────────────
    db.add_all([
        GradeSubject(school_id=school.id, grade=grade, subject_id=sid)
        for grade in GRADES for sid in subject_ids
    ])
    db.flush()

    # ── Exams: one per grade per term, max_score 100 ───────────────────────
    exams: list[Exam] = []
    for grade in GRADES:
        for term_no, term_label in enumerate(TERMS, start=1):
            exams.append(Exam(
                school_id=school.id, grade=grade, name=f"{term_label} Exam",
                max_score=100, term=term_label,
            ))
    db.add_all(exams)
    db.flush()
    exams_by_grade: dict[int, list[tuple[int, int]]] = {}  # grade -> [(exam_id, term_no)]
    for ex in exams:
        term_no = TERMS.index(ex.term) + 1
        exams_by_grade.setdefault(ex.grade, []).append((ex.id, term_no))

    # ── Class-teacher posts ─────────────────────────────────────────────────
    # Class ci -> subject (ci % 6), teacher slot (ci % 5) within that dept.
    # The school admin keeps the CT post of the first class (preview behavior
    # inherited from the original seed); the displaced teacher keeps teaching.
    ct_by_class: dict[int, User] = {}
    for ci, cls in enumerate(school_classes):
        if ci == 0:
            ct = accounts["school_admin"]
        elif ci == 1:
            # Demo homeroom for the school's primary teacher login
            # (teacher1.<prefix>…). MarksBoard / AttendanceBoard /
            # ClassReport all key off user.assigned_class_id — without a
            # homeroom those pages only ever show their empty state.
            # The displaced teacher keeps teaching (same pattern as the
            # school-admin preview post on class 0).
            ct = teachers[0]
        else:
            ct = teachers[(ci % 6) * TEACHERS_PER_SUBJECT + (ci % 5)]
        ct_by_class[ci] = ct
        cls.class_teacher_id = ct.id
    for t in teachers:
        t.assigned_class_id = None
    for ci, ct in ct_by_class.items():
        ct.assigned_class_id = school_classes[ci].id
    db.flush()

    # ── TeacherAssignment rows: teaching loads + HODs + CT flags ───────────
    ta_rows: list[TeacherAssignment] = []
    for si in range(len(subjects)):
        dept = teachers[si * TEACHERS_PER_SUBJECT:(si + 1) * TEACHERS_PER_SUBJECT]
        for ci, cls in enumerate(school_classes):
            slot = ci % TEACHERS_PER_SUBJECT
            is_ct_row = (si == ci % 6) and ci not in (0, 1)  # class 0 CT is the admin, class 1 CT is teachers[0]
            ta_rows.append(TeacherAssignment(
                school_id=school.id, teacher_user_id=dept[slot].id,
                subject_id=subject_ids[si], class_id=cls.id,
                is_hod=False, is_class_teacher=is_ct_row,
            ))
    for si in range(len(subjects)):
        ta_rows.append(TeacherAssignment(
            school_id=school.id,
            teacher_user_id=teachers[si * TEACHERS_PER_SUBJECT].id,
            subject_id=subject_ids[si], class_id=None,
            is_hod=True, is_class_teacher=False,
        ))
    # Explicit CT row for the school admin's post on the first class.
    ta_rows.append(TeacherAssignment(
        school_id=school.id, teacher_user_id=accounts["school_admin"].id,
        subject_id=subject_ids[0], class_id=school_classes[0].id,
        is_hod=False, is_class_teacher=True,
    ))
    # Explicit CT row for teachers[0]'s demo homeroom on the second class.
    ta_rows.append(TeacherAssignment(
        school_id=school.id, teacher_user_id=teachers[0].id,
        subject_id=subject_ids[0], class_id=school_classes[1].id,
        is_hod=False, is_class_teacher=True,
    ))
    db.add_all(ta_rows)
    db.flush()

    # ── Students (deterministic names) + Marks + Attendance ────────────────
    mark_rows: list[dict] = []
    att_rows: list[dict] = []
    student_count = 0
    marks_total = 0
    att_total = 0
    first_students: list[Student] = []
    for ci, cls in enumerate(school_classes):
        students: list[Student] = []
        for i in range(1, STUDENTS_PER_CLASS + 1):
            idx = ci * 31 + i
            name = (f"{STUDENT_FIRST[idx % len(STUDENT_FIRST)]} "
                    f"{STUDENT_SURNAMES[(idx // len(STUDENT_FIRST)) % len(STUDENT_SURNAMES)]}")
            students.append(Student(name=name, roll_no=str(i), class_id=cls.id))
        db.add_all(students)
        db.flush()
        student_count += len(students)
        if ci == 0:
            first_students = students[:1]

        ct_id = cls.class_teacher_id
        grade_exams = exams_by_grade[cls.grade]
        for s in students:
            ability = _clamp(rng.gauss(ABILITY_MEAN, ABILITY_SIGMA), 35.0, 96.0)
            jitters = [_clamp(rng.gauss(0, SUBJECT_JITTER_SIGMA), -12.0, 12.0)
                       for _ in subject_ids]
            att_bias = _clamp(rng.gauss(0, 0.035), -0.08, 0.08)
            p_rate = _clamp(ATT_P_BASE + att_bias, 0.78, 0.985)

            for sj, sid in enumerate(subject_ids):
                for exam_id, term_no in grade_exams:
                    score = _clamp(
                        ability + jitters[sj] + (term_no - 1) * TERM_UPLIFT
                        + rng.gauss(0, MARK_NOISE_SIGMA),
                        MARK_MIN, MARK_MAX,
                    )
                    mark_rows.append({
                        "student_id": s.id, "subject_id": sid,
                        "exam_id": exam_id, "score": round(score, 1),
                    })
            for day in school_days:
                r = rng.random()
                status = "P" if r < p_rate else ("L" if r < p_rate + ATT_L_RATE else "A")
                att_rows.append({
                    "student_id": s.id, "date": day, "status": status,
                    "marked_by": ct_id,
                })

        # Commit pressure control: flush the big buffers every few classes.
        if len(att_rows) >= CHUNK_ROWS * 4:
            marks_total += _bulk_insert(db, Mark, mark_rows)
            att_total += _bulk_insert(db, Attendance, att_rows)
            mark_rows, att_rows = [], []

    marks_total += _bulk_insert(db, Mark, mark_rows)
    att_total += _bulk_insert(db, Attendance, att_rows)
    mark_rows, att_rows = [], []

    # Parent demo account resolves to a real student.
    if first_students:
        first_students[0].parent_user_id = accounts["parent"].id
        db.commit()

    # ── Tasks + completions ─────────────────────────────────────────────────
    task_rows: list[Task] = []
    for ci, cls in enumerate(school_classes):
        for ti in range(TASKS_PER_CLASS):
            task_rows.append(Task(
                subject_id=subject_ids[(ci + ti) % len(subject_ids)],
                title=TASK_TITLES[(ci * TASKS_PER_CLASS + ti) % len(TASK_TITLES)],
                due_date=today - timedelta(days=(TASKS_PER_CLASS - 1 - ti) * 30),
                assigned_by=cls.class_teacher_id,
                class_id=cls.id,
            ))
    db.add_all(task_rows)
    db.flush()
    # Per-student diligence multiplies the per-task completion rate; each task
    # is only assigned to the students of its own class.
    diligence: dict[int, float] = {}
    students_by_class: dict[int, list[int]] = {}
    for s in db.query(Student.id, Student.class_id)\
               .filter(Student.class_id.in_([c.id for c in school_classes]))\
               .all():
        students_by_class.setdefault(s.class_id, []).append(s.id)
        diligence[s.id] = rng.uniform(0.8, 1.2)
    tc_rows: list[dict] = []
    for t in task_rows:
        rate = rng.uniform(0.60, 0.90)
        for sid in students_by_class.get(t.class_id, []):
            done = rng.random() < min(0.98, rate * diligence[sid])
            tc_rows.append({"task_id": t.id, "student_id": sid,
                            "status": "completed" if done else "pending"})
    tc_total = _bulk_insert(db, TaskCompletion, tc_rows)

    return {
        "classes": len(school_classes),
        "students": student_count,
        "exams": len(exams),
        "marks": marks_total,
        "attendance": att_total,
        "tasks": len(task_rows),
        "task_completions": tc_total,
        "teacher_assignments": len(ta_rows),
        "accounts_created": accounts["created"],
        "principal": accounts["principal"].email,
        "school_admin": accounts["school_admin"].email,
        "parent": accounts["parent"].email,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────
def main() -> int:
    t0 = time.time()
    print(f"[seed] database: {engine.url}")
    _migrate_schema()
    Base.metadata.create_all(bind=engine)

    rng = random.Random(RNG_SEED)
    today = date.today()
    school_days = _school_days(ATTENDANCE_SCHOOL_DAYS, today)
    print(f"[seed] attendance window: {school_days[0]} .. {school_days[-1]} "
          f"({len(school_days)} school days)")

    db = SessionLocal()
    try:
        print("[seed] wiping business tables ...")
        _wipe_business_data(db)

        # Subjects are global; recreate the 6 designer-specified ones.
        subjects = [Subject(name=n, color=c) for n, c in SUBJECTS_DEF]
        db.add_all(subjects)
        db.commit()

        # Schools are preserved (users reference them); upsert by name.
        schools: list[School] = []
        for name in SCHOOL_NAMES:
            s = db.query(School).filter(School.name == name).first()
            if s is None:
                s = School(name=name)
                db.add(s)
                db.commit()
            schools.append(s)

        _ensure_root_admin(db)
        _ensure_chairperson(db, schools)

        totals: dict[str, int] = {}
        accounts_created = 0
        for school in schools:
            print(f"[seed] seeding school: {school.name} (id={school.id})")
            stats = _seed_school(db, school, subjects, rng, school_days, today)
            accounts_created += stats.pop("accounts_created")
            print(f"[seed]   {stats}")
            for k, v in stats.items():
                if isinstance(v, int):
                    totals[k] = totals.get(k, 0) + v

        totals["schools"] = len(schools)
        totals["subjects"] = len(subjects)
        totals["accounts_created"] = accounts_created
        elapsed = time.time() - t0
        print("[seed] DONE in {:.1f}s".format(elapsed))
        print("[seed] totals:", totals)
        return 0
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
