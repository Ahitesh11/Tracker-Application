# Operations architecture

The React browser loads `/api/workspace` through Vite's proxy. Express reads a transactional SQLite snapshot, recalculates product planning/alerts and returns the current revision.

## Source and persistence

`backend/data/workbook.json` is the extracted reference workbook. If a legacy `workspace.json` exists, it is migrated once without modification; otherwise the workbook seeds the new SQLite database. An initialized database is always authoritative.

Tables contain products, lead times, drafts, immutable activity, shipments, source exceptions and workspace metadata. Numeric inventory columns have SQL constraints. Unmatched imported drafts preserve their source reference but have no matched-product foreign key.

## Writes

Routes validate JSON, field types, dates and business sequence. A write reads a workspace snapshot, applies a valid operation and opens `BEGIN IMMEDIATE`. The database compares the revision, rejects changes/removal of existing audit events, upserts records and commits the new revision. On failure the transaction rolls back. The frontend additionally supplies its last seen revision to prevent a stale screen from overwriting newer records.

## APIs

`backend/src/openapi.ts` defines the API specification. `/api/docs` is human-readable; `/api/openapi.json` can be imported into API tooling. Individual product, inventory, approval, activity, shipment, customer, vendor, PI and reporting read APIs supplement the full frontend snapshot.

## AI boundary

Local rules read recorded facts. Ollama and AI Gateway requests are optional explicit connection choices. The bounded cloud agent has only a read-only workspace tool. No model can approve inventory, send messages or invent live carrier data.

## Operating boundary

SQLite is appropriate for this local application. Authentication, a hosted/shared database strategy, file attachments and external communication/live-carrier integrations are separate work. See backend/README.md for startup, migrations, configuration and tests.
