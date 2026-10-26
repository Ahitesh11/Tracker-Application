// One-time copy of the local SQLite workspace into an EMPTY Supabase workspace.
// Usage (from the project folder, after running supabase/schema.sql and filling backend/.env):
//   npm run build --workspace backend && node scripts/migrate-local-to-supabase.mjs
import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
dotenv.config({ path: new URL('../backend/.env', import.meta.url) });
const { WorkspaceDatabase } = await import('../backend/dist/database.js');
const { SupabaseStorage, supabaseConfig } = await import('../backend/dist/storage.js');
const config = supabaseConfig();
if (!config) { console.error('Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_RPC_SECRET in backend/.env first.'); process.exit(1); }
const file = process.env.FMS_DB_FILE || new URL('../backend/data/forma.sqlite', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
if (!existsSync(file)) { console.error('No local database found at ' + file); process.exit(1); }
const local = new WorkspaceDatabase(file, file + '.none.json', () => { throw new Error('No local workspace to migrate.'); }).read();
const cloud = new SupabaseStorage(config, () => { throw new Error('unused'); });
if (await cloud.initialized()) { console.error('Supabase already contains a workspace. Refusing to overwrite it.'); process.exit(1); }
await cloud.save({ ...local, revision: 0 });
console.log(`Copied ${local.products.length} products, ${local.drafts.length} drafts, ${local.activity.length} activity events and ${local.shipments.length} shipments to Supabase.`);
process.exit(0);
