# Fetch-X (SchoolAI) — Introduction

Fetch-X is a professional, AI-powered **school management platform** with
multi-role access, rich analytics, and agentic AI assistants for school
leadership. One FastAPI backend, one React frontend, three seeded demo
schools.

## The stack

- **Frontend**: React 19 + Vite + framer-motion + recharts + lucide-react
- **Backend**: Python FastAPI + SQLAlchemy + SQLite (dev) / PostgreSQL (prod)
- **AI**: Groq API (llama-3.3-70b) with z-ai fallback

## Roles at a glance

| Role | Lands on | Highlights |
|---|---|---|
| Super Admin | Principal dashboard + Administration | Bootstrap account (password set once, out-of-band) |
| School Admin | Principal dashboard + Administration | Students / accounts / classes management |
| Principal | Principal dashboard | Full v15 dashboard + **Fetch-X AI** |
| Vice-Principal | Principal dashboard | School-scoped dashboard + **VCP AI** (operations persona) |
| Class Teacher | Class Teacher console | Attendance, tasks, marks, timetable, reports |
| Chairperson | Multi-school command center | Cross-school oversight + AI |
| Parent | Parent view | Read-only child view |

## Demo accounts (after seed)

| Email | Password | Role |
|---|---|---|
| principal@greenwood.test | principal123 | Principal |
| vp@greenwood.test | vp123 | Vice-Principal |
| greenwood@admin.test | school123 | School Admin |
| teacher1.greenwood@schoolai.test | teacher123 | Class Teacher |
| parent@greenwood.test | parent123 | Parent |
| chairperson@schoolai.test | chair123 | Chairperson |

Other schools follow the same pattern (`principal@sunrise.test`,
`principal@radiant.test`, `vp@sunrise.test`, `vp@radiant.test`, …).

## The AI feature set (v3)

### Two leadership personas

- **Fetch-X AI** (principal persona) — strategic, whole-school analysis with
  33 tools: grade overviews, comparisons, charts, and formatted tables.
- **VCP AI** (`VCP AI · OPERATIONS`, vice-principal persona) — an
  operations-officer desk with 29 ops-first tools: today's attendance,
  chronic absentees, pending homework, exam calendar, teacher coverage
  gaps, and section balance.

### AI endpoints

| Endpoint | Roles | Persona |
|---|---|---|
| `POST /principal/ai/analyze` | principal, school_admin, super_admin | Fetch-X AI |
| `POST /vice-principal/ai/analyze` | vice_principal, principal, school_admin, super_admin | VCP AI |
| `POST /chairperson/ai/analyze` | chairperson | Chairperson AI |

Body: `{"question": "...", "history": [...]}` — rate-limited 30/min. When the
LLM is unreachable, the service still answers from the tool outputs
(`_fallback_from_tools` preserves tables/charts and a digest of tool results).

### AI pages

- **Side panel** — floating AI panel on the dashboard (FAB, bottom-right);
  renders markdown, charts (fenced `chart` blocks) and real tables (fenced
  `table` blocks and pipe tables) inline in the chat.
- **Full AI page (`#ai`)** — expand the panel (or click "AI Analyst" in the
  sidebar) for a full-page chat at `/principal/dashboard#ai` with a
  categorized **prompt library** (principal: 6 groups / 30 questions;
  VCP: 5 groups / 25 questions). Both views share one persona-scoped thread
  store, persisted to `localStorage` (`fx-ai-thread-<persona>`).
- **Persona awareness** — header card, suggestions, and prompt library swap
  automatically by role; vice-principals get the operations desk.

## Quick start

```bash
# backend
cd backend && pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000

# frontend
cd frontend && npm install && npm run dev

# seed demo data (3 schools, students, marks, accounts)
# → or click "Seed Full Demo Data" on the Admin Dashboard
```

See **README.md** for Docker, deployment (Render + Vercel), environment
variables, and troubleshooting. See **docs/AI_FEATURE_PROMPTS.md** for the
verify / rebuild / ship prompts used to produce the AI v3 feature set.

## License

MIT
