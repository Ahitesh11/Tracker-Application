import { GoogleAuth } from 'google-auth-library';
import { readFileSync } from 'node:fs';

export interface SheetReadRequest { spreadsheetId: string; range: string; }
export interface SheetsReader { read(request: SheetReadRequest): Promise<readonly (readonly string[])[]>; }
export class DisconnectedSheetsReader implements SheetsReader { async read(_request: SheetReadRequest): Promise<readonly (readonly string[])[]> { throw new Error('Google Sheets is not connected'); } }

type Cell = string | number;
const base = 'https://sheets.googleapis.com/v4/spreadsheets/';

/** Writes operator submissions to a Google Sheet through a service account. Disabled until configured. */
export class SheetsWriter {
  private auth?: GoogleAuth;
  private ready = new Set<string>();
  lastError = '';
  lastSyncAt = '';
  constructor(
    private spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '', private keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_FILE || '',
    private scriptUrl = process.env.GOOGLE_APPS_SCRIPT_WEB_APP_URL || '', private secret = process.env.GOOGLE_APPS_SCRIPT_SECRET || '',
  ) {}
  /** Apps Script web app takes priority; the service account is the alternative transport. */
  get mode() { return this.scriptUrl ? 'apps-script' : this.spreadsheetId && this.keyFile ? 'service-account' : 'off'; }
  get enabled() { return this.mode !== 'off'; }
  private async script(action: 'append' | 'replace', tab: string, headers: string[], rows: Cell[][]) {
    if (!this.secret) throw new Error('GOOGLE_APPS_SCRIPT_SECRET is not set.');
    const response = await fetch(this.scriptUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ secret: this.secret, action, tab, headers, rows }), redirect: 'follow', signal: AbortSignal.timeout(30000) });
    const data = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
    if (!response.ok || !data?.ok) throw new Error(data?.error || `Apps Script request failed (${response.status}). Check the web app URL and that access is set to Anyone.`);
  }
  get serviceAccountEmail() { try { return JSON.parse(readFileSync(this.keyFile, 'utf8')).client_email as string; } catch { return ''; } }
  private async request(path: string, method: string, body?: unknown) {
    this.auth ??= new GoogleAuth({ keyFile: this.keyFile, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    const token = await (await this.auth.getClient()).getAccessToken();
    const response = await fetch(base + this.spreadsheetId + path, { method, headers: { Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const data = await response.json().catch(() => ({})) as any;
    if (!response.ok) throw new Error(data?.error?.message || `Google Sheets request failed (${response.status})`);
    return data;
  }
  /** Creates the tab and header row once if the tab is missing. */
  private async ensureTab(tab: string, headers: string[]) {
    if (this.ready.has(tab)) return;
    const meta = await this.request('?fields=sheets.properties.title', 'GET');
    if (!meta.sheets?.some((s: any) => s.properties.title === tab)) {
      await this.request(':batchUpdate', 'POST', { requests: [{ addSheet: { properties: { title: tab } } }] });
      await this.request(`/values/${encodeURIComponent(tab + '!A1')}?valueInputOption=RAW`, 'PUT', { values: [headers] });
    }
    this.ready.add(tab);
  }
  async append(tab: string, headers: string[], rows: Cell[][]) {
    if (!this.enabled || !rows.length) return;
    try {
      if (this.mode === 'apps-script') await this.script('append', tab, headers, rows);
      else {
        await this.ensureTab(tab, headers);
        await this.request(`/values/${encodeURIComponent(tab + '!A1')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, 'POST', { values: rows });
      }
      this.lastError = ''; this.lastSyncAt = new Date().toISOString();
    } catch (error) { this.lastError = error instanceof Error ? error.message : 'Sheets sync failed'; console.error(JSON.stringify({ sheets: 'append failed', tab, error: this.lastError })); }
  }
  /** Replaces a whole tab (used for the full products snapshot). */
  async replace(tab: string, headers: string[], rows: Cell[][]) {
    if (!this.enabled) throw new Error('Google Sheets is not configured.');
    if (this.mode === 'apps-script') await this.script('replace', tab, headers, rows);
    else {
      await this.ensureTab(tab, headers);
      await this.request(`/values/${encodeURIComponent(tab)}:clear`, 'POST', {});
      await this.request(`/values/${encodeURIComponent(tab + '!A1')}?valueInputOption=USER_ENTERED`, 'PUT', { values: [headers, ...rows] });
    }
    this.lastError = ''; this.lastSyncAt = new Date().toISOString();
  }
}
export const sheets = new SheetsWriter();
