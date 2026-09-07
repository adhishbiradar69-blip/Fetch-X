"""Vice-Principal (VCP) AI — the vice-principal's OWN assistant persona.

The principal's AI (``/principal/ai/analyze``) is a strategic analyst. The
VCP AI is deliberately a different persona: an operations officer tuned for
the questions a vice-principal asks every morning — who is absent today,
which classes are behind on homework, are exams on track, where is staffing
thin. It runs on ``VCP_TOOLS`` (ops-first tool set) with its own voice,
while staying school-scoped exactly like the principal's data.

Endpoint: POST /vice-principal/ai/analyze — same request/response contract
as the principal endpoint so the frontend thread store can serve either
persona.
"""
# NOTE: no `from __future__ import annotations` here — the slowapi
# @limiter.limit wrapper's functools.wraps copy keeps slowapi's module
# globals, so FastAPI could not resolve postponed (string) annotations of
# the body model and would demote it to a query parameter (422).
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.rate_limit import limiter
from app.models.user import User
from app.dependencies import require_role
from app.services.ai_service import ask_ai_agentic
from app.services.ai_tools import VCP_TOOLS
from app.routers.principal import (
    AnalyzeBody,
    _compact_school_summary,
    _gather_school_data,
    _school_of,
)

router = APIRouter(prefix="/vice-principal", tags=["vice-principal"])

# The vice-principal is school-scoped like the principal; principals and
# school admins may also consult the operations persona.
_allowed = require_role("vice_principal", "principal", "super_admin", "school_admin")

VCP_SYSTEM_PROMPT = (
    "You are the VCP AI — the Vice-Principal's dedicated operations assistant "
    "with live, tool-based access to the school's real data (attendance, "
    "students, classes, subjects, exams, homework tasks, teacher coverage). "
    "Your domain is the school's DAY-TO-DAY running: today's absences and "
    "follow-ups, chronic absenteeism, homework/task completion, exam "
    "readiness and results, staffing and subject-coverage gaps, section "
    "balance, and the students who need intervention this week. Be crisp, "
    "checklist-driven and action-oriented: lead with the answer, put names "
    "and numbers in markdown TABLES whenever comparing more than two things, "
    "and end with a short prioritised action list for the vice-principal's "
    "day. When a tool returns a ```chart or ```table block, include it "
    "verbatim so the UI renders it. Never invent data; if something isn't "
    "available, say so."
)


@router.post("/ai/analyze")
@limiter.limit("30/minute")
async def vcp_ai_analyze(request: Request, body: AnalyzeBody,
                         db: Session = Depends(get_db),
                         user: User = Depends(_allowed)):
    question = (body.question or "").strip()
    school = _school_of(user, db)
    data = _gather_school_data(db, school)

    if not question:
        return {
            "answer": ("Ask me about today's attendance, chronic absentees, "
                       "pending homework, exam readiness, or teacher coverage."),
            "source": "fallback",
            "tools_used": [],
        }

    result = await ask_ai_agentic(
        question=question,
        system_prompt=VCP_SYSTEM_PROMPT,
        db=db,
        tools=VCP_TOOLS,
        context_summary=_compact_school_summary(data),
        ctx={"school": school, "_data": data},
        history=body.history,
    )
    return {
        "answer": result["answer"],
        "source": result["source"],
        "tools_used": result.get("tools_used", []),
    }
