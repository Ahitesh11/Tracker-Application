# Tracker (Forma) — China-to-India sourcing operations

Track every product line from PI to customer delivery: authorization, factory progress, China warehouse, container loading, India receiving and delivery. Movements are drafted by operators and posted only after an explicit approval. Data lives in **Supabase**.

```
frontend/            React + TypeScript UI (Vite)
backend/             Express API (src) and tests
api/index.mjs        Vercel serverless entry that serves the backend under /api
vercel.json          One-project Vercel build and routing
supabase/schema.sql  Database tables and functions (run once)
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
CORS_ORIGINS=<only needed when the frontend is on a different domain>
```
Without the three Supabase variables the API answers HTTP 503 ("Supabase is not configured").

## Run locally
```powershell
npm.cmd install        # first time only
npm.cmd run dev        # backend on http://127.0.0.1:3001 and frontend on http://127.0.0.1:5173
```
Open http://127.0.0.1:5173. `npm run dev:backend` and `npm run dev:frontend` start each part separately (API docs at `/api/docs`). `npm test` builds the backend and runs the unit tests (movement rules, planning, alerts, Supabase client).

## Deploy on Vercel (one project, one push)
The repository root is a single Vercel project: [vercel.json](vercel.json) builds the frontend (`frontend/dist`) and serves the Express API from [api/index.mjs](api/index.mjs) under `/api`. Frontend and API share one domain, so there is no CORS setup and no `VITE_API_BASE_URL`.

| Setting | Value |
|---|---|
| Root Directory | repository root (leave empty) |
| Framework Preset | Other |
| Build / Install / Output | taken from `vercel.json` (do not override) |
| Node.js version | 22.x |
| Environment variables | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_RPC_SECRET` |

Every `git push` to `main` redeploys everything. Turn off Vercel Authentication if the URL should open without a Vercel login. The app has no sign-in of its own, so anyone with the URL can use it.

## How it works
- **Stage** is derived from quantities: authorization → production → China received → loaded → India received → delivered.
- **Planning** works backwards: required delivery − (transit + buffers) = latest completion; minus manufacturing days = latest start. Category lead times are editable in the app.
- **Approval inbox**: a movement draft changes stock only when approved, validates quantities (ordered ≥ China ≥ loaded ≥ India ≥ delivered) and posts once per document reference.
- **Action Centre** recomputes overdue work and missing steps whenever data is requested.
- **Assistant**: local rules by default; optional Ollama or AI Gateway with a read-only workspace tool. It cannot approve or send anything.
