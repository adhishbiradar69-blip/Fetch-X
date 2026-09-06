# FETCH-X (SchoolAI) — Audit & Fix Report

**Scope:** full-site audit (UI, security, functionality), fixes, animation cleanup,
user GUI customisation, and end-to-end testing. **The FETCH-X theme (design
language, tokens, fonts, layout look) is untouched — every change reuses the
existing theme classes/tokens.**

Project root: `school-ai-site/School_Ai-reeboot`
Stack: React 19 + Vite (frontend) · FastAPI + SQLite (backend)

---

## 1. Security fixes (backend)

### Critical
| Issue | Fix |
|---|---|
| Hardcoded JWT secret fallback in `app/config.py` — anyone with the repo could forge tokens for any user | Secret now **must** come from `SCHOOLAI_SECRET_KEY`; otherwise a random ephemeral key is generated per boot (with a loud warning). Deployments that don't set it fail safe. |
| Hardcoded root admin credentials committed in source | Root admin email/password now env-driven (`SCHOOLAI_ROOT_EMAIL` / `SCHOOLAI_ROOT_PASSWORD`), randomised when unset, account created only at startup. |
| Attendance IDOR — any teacher could read/write any class's attendance | Every attendance read/write verifies the caller teaches the class (or is admin/principal of that school). |
| Marks IDOR — any teacher could read/write marks for classes they don't teach | Same ownership scoping applied to all marks endpoints. |

### High
- `academics` reads (class marks / reports / student marks) were **unscoped** — now every route resolves the caller's school/role and filters accordingly.
- Attendance read routes (`/class/{id}`, `/week/{id}`, `/trend/{id}`, `/summary/{id}`) were unscoped — same fix.
- Tasks were cross-school readable/writable — tasks now validate the caller belongs to the class's school.
- `GET /attendance/teacher/classes` leaked classes the teacher doesn't teach — filtered to own assignments (admins get their school).
- Admin listing endpoints leaked internal `parent_user_id` linkage — removed from payloads.
- Demo seed endpoints (`/admin/seed`, `/admin/seed-full`) could wipe a production DB — now **disabled when `SCHOOLAI_ENV=production`**.
- Well-known seeded passwords documented & rotated in the demo seeder (`seed_demo.py`) with clear "demo only" flags.

### Medium / Low
- Missing-token requests returned **403** (FastAPI `HTTPBearer` default) — now a standards-correct **401 + `WWW-Authenticate: Bearer`** (RFC 7235). Frontend treats both the same, so no UX change.
- JWT `sub` is now validated as a positive integer (blocks token-substitution confusion); token lifetime hard-capped at 24 h even if misconfigured.
- Login rate-limit + account lockout verified end-to-end (generic "Invalid email or password" — no user enumeration; 423 Locked with retry-after after 5 failures).
- SQL-injection probes (UNION/DROP/tautology payloads) all rejected safely (parameterised ORM, format validation up-front).
- XSS probes stored & rendered safely (React escaping verified in browser; no `dangerouslySetInnerHTML` on user data).
- Massive-payload & malformed-JSON probes handled without 500s.

## 2. UI bug fixes (frontend)

| Bug | Fix |
|---|---|
| **Sidebar nav silently clipped** — on short viewports the nav scrolls internally, but nothing told you: the active item could sit below the fold (looked like the menu just ended) | Active nav link now auto-scrolls into view on route change / collapse toggle |
| **User settings wiped on every reload** — `readPrefs()`'s legacy-mode migration re-ran every load (because `fx-mode` is permanently synced) and overwrote saved prefs before reading them | Migration now runs **only when no pref object exists** — all prefs persist correctly |
| **GlobalSearch placeholder/typed text collided** with the absolutely-positioned `Ctrl K` badge | Input right-padding increased (58 px) so text never runs under the badge |
| `AuthContext` crashed on corrupted localStorage (raw `JSON.parse`) | Safe parse with fallback to defaults |
| Login 401 handling could redirect-loop on the login page itself | Auth calls excluded from the global 401/403 interceptor; single clean error surface ("Invalid email or password") |
| Chairperson → Rankings "inspect" could crash on schools with no classes | Empty/missing-data guards added |
| Tables overflowed horizontally with `overflow-x` hidden (content unreachable on small screens) | Scrollable table wrappers with themed scrollbars; mobile nav drawer added for ≤860 px |
| Mobile: no navigation surface | Dedicated mobile topbar + slide-in drawer (same markup/classes as desktop) |
| 600 ms artificial route loader delayed every navigation | Removed — route transitions are now instant |
| `AnimatePresence` wrapping the whole app remounted the sidebar on every navigation | Scoped down; sidebar state persists across navigation |
| Recharts ticks unreadable in dark mode (`var()` in SVG attrs) | Tick/axis colours resolved to concrete tokens per mode |

## 3. Animation pass

**Removed (unnecessary):**
- 600 ms RouteLoader gate between every route change (pure friction)
- App-level page-transition wrapper (caused sidebar remount flash)
- Login logo infinite pulse, TaskManager empty-state float loop (distracting, battery-unfriendly)
- Dead `PageLoader` / motion exports deleted

**Kept / improved (useful):**
- Hover/focus affordances, drawer & modal transitions, staggered list entrances — all now **capped** (no unbounded staggers on long lists)
- Global `MotionConfig reducedMotion="user"` — honours OS reduced-motion
- New **motion preference switch** (Full / Reduced / Off) in Profile & Settings

## 4. User GUI customisation — Profile & Settings

New modal (sidebar footer → **Settings**, or the profile button in the header),
built entirely with existing FETCH-X classes so the theme is untouched:

| Control | Options | Notes |
|---|---|---|
| Appearance | System / Light / Dark | "System" follows the OS live |
| Motion & animation | Full / Reduced / Off | Off also auto-honours OS reduced-motion |
| Text size | A− / Default / A+ | Page zoom 0.92 / 1.00 / 1.08 |
| Density | Cozy / Compact | Tightens paddings, tables, charts |
| Sidebar | Expanded / Collapsed | Remembered between visits |
| Reset to defaults | — | One click back to stock |

All preferences persist per device (`fx-prefs` in localStorage), apply
instantly, and the legacy `fx-mode` key stays in sync so the pre-paint script
still prevents the first-paint theme flash. Accessibility: real radiogroups
with `aria-checked`, keyboard-operable, Escape closes.

## 5. Testing performed

- **API regression suite — 121/121 passing**: auth flows (valid/invalid/locked/forged tokens), full RBAC matrix (6 roles × allow/deny), cross-tenant IDOR probes, input validation (SQLi, XSS, bad types/dates, empty & negative ids, 1 MB payloads, malformed JSON), brute-force lockout, pagination/edge params, and functional smoke of every router for every role.
- **Browser E2E (Chromium)**: public landing/about/terms/privacy, login (success + failure UX + terms gate), admin dashboard & management pages, principal dashboard (charts, AI panel, global search), teacher attendance **write flow** (mark all → save → confirmation), rankings/compare, parent view, sign-out.
- **Responsive**: 390×844 mobile (topbar, drawer, stacked KPIs) and 1440×900 desktop verified via screenshots; dark + compact + large-text combination verified visually.
- **Production build**: `npm run build` succeeds clean (pre-existing chunk-size warnings only).
- Console error watch across all pages: **zero page errors**.

## 6. Ops / deployment notes

- Set these env vars in production:
  - `SCHOOLAI_SECRET_KEY` (required — see `app/config.py`)
  - `SCHOOLAI_ROOT_EMAIL` / `SCHOOLAI_ROOT_PASSWORD` (root admin bootstrap)
  - `SCHOOLAI_ENV=production` (disables demo seed endpoints)
  - `SCHOOLAI_TOKEN_EXPIRE_MINUTES` (optional, default 480, hard-capped 24 h)
- `render.yaml` updated with the new env var placeholders.
- Demo accounts (dev only): `admin@schoolai.test / admin123`,
  `greenwood@admin.test / school123`, `principal@greenwood.test / principal123`,
  `teacher1.greenwood@schoolai.test / teacher123`, `parent@greenwood.test / parent123`,
  `chairperson@schoolai.test / chair123`.
