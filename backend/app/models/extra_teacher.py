from sqlalchemy import Column, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base


class ExtraTeacher(Base):
    """Timetable-only staff ("subject teachers").

    These cover academic subjects or activities (games / SUPW / drawing …)
    when the regular faculty can't. Deliberately NOT a User: no login, and
    because every dashboard aggregates TeacherAssignment / marks / users,
    these rows never appear in any ranking, report, or AI answer — they only
    ever surface in generated timetables.
    """
    __tablename__ = "extra_teachers"

    id = Column(Integer, primary_key=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False, index=True)
    name = Column(String(120), nullable=False)
    # Academic coverage: which subject this teacher can teach (nullable when
    # the row only covers an activity like games/SUPW).
    subject_id = Column(Integer, ForeignKey("subjects.id"), nullable=True, index=True)
    # Activity coverage: one of the timetable ACTIVITY_KEYS ('games', 'supw', …).
    activity = Column(String(40), nullable=True, index=True)
    # Hard cap on lessons per day (7 = the usual "2 free periods" load).
    max_daily = Column(Integer, nullable=False, default=7)

    subject = relationship("Subject")
