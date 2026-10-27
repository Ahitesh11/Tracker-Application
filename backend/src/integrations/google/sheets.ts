type Cell = string | number;

/** Pushes saved records to a Google Sheet through the Apps Script web app (automation/apps-script). Disabled until configured. */
export class SheetsWriter {
  lastError = '';
  lastSyncAt = '';
  constructor(private url = process.env.GOOGLE_APPS_SCRIPT_WEB_APP_URL || '', private secret = process.env.GOOGLE_APPS_SCRIPT_SECRET || '') {}
  get enabled() { return Boolean(this.url); }
  private async send(action: 'append' | 'replace', tab: string, headers: string[], rows: Cell[][]) {
    if (!this.secret) throw new Error('GOOGLE_APPS_SCRIPT_SECRET is not set.');
    const response = await fetch(this.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ secret: this.secret, action, tab, headers, rows }), redirect: 'follow', signal: AbortSignal.timeout(30000) });
    const data = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
    if (!response.ok || !data?.ok) throw new Error(data?.error || `Apps Script request failed (${response.status}). Check the web app URL and that access is set to Anyone.`);
  }
  async append(tab: string, headers: string[], rows: Cell[][]) {
    if (!this.enabled || !rows.length) return;
    try { await this.send('append', tab, headers, rows); this.lastError = ''; this.lastSyncAt = new Date().toISOString(); }
    catch (error) { this.lastError = error instanceof Error ? error.message : 'Sheets sync failed'; console.error(JSON.stringify({ sheets: 'append failed', tab, error: this.lastError })); }
  }
  /** Replaces a whole tab (used for the products snapshot). */
  async replace(tab: string, headers: string[], rows: Cell[][]) {
    if (!this.enabled) throw new Error('Google Sheets is not configured.');
    await this.send('replace', tab, headers, rows);
    this.lastError = ''; this.lastSyncAt = new Date().toISOString();
  }
}
export const sheets = new SheetsWriter();
