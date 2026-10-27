import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { HttpError, text } from './http.js';

export type Role = 'india' | 'china' | 'warehouse' | 'management';
export const roleLabels: Record<Role, string> = { india: 'India Controller', china: 'China Controller', warehouse: 'Warehouse / Logistics', management: 'Management' };
export interface SessionUser { name: string; role: Role; open?: boolean }
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
export const authEnabled = () => parseUsers().length > 0;

// What each role may do. The backend enforces this; the screens only hide what is not allowed.
const everyone: Role[] = ['india', 'china', 'warehouse', 'management'];
const rules: Record<string, Role[]> = {
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
  if (!req.user || !can(req.user.role, permission)) throw new HttpError(403, `Your role (${req.user ? roleLabels[req.user.role] : 'unknown'}) is not allowed to do this.`);
}
/** The name written to the audit log: the signed-in user, or the typed name in open mode. */
export function actorOf(req: { user?: SessionUser }, typed: unknown, max = 100) {
  if (req.user && !req.user.open) return req.user.name;
  return text(typed, max);
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
export const authenticate: RequestHandler = (req, _res, next) => {
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
  res.json({ enabled, user: user && !user.open ? { name: user.name, role: user.role, roleLabel: roleLabels[user.role] } : null, permissions: user ? permissionsFor(user.role) : [] });
});
authRouter.post('/login', async (req, res) => {
  if (!authEnabled()) throw new HttpError(400, 'Login is not enabled. Set APP_USERS on the backend to turn it on.');
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim(), now = Date.now(), record = failures.get(ip);
  if (record && record.count >= 10 && record.until > now) throw new HttpError(429, 'Too many failed attempts. Try again in a few minutes.');
  const name = text(req.body.username, 100), password = typeof req.body.password === 'string' ? req.body.password : '';
  const user = parseUsers().find(candidate => candidate.name.toLowerCase() === name.toLowerCase());
  const ok = Boolean(user) && same(user!.password, password);
  if (!ok) { failures.set(ip, { count: (record && record.until > now ? record.count : 0) + 1, until: now + 15 * 60000 }); await new Promise(resolve => setTimeout(resolve, 600)); throw new HttpError(401, 'Wrong username or password.'); }
  failures.delete(ip);
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `${cookieName}=${signSession(user!, now)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ttlSeconds}${secure ? '; Secure' : ''}`);
  res.json({ ok: true, user: { name: user!.name, role: user!.role, roleLabel: roleLabels[user!.role] }, permissions: permissionsFor(user!.role) });
});
authRouter.post('/logout', (_req, res) => { res.setHeader('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`); res.json({ ok: true }); });
