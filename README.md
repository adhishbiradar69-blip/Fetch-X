# SchoolAI

A professional, AI-powered school management platform with multi-role access, rich analytics, and an AI assistant for principals and chairpersons.

## Stack
- **Frontend**: React 19 + Vite + framer-motion + recharts + lucide-react
- **Backend**: Python FastAPI + SQLAlchemy + SQLite (dev) / PostgreSQL (prod)
- **AI**: Groq API (llama-3.3-70b) with z-ai fallback

## Quick start (local)

### Backend
```bash
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```
Open http://localhost:5173

### Bootstrap + seed
```bash
# 1. Register super_admin
curl -X POST http://127.0.0.1:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@schoolai.test","password":"admin123","role":"super_admin","full_name":"Super Admin"}'

# 2. Login (copy access_token from response)
curl -X POST http://127.0.0.1:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@schoolai.test","password":"admin123"}'

# 3. Seed full demo data (3 schools, 1125 students, 16500 marks)
curl -X POST http://127.0.0.1:8000/admin/seed-full \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Or just log in at http://localhost:5173 and click "Seed Full Demo Data" on the Admin Dashboard.

## Demo accounts (after seed-full)
| Email | Password | Role | Lands on |
|---|---|---|---|
| root.schoolai@nexus-secure.internal | *(set once — secret)* | Super Admin (only one) | Principal dashboard + Class Teacher + Administration nav |
| greenwood@admin.test | school123 | School Admin (Greenwood) | Principal dashboard + Class Teacher + Administration nav |
| principal@greenwood.test | principal123 | Principal | Principal dashboard |
| teacher1.greenwood@schoolai.test | teacher123 | Class Teacher | Class Teacher console |
| parent@greenwood.test | parent123 | Parent | Parent view |
| chairperson@schoolai.test | chair123 | Chairperson | Multi-school command center |

Other schools follow the same pattern: `principal@sunrise.test`, `sunrise@admin.test`,
`principal@radiant.test`, `radiant@admin.test` (same passwords).

### Role → pages map
- **Super Admin** (`super_admin`, exactly one account) — the full v15 dashboard
  with all three nav groups: Principal UI, Class Teacher UI (previews the first
  class), and Administration. The password is set once out-of-band; it is never
  printed or reset by the seeder.
- **School Admin** — same v15 shell; the Class Teacher group resolves to the
  class they hold as CT (the seed's "preview post"), Administration links to
  the students / accounts / classes management pages.
- **Principal** — the v15 dashboard (School → Subject → Class → Student →
  Teacher levels) plus the AI panel.
- **Class Teacher** — the dedicated console: My Class, Attendance, Task
  Completion, Academic Marks, Teaching Classes, My Report, Timetable.
- **Chairperson / Parent** — read-only cross-school oversight / child view.

### School logo
Drop a `gnps-logo.png` into `frontend/public/` and it replaces the Fetch-X mark
in the dashboard sidebar and the AI panel (falls back gracefully when absent).

## AI configuration (optional)
The principal & chairperson AI assistants use Groq by default. Set a Groq API key:
```bash
export GROQ_API_KEY="your-groq-key"
```
If unset, falls back to the built-in z-ai LLM.

## Deployment

**Important**: This is a full-stack app. The frontend deploys to Vercel, but the backend (FastAPI) must be deployed separately — Vercel only hosts static files.

### Step 1 — Deploy the backend (Render / Railway / Fly.io)

1. Push the `backend/` folder to a new Git repo (or use a subfolder)
2. Create a new Web Service on [Render](https://render.com) (free tier works):
   - **Build command**: `pip install -r requirements.txt`
   - **Start command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - **Environment**: Python 3
3. Add environment variables on Render:
   - `GROQ_API_KEY` — your Groq API key (optional, falls back to z-ai if unset)
   - `ALLOWED_ORIGINS` — `https://your-app.vercel.app,http://localhost:5173` (your Vercel URL + localhost for dev)
4. You'll get a backend URL like `https://schoolai-api.onrender.com`
5. Test it: visit `https://schoolai-api.onrender.com/` — should return `{"status":"running"}`

### Step 2 — Deploy the frontend (Vercel)

1. Push the repo to GitHub
2. On [Vercel](https://vercel.com), import the repo
3. **Root Directory**: leave as-is (the repo root, NOT `frontend/`)
4. Vercel auto-detects `vercel.json` which handles the build
5. **Add an environment variable** in Vercel:
   - Name: `VITE_API_URL`
   - Value: `https://schoolai-api.onrender.com` (your Render URL from Step 1)
6. Deploy

### Step 3 — Bootstrap the production database

After both are deployed, create the admin + seed data:
```bash
# Register super_admin
curl -X POST https://YOUR-BACKEND-URL.onrender.com/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@schoolai.test","password":"admin123","role":"super_admin","full_name":"Super Admin"}'

# Login → get token
curl -X POST https://YOUR-BACKEND-URL.onrender.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@schoolai.test","password":"admin123"}'

# Seed full demo data
curl -X POST https://YOUR-BACKEND-URL.onrender.com/admin/seed-full \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Then log in at your Vercel URL with `admin@schoolai.test` / `admin123`.

### Troubleshooting
- **Login fails on Vercel**: You forgot to set `VITE_API_URL`. The login page will show "Cannot reach the server" if the backend URL is wrong/unset.
- **CORS errors in console**: Add your Vercel URL to the `ALLOWED_ORIGINS` env var on Render.
- **Backend sleeps on free tier**: Render's free tier sleeps after 15 min of inactivity. First request after sleep takes ~30s. Upgrade to paid tier for production use.
- **`Failed to resolve import "html2canvas"` (or `"jspdf"`) overlay in the browser**: your `node_modules` is stale — the PDF export deps were added to `frontend/package.json` after your last install. Fix: stop the dev server, then run `npm install` inside `frontend/`, and start it again (`npm run dev`). Never copy newer `src/` files over an older checkout without re-installing dependencies.

## License
MIT
