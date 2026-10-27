# Tracker (Forma) — China-to-India sourcing operations

Track every product line from PI to customer delivery: authorization, factory progress, China warehouse, container loading, India receiving and delivery. Movements are drafted by operators and posted only after an explicit approval. Data lives in **Supabase** and every saved record is mirrored to a **Google Sheet**.

```
frontend/            React + TypeScript UI (Vite)
backend/             Express API (src), Vercel entry (api/index.mjs), tests
supabase/schema.sql  Database tables and functions (run once)
automation/apps-script/GoogleAppsScript.gs   Receives rows and writes the Google Sheet
```

## Setup

### 1. Supabase
1. Supabase → **SQL Editor**: paste [supabase/schema.sql](supabase/schema.sql), replace `CHANGE-ME-SECRET` (last statement) with a long random text, run it.
2. **Project Settings → API**: copy the **Project URL** and the **publishable / anon key**.

The browser never talks to Supabase. Only the backend does, through four SQL functions that all require the shared secret; tables have row level security with no public policy, so the publishable key alone cannot read or change data. Saves are atomic, a stale screen gets HTTP 409, and audit events can never be edited.

### 2. Backend environment (`backend/.env`, see `.env.example`)
```
SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
SUPABASE_ANON_KEY=<publishable key>
SUPABASE_RPC_SECRET=<same text as in the SQL>
GOOGLE_APPS_SCRIPT_WEB_APP_URL=<optional, see below>
GOOGLE_APPS_SCRIPT_SECRET=<optional>
CORS_ORIGINS=<your frontend URL(s), comma separated>
```
Without the three Supabase variables the API answers HTTP 503 ("Supabase is not configured").

### 3. Google Sheet (optional)
Follow [automation/apps-script/README.md](automation/apps-script/README.md). After each save the backend appends the new events to the `Activity_Log` tab and rewrites the `Products` tab. A Sheet failure never blocks a save.

## Run locally
```powershell
npm.cmd run dev:backend      # http://127.0.0.1:3001  (API docs at /api/docs)
npm.cmd run dev:frontend     # http://127.0.0.1:5173  (proxies /api to the backend)
```
`npm test` builds the backend and runs the unit tests (movement rules, planning, alerts, Supabase client).

## Deploy on Vercel (two projects from this repo)
| | Backend | Frontend |
|---|---|---|
| Root Directory | `backend` | `frontend` |
| Framework | Other (set in `vercel.json`) | Vite |
| Environment variables | the backend variables above | `VITE_API_BASE_URL` = backend URL |

Set `CORS_ORIGINS` on the backend to the frontend URL. Turn off Vercel Authentication if the URLs should be reachable without a Vercel login. The app has no sign-in of its own, so anyone with the URL can use it.

## How it works
- **Stage** is derived from quantities: authorization → production → China received → loaded → India received → delivered.
- **Planning** works backwards: required delivery − (transit + buffers) = latest completion; minus manufacturing days = latest start. Category lead times are editable in the app.
- **Approval inbox**: a movement draft changes stock only when approved, validates quantities (ordered ≥ China ≥ loaded ≥ India ≥ delivered) and posts once per document reference.
- **Action Centre** recomputes overdue work and missing steps whenever data is requested.
- **Assistant**: local rules by default; optional Ollama or AI Gateway with a read-only workspace tool. It cannot approve or send anything.
