import { ConflictError, WorkspaceDatabase } from './database.js';
import type { Store } from './operations.js';

/** Persistence used by operations.ts. SQLite for local use, Supabase when its environment variables are set. */
export interface Storage {
  read(): Promise<Store>;
  /** Saves the workspace and resolves with the ids of activity events that are new. Rejects with ConflictError (409) on a stale revision. */
  save(next: Store): Promise<string[]>;
  health(): Promise<{ engine: string; schemaVersion: number; ready: boolean }>;
  close(): void;
}

export class SqliteStorage implements Storage {
  constructor(private db: WorkspaceDatabase) {}
  async read() { return this.db.read(); }
  async save(next: Store) { return this.db.save(next); }
  async health() { return this.db.health(); }
  close() { this.db.close(); }
}

export interface SupabaseConfig { url: string; key: string; secret: string }
export const supabaseConfig = (): SupabaseConfig | null => {
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || '', secret = process.env.SUPABASE_RPC_SECRET || '';
  return url && key && secret ? { url, key, secret } : null;
};

/**
 * Stores the workspace in Supabase through the tracker_* SQL functions (see supabase/schema.sql).
 * The backend only needs the project URL, the publishable key and the shared RPC secret.
 */
export class SupabaseStorage implements Storage {
  constructor(private config: SupabaseConfig, private seed: () => Store) {}
  private async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.config.url}/rest/v1/rpc/${name}`, {
        method: 'POST', headers: { apikey: this.config.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_secret: this.config.secret, ...args }), signal: AbortSignal.timeout(25000),
      });
    } catch { throw new Error('Supabase is unreachable. Check SUPABASE_URL and the network.'); }
    const data = await response.json().catch(() => null) as { message?: string; hint?: string } | T | null;
    if (!response.ok) {
      const message = String((data as { message?: string } | null)?.message || `Supabase request failed (${response.status}).`);
      if (message.startsWith('CONFLICT:')) throw new ConflictError(message.slice(9).trim());
      if (message.startsWith('UNAUTHORIZED')) throw new Error('Supabase rejected SUPABASE_RPC_SECRET. It must match the secret in tracker_private.');
      if (/Could not find the function|schema cache/.test(message)) throw new Error('Supabase schema is missing. Run supabase/schema.sql in the Supabase SQL Editor.');
      throw new Error(message);
    }
    return data as T;
  }
  async read(): Promise<Store> {
    const state = await this.rpc<Store | null>('tracker_read', {});
    if (state) return state;
    // First run: create the workspace from the optional workbook snapshot, or empty with default lead times.
    try { await this.save({ ...this.seed(), revision: 0 }); } catch (error) { if (!(error instanceof ConflictError)) throw error; /* another instance initialised it first */ }
    const created = await this.rpc<Store | null>('tracker_read', {});
    if (!created) throw new Error('Supabase workspace could not be initialised.');
    return created;
  }
  async save(next: Store): Promise<string[]> {
    const result = await this.rpc<{ revision: number; newActivityIds: string[] }>('tracker_save', { p_state: next, p_expected_revision: next.revision ?? 0 });
    return result.newActivityIds;
  }
  /** True once the workspace has been created in Supabase. */
  async initialized() { return (await this.rpc<{ initialized: boolean }>('tracker_ready', {})).initialized; }
  async health() {
    const result = await this.rpc<{ initialized: boolean }>('tracker_ready', {});
    return { engine: 'supabase', schemaVersion: 1, ready: result !== null && typeof result === 'object' };
  }
  close() { /* stateless HTTP client */ }
}
