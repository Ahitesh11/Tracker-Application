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

### 3. Sign-in and roles (optional, recommended once the app is online)
Set `APP_USERS` on the backend to turn login on: `name:role:password`, separated by commas.
```
APP_USERS=ravi:india:Pass1,li:china:Pass2,wang:warehouse:Pass3,boss:management:Pass4
```
Without it the app is open and everyone acts as Management. With it, every request needs a signed session (12 hours, HttpOnly cookie), the signed-in name is written to the audit log, and the backend enforces what each role may do:

| Role | Can do |
|---|---|
| India Controller | create products, authorize production, revise delivery date, India receiving / delivery / return drafts, approve or reject drafts, close product lines |
| China Controller | production instruction, acknowledgment, start, complete, vendor call-out, China receiving and loading drafts, shipments, resolve exceptions |
| Warehouse / Logistics | create movement drafts (receiving, loading, delivery, return), shipments, raise exceptions |
| Management | everything, plus reopening product lines and exceptions, editing lead times and downloading the backup |

### 3b. Photos and AI receiving audit
- **Container loading** and **India receiving** drafts need at least one photo (camera or gallery, up to 8, shrunk in the browser). Photos go to the private Supabase Storage bucket `shipment-evidence` through the backend; they are shown with short-lived signed links.
- Set `SUPABASE_SERVICE_ROLE_KEY` on the backend (Project Settings → API). The bucket is created on the first upload, or run [supabase/storage.sql](supabase/storage.sql).
- When an India receiving draft is created, the AI (needs `OPENAI_API_KEY`) compares the China loading photos with the India receiving photos and the quantities, and shows **Match / Mismatch / Needs review** in the Approval Inbox with findings. It only advises: approving a *Mismatch* needs an explicit confirmation, and a reviewer still decides.

### 4. AI (optional)
`OPENAI_API_KEY` (and optionally `OPENAI_MODEL`, default `gpt-4o-mini`) enables OpenAI in the AI Assistant: chat answers over a compact summary of your workspace, and **Read a receipt or message**, which turns pasted text into movement *proposals*. Proposals only become drafts when an operator clicks create, and a draft never changes stock until a reviewer approves it. Ollama and AI Gateway are also supported (see `.env.example`).

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

## Language (English / 简体中文)
Use the **EN | 中文** switch in the header (or on the sign-in page). The choice is remembered in the browser; a browser set to Chinese starts in Chinese. Menus, forms, statuses, alerts, dates and the backend's error messages are translated. Names, notes, products and other text that people type are shown as entered. The AI Assistant answers in Chinese when OpenAI, Ollama or AI Gateway is selected; the built-in local rules answer in English only.

To add or change a translation, edit `frontend/src/i18n/zh.json` (English text is the key; sentences with numbers or names are rebuilt in `frontend/src/i18n/patterns.ts`). `npm test` fails if a text used by the screens has no Chinese translation.

## How it works
- **Flow**: PI → approve → instruction → acknowledgment / start → production ready → **vendor call-out** → China receiving → container loading → dispatch → India receiving → customer delivery (partial returns allowed) → **close product line**. Each confirmation is a separate record; the stage is derived from the quantities.
- **Planning** works backwards: required delivery − (transit + buffers) = latest completion; minus manufacturing days = latest start; minus the instruction confirmation buffer (default 7 days) = latest instruction. Category lead times are editable in the app and every change is logged.
- **Exceptions**: damage, shortage, late vendor and similar problems get an owner and a deadline; damaged or missing units can be held in **quarantine** so they cannot be loaded; resolving needs a note and, for quarantined units, a decision (release to stock or remove). Management can reopen.
- **Closing**: needs no open exceptions, no pending drafts and no goods left in a warehouse or in transit; closing with an undelivered balance (short close) needs confirmation and a reason. A closed line is locked until Management reopens it.
- **Duplicate clicks**: every form sends a request key, so retrying a save never creates a second record.
- **Approval inbox**: a movement draft changes stock only when approved, validates quantities (ordered ≥ China ≥ loaded ≥ India ≥ delivered) and posts once per document reference.
- **Action Centre** recomputes overdue work and missing steps whenever data is requested.
- **Assistant**: local rules by default; optional Ollama or AI Gateway with a read-only workspace tool. It cannot approve or send anything.
