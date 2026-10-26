import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Store } from './operations.js';

export class ConflictError extends Error { status = 409; }
type Row = Record<string, string | number | null>;
const payload = <T>(row: Row) => JSON.parse(String(row.payload)) as T;

/** SQLite owns persistence; business validation stays in operations/routes. */
export class WorkspaceDatabase {
  private db: DatabaseSync;
  constructor(readonly filename: string, legacyFile: string, seed: () => Store) {
    mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS workspace_meta (
        id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL,
        payload TEXT NOT NULL CHECK(json_valid(payload)), updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY, pi TEXT NOT NULL, customer TEXT NOT NULL, vendor TEXT NOT NULL,
        quantity INTEGER NOT NULL CHECK(quantity > 0),
        china INTEGER NOT NULL CHECK(china >= 0 AND china <= quantity),
        loaded INTEGER NOT NULL CHECK(loaded >= 0 AND loaded <= china),
        india INTEGER NOT NULL CHECK(india >= 0 AND india <= loaded),
        delivered INTEGER NOT NULL CHECK(delivered >= 0 AND delivered <= india),
        payload TEXT NOT NULL CHECK(json_valid(payload)), position INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS products_pi ON products(pi);
      CREATE INDEX IF NOT EXISTS products_customer ON products(customer);
      CREATE INDEX IF NOT EXISTS products_vendor ON products(vendor);
      CREATE TABLE IF NOT EXISTS lead_times (
        category TEXT NOT NULL, subcategory TEXT NOT NULL,
        payload TEXT NOT NULL CHECK(json_valid(payload)), position INTEGER NOT NULL,
        PRIMARY KEY(category, subcategory)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS drafts (
        id TEXT PRIMARY KEY, product_id TEXT NOT NULL, matched_product_id TEXT REFERENCES products(id),
        status TEXT NOT NULL CHECK(status IN ('Pending','Approved','Rejected')),
        payload TEXT NOT NULL CHECK(json_valid(payload)), position INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS drafts_status ON drafts(status);
      CREATE TABLE IF NOT EXISTS activity (
        id TEXT PRIMARY KEY, product_id TEXT NOT NULL, action TEXT NOT NULL,
        document TEXT NOT NULL, at TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), position INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS activity_product ON activity(product_id, at);
      CREATE INDEX IF NOT EXISTS activity_movement ON activity(product_id, action, document);
      CREATE TABLE IF NOT EXISTS shipments (id TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK(json_valid(payload)), position INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS source_exceptions (id TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK(json_valid(payload)), position INTEGER NOT NULL) STRICT;
      PRAGMA user_version = 1;
    `);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (!this.db.prepare('SELECT id FROM workspace_meta WHERE id = 1').get()) {
        const initial = existsSync(legacyFile) ? JSON.parse(readFileSync(legacyFile, 'utf8')) as Store : seed();
        this.validate(initial);
        this.write(initial, 1);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); this.db.close(); throw error; }
  }
  private validate(s: Store) {
    if (s.version !== 1 || !s.source || !['products','leads','drafts','activity','shipments','exceptions'].every(key => Array.isArray(s[key as keyof Store]))) throw new Error('Unsupported or corrupt workspace data. The original file has not been changed.');
    if (!s.leads.length) throw new Error('Workspace lead times are missing.');
    for (const key of ['products','drafts','activity'] as const) if (new Set(s[key].map(row => row.id)).size !== s[key].length) throw new Error(`Duplicate identifiers in ${key}.`);
  }
  private write(s: Store, revision: number) {
    const product = this.db.prepare(`INSERT INTO products VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET pi=excluded.pi,customer=excluded.customer,vendor=excluded.vendor,quantity=excluded.quantity,china=excluded.china,loaded=excluded.loaded,india=excluded.india,delivered=excluded.delivered,payload=excluded.payload,position=excluded.position`);
    s.products.forEach((p,i) => product.run(p.id,p.pi,p.customer,p.vendor,p.quantity,p.china,p.loaded,p.india,p.delivered,JSON.stringify(p),i));
    const lead = this.db.prepare('INSERT INTO lead_times VALUES(?,?,?,?) ON CONFLICT(category,subcategory) DO UPDATE SET payload=excluded.payload,position=excluded.position');
    s.leads.forEach((l,i) => lead.run(l.category,l.subcategory,JSON.stringify(l),i));
    const ids = new Set(s.products.map(p=>p.id));
    const draft = this.db.prepare('INSERT INTO drafts VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,payload=excluded.payload,position=excluded.position');
    s.drafts.forEach((d,i) => draft.run(d.id,d.productId,ids.has(d.productId)?d.productId:null,d.status,JSON.stringify(d),i));
    const activity = this.db.prepare('INSERT INTO activity VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET position=excluded.position');
    s.activity.forEach((a,i) => activity.run(a.id,a.productId,a.action,a.document,a.at,JSON.stringify(a),i));
    const shipment = this.db.prepare('INSERT INTO shipments VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,position=excluded.position');
    s.shipments.forEach((row,i) => shipment.run(row.Shipment_ID,JSON.stringify(row),i));
    const exception = this.db.prepare('INSERT INTO source_exceptions VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,position=excluded.position');
    s.exceptions.forEach((row,i) => exception.run(row.Exception_ID,JSON.stringify(row),i));
    this.db.prepare('INSERT INTO workspace_meta VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at').run(revision,JSON.stringify({version:s.version,source:s.source,importedAt:s.importedAt}),new Date().toISOString());
  }
  read(): Store {
    this.db.exec('BEGIN');
    try {
      const meta=this.db.prepare('SELECT revision,payload FROM workspace_meta WHERE id=1').get() as Row;
      const result={...payload<Pick<Store,'version'|'source'|'importedAt'>>(meta),revision:Number(meta.revision)} as Store;
      for(const [key,table] of [['products','products'],['leads','lead_times'],['drafts','drafts'],['activity','activity'],['shipments','shipments'],['exceptions','source_exceptions']] as const) {
        (result[key] as unknown[]) = (this.db.prepare(`SELECT payload FROM ${table} ORDER BY position`).all() as Row[]).map(row=>payload(row));
      }
      this.db.exec('COMMIT'); return result;
    } catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  save(next: Store) {
    this.validate(next);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current=this.db.prepare('SELECT revision FROM workspace_meta WHERE id=1').get() as Row;
      if(next.revision!==Number(current.revision)) throw new ConflictError('Workspace changed since you loaded it. Refresh and try again.');
      const byId=new Map(next.activity.map(a=>[a.id,JSON.stringify(a)]));
      for(const row of this.db.prepare('SELECT id,payload FROM activity').all() as Row[]) if(byId.get(String(row.id))!==row.payload) throw new ConflictError('Existing audit events cannot be changed or removed.');
      for(const row of this.db.prepare('SELECT id FROM products').all() as Row[]) if(!next.products.some(p=>p.id===row.id)) throw new ConflictError('Existing products cannot be silently removed.');
      this.write(next,Number(current.revision)+1);
      this.db.exec('COMMIT');
    } catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  health(){return {engine:'sqlite',schemaVersion:Number((this.db.prepare('PRAGMA user_version').get() as Row).user_version),ready:this.db.prepare('SELECT 1 FROM workspace_meta WHERE id=1').get()!==undefined};}
  close(){this.db.close();}
}
