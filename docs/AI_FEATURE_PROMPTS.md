# AI Feature Prompts (AI v3)

These are the three working prompts used to **verify**, **rebuild**, and **ship** the
Fetch-X AI v3 feature set (principal AI tools + tables, VCP AI persona, shared AI
thread store, full AI page `#ai`). They are stored here so they survive outside
any chat session and can be re-run against this repo at any time.

- **Prompt 1 — Verify**: full PASS/FAIL checklist (backend, frontend, browser) for the AI v3 feature set.
- **Prompt 2 — Rebuild**: exact re-implementation spec if the feature set is ever lost.
- **Prompt 3 — Ship**: docs, feature commit, push, and optional next enhancements.

Demo logins referenced below: `principal@greenwood.test` / `principal123` and
`vp@greenwood.test` / `vp123` (VCP accounts exist for all 3 schools: also
`vp@sunrise.test`, `vp@radiant.test`).

---

## PROMPT 1 — Verify

```
Verify the Fetch-X AI feature set in this repo (SchoolAI: FastAPI backend in
backend/, React frontend in frontend/). Work through this exact checklist and
report PASS/FAIL per item with file:line evidence.

SETUP
- Backend: uvicorn app.main:app --reload (port 8000), run from backend/ with
  the project venv. Frontend: npm run dev in frontend/ (port 3000).
- Demo logins: principal@greenwood.test / principal123 ·
  vp@greenwood.test / vp123 (VCP accounts exist in the DB for all 3 schools).

BACKEND CHECKS
1. backend/app/services/ai_tools.py defines these NEW tools and they are
   registered in TOOLS: get_today_attendance, get_chronic_absentees,
   get_pending_tasks, get_exam_calendar, get_teacher_coverage,
   get_class_size_balance, get_exam_result_focus, table_grade_overview,
   table_class_attendance, table_task_completion. TOOLS should have 33
   entries; a VCP_TOOLS registry should exist with 29 entries (ops-first:
   attendance/tasks/exams/staffing lead, performance included for grounding).
2. backend/app/services/ai_service.py: REASONING_PROTOCOL tells the model to
   use markdown tables and include ```chart / ```table blocks verbatim;
   _call_groq_with_tools retries once per model on failure;
   _fallback_from_tools exists and preserves chart/table blocks when the LLM
   is unreachable (wired into BOTH fallback return paths via tool_log).
3. backend/app/routers/vp.py exists: POST /vice-principal/ai/analyze with a
   VCP_SYSTEM_PROMPT (operations persona) and role gate
   vice_principal/principal/super_admin/school_admin. It must NOT contain
   `from __future__ import annotations` (slowapi wrapper breaks FastAPI body
   param resolution → 422).
4. backend/app/main.py registers vp router; dependencies.py includes
   "vice_principal" in ALLOWED_ROLES, assert_class_access and
   assert_student_access; principal.py _allowed includes vice_principal;
   seed_demo.py creates vp@<prefix>.test accounts (password vp123).
5. Live API: POST /auth/login as vp@greenwood.test, then POST
   /vice-principal/ai/analyze with {"question":"Who was absent on the most
   recent marked day?","history":[]} → answer with source "groq" and
   tools_used containing get_today_attendance. Also POST /principal/ai/analyze
   as principal with "Show each grade as a table" → answer contains a
   ```table fenced block.

FRONTEND CHECKS
6. frontend/src/pages/Principal/dashboard/aiThread.js exists: persona-aware
   shared store (AI_PERSONAS, aiAsk, aiRetry, aiClear, getAiSnapshot,
   subscribeAi) persisting to localStorage key fx-ai-thread-<persona>.
7. data.js exports analyzeAs(persona, question, history) mapping
   principal → /principal/ai/analyze and vcp → /vice-principal/ai/analyze.
8. AiPanel.jsx: uses the shared store (useSyncExternalStore), renders
   markdown pipe-tables AND ```table blocks as real <table class="ai-table">,
   renders ```chart blocks as graphs, shows a Maximize2 "open full page"
   button plus an inline chip "Long conversation — open the full AI page"
   when the thread has ≥8 messages, and swaps persona (Fetch-X AI vs VCP AI
   with VCP-specific suggestion chips).
9. AiPage.jsx exists: full-page #ai view with header (back button, persona
   card, CLEAR), a categorized prompt library (principal: 6 groups incl.
   "Decisions"; vcp: 5 groups starting with "Today"), the same shared
   thread, and a wide input bar. On mobile the library collapses behind a
   "WHAT CAN I ASK?" toggle.
10. Dashboard.jsx: hash #ai routes to AiPage (side panel + FAB hidden
    there), aiPersona = 'vcp' when user.role === 'vice_principal',
    pagehead says "Vice-Principal Dashboard" for that role, sidebar has an
    "AI Analyst" link (DashSidebar.jsx) that navigates to #ai.
11. Routing/auth: App.jsx allows vice_principal on /principal/dashboard;
    AuthContext.jsx ROLE_HOME maps vice_principal → /principal/dashboard.
12. CSS: dashboard.css has .ai-table, .ai-expand-chip, .aip-* styles using
    ONLY existing CSS variables (no new colors/typography — theme unchanged).

BROWSER CHECKS (Playwright or manual, both light and dark mode)
13. Login as principal → dashboard: "AI Analyst" in sidebar; ask "Show each
    grade as a table" → a styled table renders inside the chat.
14. Click the expand icon → URL becomes /principal/dashboard#ai, prompt
    library visible, conversation carried over from the panel.
15. Logout, login as vp@greenwood.test / vp123 → lands on dashboard, panel
    says "VCP AI · OPERATIONS", suggestions are operations-flavoured; open
    #ai, click "Who was absent on the most recent marked day?" → real answer
    with names/classes.
16. npm run build in frontend/ succeeds; eslint on the touched files
    (AiPanel.jsx, AiPage.jsx, aiThread.js, Dashboard.jsx, DashSidebar.jsx,
    data.js) reports no new errors.

Report each numbered item as PASS or FAIL with evidence. Do not fix anything.
```

---

## PROMPT 2 — Rebuild

```
The Fetch-X repo (backend/ = FastAPI, frontend/ = React) lost its AI feature
set. Rebuild it EXACTLY to this spec. Do NOT change the visual theme — reuse
existing CSS variables (--surf, --line, --chip, --ink, --muted, --grip) and
the #5b4fe9/#4f42dd/#8a7cf6 accent family already in index.css.

BACKEND
1. backend/app/services/ai_tools.py — append to the existing principal TOOLS:
   • get_today_attendance(db, school) — attendance for the most recently
     marked date (MAX(Attendance.date) scoped to the school): per-class
     P/A/L counts + named absentees, school present-%.
   • get_chronic_absentees(db, school, threshold=60, limit=15) — students
     below threshold% attendance, worst first.
   • get_pending_tasks(db, school, limit=15) — tasks with most pending
     submissions per class, title/due/term/counts, worst completion first.
   • get_exam_calendar(db, school, grade=None) — exams with term, max_score,
     marks-entered count and average-so-far.
   • get_teacher_coverage(db, school) — HODs, per-subject grade coverage from
     TeacherAssignment, uncovered GradeSubject warnings, ExtraTeacher list.
   • get_class_size_balance(db, school) — students per section, warn when a
     grade's sections differ by ≥4 students.
   • get_exam_result_focus(db, school, grade) — latest exam for that grade:
     top-5 and bottom-5 students as % of max score.
   • table_grade_overview / table_class_attendance / table_task_completion —
     each returns a fenced block: ```table\n{"title": …, "rows":[{col:val…}]}
     \n``` (column order = first row's keys).
   • VCP_TOOLS registry = ops-first dict referencing TOOLS entries:
     today attendance, chronic absentees, attendance summary+impact, pending
     tasks, task completion stats, exam calendar + result focus, teacher
     coverage, class size balance, class detail/roster/at-risk/comparison,
     grade summary, student lookups (details/compare/band/top/at-risk),
     school summary, the 3 table tools, and all 5 visualize_* chart tools.
   Tools must accept (db, school, **args) and an optional _data snapshot kwarg
   like the existing v2 tools.

2. backend/app/services/ai_service.py — three changes:
   • REASONING_PROTOCOL step 5: also instruct markdown tables ("| pipes with
     a |---| separator — the UI renders them as grids") and ```table blocks
     verbatim.
   • _call_groq_with_tools: retry each model once on non-200/exception.
   • Add tool_log list[(name, result)] to ask_ai_agentic, append on every
     tool execution, and add _fallback_from_tools(question, tool_log): when
     the LLM fails after tools ran, keep any ```chart/```table blocks
     verbatim + a trimmed digest of the last 3 tool outputs, instead of the
     empty canned fallback. Use it in BOTH failure return paths.

3. backend/app/routers/vp.py — new APIRouter(prefix="/vice-principal"):
   POST /ai/analyze, rate-limited 30/minute, roles
   ("vice_principal","principal","super_admin","school_admin"), imports
   AnalyzeBody/_gather_school_data/_compact_school_summary/_school_of from
   app.routers.principal, runs ask_ai_agentic with VCP_TOOLS and
   VCP_SYSTEM_PROMPT = an operations-officer persona (day-to-day running:
   absences, homework, exams, staffing gaps, section balance; crisp,
   checklist-driven, tables for comparisons, prioritised action list).
   IMPORTANT: no `from __future__ import annotations` in this file — the
   slowapi @limiter.limit wrapper's functools.wraps globals make FastAPI
   demote postponed body annotations to query params (422).

4. main.py: include vp router. dependencies.py: add "vice_principal" to
   ALLOWED_ROLES and to the school-scoped branches of assert_class_access /
   assert_student_access. principal.py: _allowed gains "vice_principal".
   seed_demo.py: PASSWORDS["vice_principal"]="vp123"; _ensure_school_accounts
   creates f"vp@{prefix}.test" ("Vice Principal <school>", role
   "vice_principal", school_id). For an existing DB, insert the accounts
   once via a small script.

FRONTEND
5. aiThread.js (new, in pages/Principal/dashboard/): AI_PERSONAS map
   (principal: name "Fetch-X AI"; vcp: name "VCP AI", eyebrow
   "VCP AI · OPERATIONS", subtitle "Vice-Principal's operations desk");
   module-level store with msgs/loading, localStorage persistence to
   fx-ai-thread-<persona> (keep last 80), aiAsk(persona-aware, sends last 6
   turns as history), aiRetry, aiClear, subscribeAi + getAiSnapshot for
   useSyncExternalStore.
6. data.js: add analyzeAs(persona, question, history) with an endpoint map
   principal→/principal/ai/analyze, vcp→/vice-principal/ai/analyze.
7. AiPanel.jsx rewrite: use the shared store; persona prop; export AiChart
   (existing), new AiTable ({title, rows} → table.ai-table), MarkdownLite
   that now renders pipe-tables, ```table blocks, and <hr>; extract shared
   AiMessageList; add a Maximize2 header button (calls onExpand) and an
   inline chip when msgs.length ≥ 8 AND onExpand provided; VCP suggestion
   chips ("Who was absent on the most recent marked day?", "Which classes
   have the most pending homework?", "Show teacher coverage gaps"); parse
   fence JSON OUTSIDE JSX construction (no JSX inside try/catch — eslint).
8. AiPage.jsx (new): full-page chat — header (back ChevronLeft, persona
   ai-card, CLEAR button calling aiClear), left prompt library
   (principal groups: School health / Students / Subjects & classes /
   Teachers & staffing / Exams & homework / Decisions, 30 questions total;
   vcp groups: Today / Homework & tasks / Exams / Staffing & sections /
   Interventions, 25 questions) where clicking asks immediately, the shared
   AiMessageList with larger type (.aip-msgs), and a wide input bar. Below
   1000px hide the library behind a "WHAT CAN I ASK?" toggle.
9. Dashboard.jsx: parseHash adds view 'ai' for hash #ai; navGo('aiSec') →
   go('ai'); when view==='ai' render <AiPage persona onBack> INSTEAD of the
   pagehead+sections and hide AiPanel + ai-fab; aiPersona =
   user.role==='vice_principal' ? 'vcp' : 'principal'; pass
   onExpand={() => go('ai')} to AiPanel (undefined in CT mode); pagehead
   h1 "Vice-Principal Dashboard" for that role. DashSidebar.jsx: add
   ['aiSec','AI Analyst'] to P_LINKS with a Sparkles icon (lvl 7).
10. App.jsx: allow 'vice_principal' on /principal/dashboard. AuthContext.jsx
    ROLE_HOME: vice_principal → /principal/dashboard.
11. dashboard.css: append .ai-table (uppercase th on --chip, zebra rows via
    color-mix with --chip, --line borders), .ai-expand-chip (dashed #c9c2f5
    border, #4f42dd text, dark-mode variants), and .aip-* layout styles for
    the full page — ALL colors via existing variables/theme accents only.

VERIFY
- python syntax check on changed backend files; curl the two AI endpoints
  with both logins; npm run build + eslint on touched files; browser: table
  renders, #ai page works for both personas, theme identical in light/dark.
```

---

## PROMPT 3 — Ship (next-steps)

```
In the Fetch-X repo (github.com/adhishbiradar69-blip/Fetch-X), the AI v3
feature set (principal AI tools + tables, VCP AI persona, shared AI thread
store, full AI page #ai) is implemented and verified but NOT committed.
Working tree also contains earlier uncommitted changes
(AdminShell.jsx, Teacher/CTConsole.jsx, Principal/dashboard/v15.css,
public/gnps-logo.png, dashboard/v16.css) that pre-date this work — commit
them separately or leave them untouched as I prefer.

Do the following:
1. Update README/INTRODUCTION docs with: the new demo account
   vp@greenwood.test / vp123 (role vice_principal), the two AI endpoints
   (/principal/ai/analyze and /vice-principal/ai/analyze), and a short "AI
   pages" section (side panel, #ai full page, prompt library, tables/charts).
2. Commit the AI v3 work as one feature commit, e.g.
   "feat: AI v3 — ops tools + tables for the principal, dedicated VCP AI
   persona, full AI page with prompt library" (backend: ai_tools/ai_service/
   vp router/dependencies/main/principal/seed_demo; frontend: aiThread.js,
   AiPage.jsx, AiPanel.jsx, data.js, Dashboard.jsx, DashSidebar.jsx,
   dashboard.css, App.jsx, AuthContext.jsx).
3. Push to origin main.
4. Optional next enhancements (ask before doing): stream answers token-by-
   token; export an AI table/chart answer as PDF; per-persona conversation
   memory on the server; chairperson-specific AI tools.
```

---

## Status (as of the AI v3 ship pass)

- **Feature commit**: `2642d0a` already contains the complete AI v3 backend +
  frontend file set (ai_tools.py, ai_service.py, vp.py, dependencies.py,
  main.py, principal.py, seed_demo.py; aiThread.js, AiPage.jsx, AiPanel.jsx,
  data.js, Dashboard.jsx, DashSidebar.jsx, dashboard.css, App.jsx,
  AuthContext.jsx); `7c46ae3` adds `gnps-logo.png`.
- **Docs**: this file, plus README/INTRODUCTION updates (VCP demo account,
  AI endpoints, AI pages section).
- **Optional next enhancements** (from Prompt 3, ask before doing): token-by-token
  streaming; export an AI table/chart answer as PDF; per-persona server-side
  conversation memory; chairperson-specific AI tools.
