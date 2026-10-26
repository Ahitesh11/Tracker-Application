import { Router } from 'express';
import { sheets } from '../integrations/google/sheets.js';
import { getState, productHeaders, productRows, activityHeaders, activityRow } from '../operations.js';
import { HttpError } from '../http.js';
export const integrationsRouter = Router();
integrationsRouter.get('/status', (_req, res) => res.json({
  sheets: sheets.enabled ? (sheets.lastError ? 'error' : 'connected') : 'disconnected', sheetsError: sheets.lastError || undefined, sheetsLastSync: sheets.lastSyncAt || undefined,
  sheetsMode: sheets.mode, sheetsServiceAccount: sheets.mode === 'service-account' ? sheets.serviceAccountEmail || undefined : undefined,
  drive: 'disconnected', appsScript: 'disabled', ai: 'local-rules-available', aiGatewayConfigured: Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN),
}));
// Full resync: rewrites the Products tab and the whole Activity_Log tab from the database.
integrationsRouter.post('/sheets/sync', async (_req, res) => {
  if (!sheets.enabled) throw new HttpError(400, 'Google Sheets is not configured. Set GOOGLE_APPS_SCRIPT_WEB_APP_URL and GOOGLE_APPS_SCRIPT_SECRET in backend/.env.');
  const s = getState();
  try {
    await sheets.replace('Products', productHeaders, productRows(s));
    await sheets.replace('Activity_Log', activityHeaders, [...s.activity].reverse().map(activityRow));
  } catch (error) { throw new HttpError(502, `Google Sheets sync failed: ${error instanceof Error ? error.message : 'unknown error'}`); }
  res.json({ ok: true, products: s.products.length, activity: s.activity.length, syncedAt: sheets.lastSyncAt });
});
