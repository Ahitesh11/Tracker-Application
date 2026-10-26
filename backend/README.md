# Forma backend

Express + TypeScript + Node built-in SQLite. The existing React application is connected through Vite's `/api` proxy. No separate database installation or cloud account is required for this local setup.

## Start

From the project root:

```powershell
npm.cmd run dev:backend
```

For the compiled backend:

```powershell
npm.cmd run build --workspace backend
npm.cmd run start --workspace backend
```

Default address: http://127.0.0.1:3001

- Human-readable API docs: `/api/docs`
- OpenAPI 3.1 JSON: `/api/openapi.json`
- Health with database engine/schema: `/api/health`
- Readiness: `/api/ready`

The server binds to loopback by default. It shuts down HTTP connections and closes SQLite on SIGINT/SIGTERM. Node.js 22.15+ is required; this installed Node 22 version prints an experimental notice for its built-in SQLite API.

## Database and migration

`backend/data/forma.sqlite` is created automatically. Tables:

| Table | Purpose |
| --- | --- |
| workspace_meta | Source provenance, schema and optimistic revision |
| products | Product identity, indexed PI/customer/vendor and constrained quantity balances |
| lead_times | Manufacturing, transit and logistics buffers by category/subcategory |
| drafts | Pending, approved and rejected movement proposals |
| activity | Existing audit events are immutable; new events are appended |
| shipments | Carrier, tracking reference and manually recorded dispatch/arrival status |
| source_exceptions | Preserved workbook exception records |

WAL mode, foreign-key enforcement, full synchronous durability and a busy timeout are enabled. Approval, balances, audit event and revision are written in one transaction. A database failure rolls the complete operation back. HTTP routes never concatenate user input into SQL.

Initialization order, only when the database is empty:

1. Migrate `backend/data/workspace.json` if it exists. Keep the original file unchanged.
2. Otherwise seed from the imported `backend/data/workbook.json` snapshot.
3. Future starts read SQLite. Changing the snapshot never resets saved data.

Do not copy only an open SQLite main file while ignoring its WAL. Use the application's JSON backup endpoint for a consistent portable snapshot, or stop the backend before copying the database files. Backup restoration is not exposed as an unauthenticated overwrite endpoint.

## Configuration

Copy `.env.example` to `.env` inside `backend` if you need custom settings:

| Variable | Default / purpose |
| --- | --- |
| PORT | 3001 |
| HOST | 127.0.0.1 |
| CORS_ORIGINS | Exact frontend origins localhost:5173 and 127.0.0.1:5173 |
| FMS_DB_FILE | Optional absolute SQLite path; default backend/data/forma.sqlite |
| FMS_STATE_FILE | Optional legacy JSON migration path; not the active store |
| OLLAMA_BASE_URL | http://127.0.0.1:11434 |
| AI_GATEWAY_API_KEY | Optional server-side cloud credential |
| AI_MODEL | Current provider/model ID for cloud AI |

No password or key belongs in frontend `VITE_` variables. Local-rule assistant answers need no model. Ollama and cloud AI remain optional and accurately report missing connections.

## Read APIs

| Method | Endpoint | Result |
| --- | --- | --- |
| GET | /api/workspace | Complete current frontend snapshot including revision |
| GET | /api/products | Paginated products; q, pi, customer, vendor, stage, page, limit |
| GET | /api/products/:id | Product, planning, activity and drafts |
| GET | /api/pis | Customer/order and product totals per PI |
| GET | /api/customers | Customer quantity reconciliation |
| GET | /api/vendors | Vendor names and product-line counts |
| GET | /api/shipments | Recorded shipments, current product allocations and history |
| GET | /api/inventory | China stock, in-transit quantities, India stock and delivery balances |
| GET | /api/approvals | Paginated drafts; status, page, limit |
| GET | /api/alerts | Paginated current actions; severity, owner, page, limit |
| GET | /api/activity | Paginated audit events; productId, q, page, limit |
| GET | /api/lead-times | Category planning drivers |
| GET | /api/reports/summary | Reconciled operational totals |
| GET | /api/workspace/backup | Consistent downloadable JSON backup |
| GET | /api/assistant/status | Ollama discovery and cloud configuration state |

Pagination defaults to 25 rows and is capped at 100 per request. Invalid query shapes and page values return 400. Database read snapshots are consistent; current local workspace APIs materialize the workspace before filtering, so this is intended for the current small local dataset rather than high-volume analytics.

## Write APIs

Send JSON objects with `Content-Type: application/json`. Maximum body size: 100 KB. Most writes accept an optional `revision` from the last workspace response; the app supplies it automatically. A stale revision returns 409. Independently of HTTP revisions, database commits also reject concurrent stale snapshots across backend connections.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | /api/workspace/products | Create an unreviewed product |
| POST | /api/workspace/products/:id/update | Validate production progression, follow-up, date change or imported balance reconciliation |
| POST | /api/workspace/drafts | Propose a physical movement; stock does not change |
| POST | /api/workspace/drafts/:id/review | Approve and post exactly once, or reject |
| POST | /api/workspace/shipments | Create/update recorded carrier status with dates, actor and notes |
| POST | /api/workspace/lead-times | Update category lead-time drivers |
| POST | /api/assistant/chat | Read-only local/Ollama/cloud assistant request |

Shipment status updates do not fabricate receipt quantities: physical India arrival reconciliation still needs a movement draft and approval. Imported historical stock is an opening balance, not a set of movements to replay.

Every API response carries `X-Request-Id`. Errors include `error` and `requestId`. Validation uses 400, unknown resources 404, unsupported media 415, oversized bodies 413, concurrent updates 409 and temporary database contention 503. No request bodies or keys are logged.

## Verification

```powershell
npm.cmd test
npm.cmd run typecheck
```

Tests cover legacy migration without source modification, two-connection conflicts, constraint rollback, immutable audit history, database integrity, product search/pagination, reconciliation, shipment tracking updates, stale HTTP revisions, malformed JSON, oversized payloads, CORS, production sequence, partial approved movements, duplicate blocking, restart persistence and AI adapters. Tests use isolated temporary databases and do not change your app records.

## Current scope

This is a working local backend, not an authenticated public service. Operator names are audit labels, not verified user identities. Multi-user login/roles, public deployment, carrier live APIs, Google synchronization and message delivery require their own configured integrations. No external account, deployment or paid AI call was created.
