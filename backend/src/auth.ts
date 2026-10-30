import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { HttpError, text } from './http.js';

export type Role = 'india' | 'china' | 'warehouse' | 'management';
export const roleLabels: Record<Role, string> = { india: 'India Controller', china: 'China Controller', warehouse: 'Warehouse / Logistics', management: 'Management' };
export interface SessionUser { name: string; role: Role; open?: boolean; pages?: string[] }
declare global { namespace Express { interface Request { user?: SessionUser } } }

const roleAliases: Record<string, Role> = { india: 'india', 'india-controller': 'india', china: 'china', 'china-controller': 'china', warehouse: 'warehouse', logistics: 'warehouse', management: 'management', admin: 'management', manager: 'management' };
/** APP_USERS = "name:role:password" entries separated by commas or new lines. Roles: india, china, warehouse, management. */
export function parseUsers(raw = process.env.APP_USERS || '') {
  const users: { name: string; role: Role; password: string }[] = [];
  for (const entry of raw.split(/[,\n;]/).map(value => value.trim()).filter(Boolean)) {
    const first = entry.indexOf(':'), second = entry.indexOf(':', first + 1);
    if (first < 1 || second < 0) throw new Error(`APP_USERS entry "${entry.split(':')[0]}" must look like name:role:password.`);
    const name = entry.slice(0, first), role = roleAliases[entry.slice(first + 1, second).toLowerCase()], password = entry.slice(second + 1);
    if (!role) throw new Error(`APP_USERS: unknown role for "${name}". Use india, china, warehouse or management.`);
    if (!password) throw new Error(`APP_USERS: "${name}" needs a password.`);
    users.push({ name, role, password });
  }
  return users;
}
/** Login is required once APP_USERS is set. Without it the app stays open (single-operator mode). */
export const supabaseAuthEnabled = () => process.env.AUTH_PROVIDER === 'supabase';
export const authEnabled = () => supabaseAuthEnabled() || parseUsers().length > 0;

export const pagePaths = ['/', '/orders', '/pi', '/production', '/callout', '/china-warehouse', '/shipments', '/india-receiving', '/delivery', '/fms', '/exceptions', '/approvals', '/audit-report', '/ai-assistant', '/reports', '/activity', '/administration', '/settings', '/guide'];
const permissionPages: Record<string, string[]> = {
  'users.manage': ['/administration'], 'product.edit': ['/orders', '/pi', '/production'], 'product.create': ['/orders', '/pi'],
  'production.authorize': ['/production'], 'production.instruct': ['/production'], 'production.ack': ['/production'], 'production.start': ['/production'], 'production.complete': ['/production'],
  'callout': ['/callout'], 'delivery.revise': ['/orders', '/pi', '/production'], 'followup': ['/orders', '/production', '/callout', '/fms'],
  'movement.China receiving': ['/china-warehouse'], 'movement.Container loading': ['/shipments'], 'movement.India receiving': ['/india-receiving'], 'movement.Customer delivery': ['/delivery'], 'movement.Customer return': ['/delivery'],
  'draft.review': ['/approvals'], 'shipment.manage': ['/shipments'], 'exception.raise': ['/exceptions'], 'exception.update': ['/exceptions'], 'exception.resolve': ['/exceptions'], 'exception.reopen': ['/exceptions'],
  'product.close': ['/orders'], 'product.reopen': ['/orders'], 'leadtimes.edit': ['/settings'], 'ai.use': ['/ai-assistant', '/audit-report']
};
export const userCan = (user: SessionUser, permission: string) => can(user.role, permission) && (!user.pages || Boolean(permissionPages[permission]?.some(page => user.pages!.includes(page))));
function selectedPages(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.some(page => typeof page !== 'string' || !pagePaths.includes(page))) throw new HttpError(400, 'Select at least one valid page.');
  return [...new Set(value)] as string[];
}
// What each role may do. The backend enforces this; the screens only hide what is not allowed.
const everyone: Role[] = ['india', 'china', 'warehouse', 'management'];
const rules: Record<string, Role[]> = {
  'users.manage': ['management'],
  'product.edit': ['india', 'china', 'management'],
  'product.create': ['india', 'management'],
  'production.authorize': ['india', 'management'],
  'delivery.revise': ['india', 'management'],
  'production.instruct': ['china', 'management'],
  'production.ack': ['china', 'management'],
  'production.start': ['china', 'management'],
  'production.complete': ['china', 'management'],
  'callout': ['china', 'management'],
  'followup': everyone,
  'movement.China receiving': ['china', 'warehouse', 'management'],
  'movement.Container loading': ['china', 'warehouse', 'management'],
  'movement.India receiving': ['india', 'warehouse', 'management'],
  'movement.Customer delivery': ['india', 'warehouse', 'management'],
  'movement.Customer return': ['india', 'warehouse', 'management'],
  'draft.review': ['india', 'management'],
  'shipment.manage': ['china', 'warehouse', 'management'],
  'exception.raise': everyone,
  'exception.update': everyone,
  'exception.resolve': ['india', 'china', 'management'],
  'exception.reopen': ['management'],
  'product.close': ['india', 'management'],
  'product.reopen': ['management'],
  'leadtimes.edit': ['management'],
  'ai.use': everyone,
};
export const can = (role: Role, permission: string) => rules[permission]?.includes(role) ?? false;
export const permissionsFor = (role: Role) => Object.keys(rules).filter(permission => can(role, permission));
export function requirePermission(req: { user?: SessionUser }, permission: string) {
  if (!req.user || !userCan(req.user, permission)) throw new HttpError(403, `Your role (${req.user ? roleLabels[req.user.role] : 'unknown'}) is not allowed to do this.`);
}
/** The name written to the audit log: the signed-in user, or the typed name in open mode. */
export function actorOf(req: { user?: SessionUser }, typed: unknown, max = 100) {
  if (req.user && !req.user.open) return req.user.name;
  return text(typed, max);
}

/** Internal Supabase identifier only: operators sign in with a normal username. */
export function usernameIdentity(value: string) {
  const username = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username)) throw new HttpError(400, 'Use a username of 3 to 40 letters, numbers, dots, underscores or hyphens.');
  return username + '@users.tracker.internal';
}
async function authFetch(path: string, token?: string, body?: unknown) {
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), key = process.env.SUPABASE_ANON_KEY;
  if (!base || !key) throw new HttpError(503, 'Supabase login is not configured.');
  return fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { apikey: key, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
}
export async function supabaseUser(token: string): Promise<SessionUser | null> {
  const response = await authFetch('/auth/v1/user', token);
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new HttpError(503, 'Supabase login is unavailable.');
  const user = await response.json() as { id: string; email?: string; app_metadata?: { tracker_pages?: string[] } };
  const profiles = await authFetch('/rest/v1/tracker_users?select=id,display_name,role,active&id=eq.' + encodeURIComponent(user.id), token);
  if (!profiles.ok) throw new HttpError(503, 'User roles are unavailable. Run supabase/users.sql.');
  const rows = await profiles.json() as { display_name: string; role: Role; active: boolean }[];
  const profile = rows[0];
  return profile?.active && roleLabels[profile.role] ? { name: profile.display_name || user.email || user.id, role: profile.role, ...(user.app_metadata?.tracker_pages ? { pages: user.app_metadata.tracker_pages.filter(page => pagePaths.includes(page)) } : {}) } : null;
}

// ---- signed session cookie (HMAC, no server-side session store, works on serverless) ----
const cookieName = 'tracker_session', ttlSeconds = 12 * 3600;
const secret = () => process.env.SESSION_SECRET || createHash('sha256').update('tracker-session|' + (process.env.SUPABASE_RPC_SECRET || process.env.APP_USERS || 'dev-only')).digest('hex');
const mac = (payload: string) => createHmac('sha256', secret()).update(payload).digest('base64url');
export function signSession(user: { name: string; role: Role }, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ n: user.name, r: user.role, e: Math.floor(now / 1000) + ttlSeconds })).toString('base64url');
  return `${payload}.${mac(payload)}`;
}
export function verifySession(token: string | undefined, now = Date.now()): SessionUser | null {
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(mac(payload)), given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { n: string; r: Role; e: number };
    if (data.e * 1000 < now || !roleLabels[data.r]) return null;
    // A user removed from APP_USERS loses access immediately.
    return parseUsers().some(user => user.name === data.n && user.role === data.r) ? { name: data.n, role: data.r } : null;
  } catch { return null; }
}
const readCookie = (header: string | undefined) => header?.split(';').map(part => part.trim()).find(part => part.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
const same = (a: string, b: string) => { const x = createHash('sha256').update(a).digest(), y = createHash('sha256').update(b).digest(); return timingSafeEqual(x, y); };

/** Puts req.user on every /api request. Open mode acts as Management with the typed name as actor. */
export const authenticate: RequestHandler = async (req, _res, next) => {
  if (supabaseAuthEnabled()) {
    try { const token = readCookie(req.headers.cookie); if (token) { const user = await supabaseUser(token); if (user) req.user = user; } next(); } catch (error) { next(error); }
    return;
  }
  if (!authEnabled()) { req.user = { name: 'Open mode', role: 'management', open: true }; next(); return; }
  const user = verifySession(readCookie(req.headers.cookie));
  if (user) req.user = user;
  next();
};
export const requireLogin: RequestHandler = (req, _res, next) => { if (!req.user) { next(new HttpError(401, 'Please sign in.')); return; } next(); };

const failures = new Map<string, { count: number; until: number }>();
export const authRouter = Router();
authRouter.get('/me', (req, res) => {
  const enabled = authEnabled(), user = req.user;
  res.json({ enabled, provider: supabaseAuthEnabled() ? 'supabase' : 'local', user: user && !user.open ? { name: user.name, role: user.role, roleLabel: roleLabels[user.role], pages: user.pages } : null, permissions: user ? permissionsFor(user.role).filter(permission => userCan(user, permission)) : [] });
});
authRouter.post('/login', async (req, res) => {
  if (!authEnabled()) throw new HttpError(400, 'Login is not enabled. Set APP_USERS on the backend to turn it on.');
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim(), now = Date.now(), record = failures.get(ip);
  if (record && record.count >= 10 && record.until > now) throw new HttpError(429, 'Too many failed attempts. Try again in a few minutes.');
  const name = text(req.body.username, 100), password = typeof req.body.password === 'string' ? req.body.password : '';
  if (supabaseAuthEnabled()) {
    const response = await authFetch('/auth/v1/token?grant_type=password', undefined, { email: usernameIdentity(name), password });
    if (!response.ok) { failures.set(ip, { count: (record && record.until > now ? record.count : 0) + 1, until: now + 15 * 60000 }); throw new HttpError(response.status === 429 ? 429 : 401, 'Unable to sign in. Check your username and password.'); }
    const session = await response.json() as { access_token: string; expires_in: number };
    const user = await supabaseUser(session.access_token);
    if (!user) throw new HttpError(403, 'Your account has no active workspace role. Contact Management.');
    failures.delete(ip);
    const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.setHeader('Set-Cookie', cookieName + '=' + session.access_token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + Math.min(session.expires_in, ttlSeconds) + (secure ? '; Secure' : ''));
    res.json({ ok: true }); return;
  }
  const user = parseUsers().find(candidate => candidate.name.toLowerCase() === name.toLowerCase());
  const ok = Boolean(user) && same(user!.password, password);
  if (!ok) { failures.set(ip, { count: (record && record.until > now ? record.count : 0) + 1, until: now + 15 * 60000 }); await new Promise(resolve => setTimeout(resolve, 600)); throw new HttpError(401, 'Wrong username or password.'); }
  failures.delete(ip);
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `${cookieName}=${signSession(user!, now)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ttlSeconds}${secure ? '; Secure' : ''}`);
  res.json({ ok: true, user: { name: user!.name, role: user!.role, roleLabel: roleLabels[user!.role] }, permissions: permissionsFor(user!.role) });
});
authRouter.post('/logout', (_req, res) => { res.setHeader('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`); res.json({ ok: true }); });

async function userAdminRequest(path: string, body?: unknown, method = 'PATCH') {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY, base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  if (!key || !base) throw new HttpError(503, 'User administration is not configured.');
  const response = await fetch(base + '/rest/v1/tracker_users' + path, { method: body === undefined ? 'GET' : method, headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new HttpError(503, 'Could not update user permissions.');
  return response.json();
}
function requireUserAdmin(req: Express.Request) {
  requirePermission(req, 'users.manage');
  if (!supabaseAuthEnabled() || req.user?.open) throw new HttpError(403, 'Sign in with a Management account to manage permissions.');
}
async function authAdmin(path: string, method = 'GET', body?: unknown) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY, base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  if (!key || !base) throw new HttpError(503, 'User administration is not configured.');
  const response = await fetch(base + '/auth/v1/admin/users' + path, { method, headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  if (!response.ok) throw new HttpError(response.status === 422 || response.status === 400 ? 400 : 503, response.status === 422 || response.status === 400 ? 'Could not save account. Check the username and password; the username may already exist.' : 'Account administration is unavailable.');
  return data;
}
authRouter.get('/users', async (req, res) => {
  requireUserAdmin(req);
  const accounts: any[] = [];
  for (let page = 1; ; page++) {
    const data = await authAdmin('?page=' + page + '&per_page=1000'); accounts.push(...data.users);
    if (data.users.length < 1000) break;
  }
  const users = await userAdminRequest('?select=id,display_name,role,active,created_at&order=display_name');
  res.json({ users: users.map((user: any) => { const account = accounts.find(a => a.id === user.id); return { ...user, username: account?.email?.endsWith('@users.tracker.internal') ? account.email.split('@')[0] : '', pages: account?.app_metadata?.tracker_pages ?? null }; }), pages: pagePaths, roles: Object.entries(roleLabels).map(([id, label]) => ({ id, label, permissions: permissionsFor(id as Role) })) });
});
authRouter.post('/users', async (req, res) => {
  requireUserAdmin(req);
  const email = usernameIdentity(text(req.body.username, 40)), password = typeof req.body.password === 'string' ? req.body.password : '', name = text(req.body.display_name, 100), role = text(req.body.role) as Role, pages = selectedPages(req.body.pages);
  if (password.length < 8 || password.length > 200 || !name || !roleLabels[role]) throw new HttpError(400, 'Enter a name, valid role and password of at least 8 characters.');
  if (role !== 'management' && pages?.includes('/administration')) throw new HttpError(400, 'Only Management can access Administration.');
  const account = await authAdmin('', 'POST', { email, password, email_confirm: true, app_metadata: { tracker_pages: pages ?? null } });
  try { await userAdminRequest('', { id: account.id, display_name: name, role, active: true }, 'POST'); }
  catch (error) { await authAdmin('/' + account.id, 'DELETE'); throw error; }
  res.status(201).json({ ok: true });
});
authRouter.post('/users/:id', async (req, res) => {
  requireUserAdmin(req);
  const id = String(req.params.id), role = text(req.body.role) as Role, name = text(req.body.display_name, 100), active = req.body.active, pages = selectedPages(req.body.pages);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !roleLabels[role] || !name || typeof active !== 'boolean') throw new HttpError(400, 'Choose a valid user name, role and access status.');
  if (role !== 'management' && pages?.includes('/administration')) throw new HttpError(400, 'Only Management can access Administration.');
  const token = readCookie(req.headers.cookie);
  const subject = token && JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).sub;
  if (id === subject && (role !== 'management' || !active || (pages && !pages.includes('/administration')))) throw new HttpError(400, 'You cannot remove your own Management access.');
  const existing = await userAdminRequest('?id=eq.' + encodeURIComponent(id));
  if (!existing.length) throw new HttpError(404, 'User not found.');
  await authAdmin('/' + id, 'PUT', { app_metadata: { tracker_pages: pages ?? null } });
  const users = await userAdminRequest('?id=eq.' + encodeURIComponent(id), { display_name: name, role, active });
  res.json({ user: users[0] });
});
