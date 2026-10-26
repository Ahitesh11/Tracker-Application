# Forma — China-to-India sourcing operations

A local React/TypeScript workspace with an Express API and transactional SQLite database. An optional starting dataset can be imported from a private workbook snapshot; the repository itself ships with no business data.

## What works

- 15 imported product lines, 3 PIs, customers, vendors and category lead times.
- Product search, customer/stage filters, PI scope, CSV export and new product entry.
- Product detail: stock balances, backward production plan, milestones, source conflicts and history.
- Authorization → instruction → vendor acknowledgment → production start → completion.
- Partial China receipts → container loading → India receipts → customer deliveries.
- Movement drafts and explicit operator approval. Approval validates stock and posts once to the activity log.
- Action Centre recomputes overdue work, missing acknowledgments, collection/loading/delivery gaps and imported data reviews.
- Customer reconciliation, local JSON backup and editable category lead times.
- Assistant: useful local rules, optional Ollama chat, optional AI Gateway agent with a read-only workspace tool.

## Run

From this project folder, use two terminals:

```powershell
npm.cmd run dev:frontend
```

```powershell
npm.cmd run dev:backend
```

Open **http://127.0.0.1:5173**. Frontend port 5173 proxies `/api` to backend port 3001. Both bind to loopback. The login screen remains a design preview; this is a single-computer workspace without multi-user authentication.

Environment configuration is optional for local rules. To configure AI, copy `backend/.env.example` to `backend/.env` and restart the backend. Never put secrets in `VITE_` variables.

## AI setup

### Local rules — available immediately

Select **Local rules** in AI Assistant. Ask for pending India deliveries, China stock, production work, or `Draft a vendor follow-up for PRD-ORD20260087-01`. These are deterministic summaries and templates, clearly labeled as local rules, not a connected language model.

### Ollama — local model

Install/run Ollama and install a model suitable for your computer. The app discovers installed model names using `/api/tags`; it does not guess or download models. Default server: `http://127.0.0.1:11434`. Set `OLLAMA_BASE_URL` on the backend if necessary. Open **Connections & Planning → Test connections**, then select **Ollama** and a detected model in AI Assistant. Requests use `/api/chat`, non-streaming, with a timeout. Workspace facts and your question go to that configured server.

Official API: https://docs.ollama.com/api/chat and https://docs.ollama.com/api/tags.

### AI Gateway — cloud model

Set these in `backend/.env`:

```dotenv
AI_GATEWAY_API_KEY=your_gateway_key
AI_MODEL=provider/model-id
```

Choose an actual current model ID from https://ai-gateway.vercel.sh/v1/models. No model or key is hardcoded. Restart the backend, test connections, then choose **AI Gateway** in AI Assistant. The installed AI SDK's `ToolLoopAgent` uses a read-only workspace tool with a three-step limit. Questions and returned workspace data are sent to the configured cloud model. No cloud AI calls happen in local rules mode. See https://vercel.com/docs/ai-gateway/getting-started.

The assistant cannot approve records, send messages, pay suppliers, or claim live carrier/GPS data. It can answer questions and prepare text. Operators record real movements and approve them in the app.

## Everyday operation

1. Open **Products & Orders**, find a product, click its name.
2. Use **Update product** to record authorization, instruction, acknowledgment and factory progress.
3. Use **Record movement** with quantity and a unique receipt/document reference. For loading, supply shipment and container references.
4. In **Approval Inbox**, enter your reviewer name and check product, quantity, evidence and document. Approve or reject.
5. Quantities, derived stages, actions, reports and history update together. Partial movements leave the balance open.
6. Use **Action Centre** each day. Assign a next action, owner and deadline. Resolve imported data issues only after checking evidence.
7. Download a workspace backup regularly.

## Data and planning

- **Fresh start:** the repository contains no customer data. Without `backend/data/workbook.json` (private, gitignored) the app starts as an empty workspace with generic category lead times from `backend/src/default-leads.ts`. Add products in the app; every saved record is mirrored to Google Sheets. Tests use the anonymized fixture `backend/test/fixtures/sample-workbook.json` (set `FMS_SEED_FILE` to use another snapshot).
- `backend/data/workbook.json`: read-only source snapshot, including original cell references and cached workbook formula values.
- `backend/data/forma.sqlite`: persistent SQLite database with product, lead-time, draft, activity, shipment and exception tables. Stock changes, approvals, audit events and revision increments commit in a single transaction.
- `scripts/import-workbook.ps1`: repeatable read-only OOXML extraction. It never executes workbook macros, formulas or embedded instructions. It uses Windows ZIP/XML support and does not modify the workbook.
- An existing `backend/data/workspace.json` is migrated once on first database initialization. The legacy JSON is left unchanged. Later restarts load SQLite, never replay the seed.
- Source sheet `01_Master_Products` owns product rows. Lead times come from `Production_Lead_Time_Master`. Approval queue and approved movements are imported separately; approved source movements are not replayed against opening balances.
- Duplicate `Qty_Received_China` columns can disagree. Use a product?s Update product ? Reconcile imported balances with evidence to correct opening quantities. Import preserves both in the snapshot, uses the higher quantity as the opening balance and flags the conflict for review. Production-versus-receipt conflicts are also flagged.
- Effective/revised customer dates are used for planning; legacy dates remain visible as source conflicts. Dates are recalculated in India time instead of trusting cached `TODAY()` results.
- Latest completion = required delivery minus transit and all logistics buffers. Latest start = latest completion minus manufacturing days.
- The example includes March/April operational dates alongside late-2026/2027 required dates. These are preserved, so overdue alerts are expected. No dates or statuses are silently made current.
- No workbook prices were provided; the app does not invent monetary totals.

To extract a different workbook snapshot (for a new workspace):

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/import-workbook.ps1 -WorkbookPath 'C:\path\MAIN SHEET PT.xlsx'
```

An initialized SQLite database takes precedence over the legacy JSON and seed snapshot. Re-importing a seed does **not** overwrite saved app changes. Back up first and reconcile a new workbook deliberately; automatic merging and Excel write-back are not implemented.

## Checks

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
```

The API and database tests use temporary isolated SQLite databases. It covers source mapping, planning, product creation, required sequence, partial movements, quantity bounds, duplicate/repeated approvals, rejection, backup, restart persistence, local assistant, the Ollama adapter against a mock server, and cloud-configuration errors. It does not contact a paid model or modify the real workspace.

## Boundaries

Carrier statuses are manually recorded workbook events. Google Sheets/Drive, WhatsApp/email, document/image OCR, live carrier APIs, scheduled notifications, user authentication and shared cloud storage are not connected. File names in source evidence fields are references, not uploaded attachments. Local alert computation runs when workspace data is requested; it is not a background notification service.

Before a multi-user or public deployment, add authenticated roles, a hosted database strategy, attachment storage and approved communication integrations. No deployment or external account was created by this change.

## Backend API

The running backend exposes human-readable docs at http://127.0.0.1:3001/api/docs and an OpenAPI specification at `/api/openapi.json`. Health and readiness are `/api/health` and `/api/ready`. Read [backend/README.md](backend/README.md) for database paths, migrations, endpoints and operating details.

Writes accept an optional workspace `revision`; the frontend supplies it automatically. Stale revisions return HTTP 409 instead of overwriting newer records. SQL constraints protect quantity balances and existing audit events cannot be edited or removed.

The bundled Node.js 22.15 runtime supports `node:sqlite` and emits its experimental-feature notice. No native database dependency or separate database server is required.
