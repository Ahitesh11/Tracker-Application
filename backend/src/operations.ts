import { randomUUID } from 'node:crypto';
import { SupabaseStorage, supabaseConfig, type Storage } from './storage.js';
import { HttpError } from './http.js';
import { sheets } from './integrations/google/sheets.js';
import { defaultLeads } from './default-leads.js';

export interface Product {
  id: string; pi: string; order: string; customer: string; vendor: string; name: string; specs: string; dimensions: string;
  category: string; subcategory: string; quantity: number; unit: string; authorization: string; production: string;
  required: string; originalRequired: string; expectedCompletion: string; instructionDate: string; ackDate: string;
  startDate: string; completionDate: string; china: number; loaded: number; india: number; delivered: number; calledOut: number;
  owner: string; nextAction: string; deadline: string; shipment: string; container: string; notes: string; issues: string[];
}
export interface LeadTime { category: string; subcategory: string; manufacturing: number; transit: number; chinaBuffer: number; consolidation: number; customs: number; delivery: number; safety: number }
export type Movement = 'China receiving' | 'Container loading' | 'India receiving' | 'Customer delivery';
export interface Draft { id: string; productId: string; type: Movement; quantity: number; document: string; carton: string; shipment: string; container: string; notes: string; confidence: string; status: string; createdAt: string; reviewedBy?: string; reviewedAt?: string }
export interface Activity { id: string; productId: string; action: string; quantity: number; document: string; notes: string; actor: string; at: string; source: string; carton?: string; shipment?: string; container?: string }
export interface Store { version: number; revision?: number; source: string; importedAt: string; products: Product[]; leads: LeadTime[]; drafts: Draft[]; activity: Activity[]; shipments: Record<string, string>[]; exceptions: Record<string, string>[] }
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export function date(value: string | undefined): string {
  if (!value || value === '0') return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) { const parsed = new Date(value + 'T00:00:00Z'); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : ''; }
  if (/^\d+(\.\d+)?$/.test(value) && Number(value) > 0 && Number(value) < 200000) return new Date(Date.UTC(1899, 11, 30) + Number(value) * 86400000).toISOString().slice(0, 10);
  return '';
}
export function shift(value: string, days: number) { return new Date(Date.parse(value + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10); }
export function daysBetween(a: string, b: string) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
function emptyStore(): Store {
  return { version: 1, source: 'Empty workspace', importedAt: new Date().toISOString(), products: [], leads: defaultLeads.map(lead => ({ ...lead })), drafts: [], activity: [], shipments: [], exceptions: [] };
}
// Data lives in Supabase (see supabase/schema.sql). The connection is created on first use.
let storage: Storage | undefined;
function store(): Storage {
  if (!storage) {
    const config = supabaseConfig();
    if (!config) throw new HttpError(503, 'Supabase is not configured. Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_RPC_SECRET on the backend.');
    storage = new SupabaseStorage(config, emptyStore);
  }
  return storage;
}
export const getState = () => store().read();
export const activityHeaders = ['Time', 'Product ID', 'Action', 'Quantity', 'Document', 'Notes', 'Actor', 'Source', 'Shipment', 'Container', 'Event ID'];
export const productHeaders = ['Product ID', 'PI', 'Order', 'Customer', 'Vendor', 'Product', 'Category', 'Subcategory', 'Ordered', 'China', 'Loaded', 'India', 'Delivered', 'Stage', 'Authorization', 'Production', 'Required date', 'Owner', 'Next action', 'Deadline'];
export const activityRow = (a: Activity) => [a.at, a.productId, a.action, a.quantity, a.document, a.notes, a.actor, a.source, a.shipment || '', a.container || '', a.id];
export const productRows = (s: Store) => s.products.map(p => [p.id, p.pi, p.order, p.customer, p.vendor, p.name, p.category, p.subcategory, p.quantity, p.china, p.loaded, p.india, p.delivered, getStage(p), p.authorization, p.production, p.required, p.owner, p.nextAction, p.deadline]);
let sheetQueue: Promise<unknown> = Promise.resolve();
/** Queue a background push to Google Sheets. Local save is already committed, so a Sheets failure never loses or blocks data. */
export function pushToSheets(s: Store, fresh: Activity[]) {
  if (!sheets.enabled) return Promise.resolve();
  sheetQueue = sheetQueue.then(async () => {
    await sheets.append('Activity_Log', activityHeaders, fresh.map(activityRow));
    await sheets.replace('Products', productHeaders, productRows(s));
  }).catch(error => { sheets.lastError = error instanceof Error ? error.message : 'Sheets sync failed'; console.error(JSON.stringify({ sheets: 'sync failed', error: sheets.lastError })); });
  return sheetQueue;
}
export const commit = async (next: Store) => {
  const added = new Set(await store().save(next));
  const pushed = pushToSheets(next, next.activity.filter(a => added.has(a.id)).reverse());
  // A serverless function is frozen once the response is sent, so wait for the sheet push there.
  if (process.env.VERCEL) await pushed;
};
export const databaseHealth = async () => supabaseConfig() ? store().health() : { engine: 'supabase', schemaVersion: 1, ready: false };
export const closeDatabase = () => storage?.close();
export class OperationError extends Error { status = 400; }
export function must(condition: unknown, message: string): asserts condition { if (!condition) throw new OperationError(message); }
export function getStage(p: Product) {
  if (p.delivered >= p.quantity) return 'Delivered';
  if (p.india > p.delivered) return 'India warehouse';
  if (p.loaded > p.india) return 'In transit';
  if (p.china > p.loaded) return 'China warehouse';
  if (p.production === 'Production Completed') return 'Ready at vendor';
  if (p.authorization !== 'Approved for Production') return 'Awaiting authorization';
  return p.production === 'In Production' ? 'In production' : 'Awaiting production';
}
export function plan(p: Product, s: Store, asOf = today()) {
  const lead = s.leads.find(l => l.category === p.category && l.subcategory === p.subcategory) || s.leads.find(l => l.category === p.category && l.subcategory === 'Default') || s.leads.find(l => l.category === 'Other')!;
  const logistics = lead.transit + lead.chinaBuffer + lead.consolidation + lead.customs + lead.delivery + lead.safety;
  const latestComplete = shift(p.required, -logistics);
  const latestStart = shift(latestComplete, -lead.manufacturing);
  const stage = getStage(p);
  const dueDays = daysBetween(asOf, p.required);
  const overdue = Boolean(p.deadline && p.deadline < asOf && stage !== 'Delivered');
  const productionRisk = !p.completionDate && p.production !== 'Production Completed' && latestStart < asOf;
  const risk = stage === 'Delivered' ? 'Completed' : dueDays < 0 ? 'Overdue' : productionRisk || overdue ? 'At risk' : 'On track';
  return { manufacturing: lead.manufacturing, logistics, latestComplete, latestStart, dueDays, overdue, risk, stage };
}
export function alerts(s: Store, asOf = today()) {
  return s.products.flatMap(p => {
    const result: { id: string; productId: string; title: string; detail: string; owner: string; severity: string; due: string }[] = [];
    const add = (key: string, title: string, detail: string, severity = 'Warning') => result.push({ id: `${p.id}-${key}`, productId: p.id, title, detail, owner: p.owner, severity, due: p.deadline || p.required });
    const pl = plan(p, s, asOf);
    if (pl.stage === 'Delivered') return result;
    if (p.authorization !== 'Approved for Production') add('auth', 'Authorization required', p.nextAction || 'India team must review specifications and authorize production.');
    else if (!p.instructionDate && !p.completionDate) add('instruction', 'Production instruction pending', 'Approval is recorded; instruction has not been sent to the vendor.');
    if (p.instructionDate && !p.ackDate && daysBetween(p.instructionDate, asOf) > 3) add('ack', 'Vendor acknowledgment overdue', 'Follow up on the production instruction.', 'Critical');
    if (p.expectedCompletion && p.expectedCompletion < asOf && p.production !== 'Production Completed') add('production', 'Production completion overdue', `Expected ${p.expectedCompletion}; verify vendor update.`, 'Critical');
    if (p.production === 'Production Completed' && p.china < p.quantity) add('collection', 'Vendor collection pending', `${p.quantity - p.china} ${p.unit} not yet received in China.`);
    if (p.china > p.loaded) add('loading', 'Warehouse goods not loaded', `${p.china - p.loaded} ${p.unit} available for loading.`);
    if (p.india > p.delivered) add('delivery', 'Customer delivery pending', `${p.india - p.delivered} ${p.unit} available in India.`);
    if (pl.risk === 'Overdue') add('deadline', 'Customer delivery overdue', `Required ${p.required}.`, 'Critical');
    p.issues.forEach((issue, i) => add(`quality-${i}`, 'Imported data needs review', issue, 'Review'));
    return result;
  }).sort((a, b) => ({ Critical: 0, Warning: 1, Review: 2 }[a.severity]! - { Critical: 0, Warning: 1, Review: 2 }[b.severity]!));
}
export function duplicate(s: Store, d: Draft) { return s.activity.some(a => a.productId === d.productId && a.action === d.type && a.document === d.document); }
export function applyMovement(s: Store, d: Draft, actor: string) {
  const p = s.products.find(p => p.id === d.productId);
  must(p, 'Choose a valid product. Unmatched records cannot be approved.');
  must(Number.isSafeInteger(d.quantity) && d.quantity > 0, 'Quantity must be a positive whole number.');
  must(d.document.trim(), 'A unique receipt or document reference is required.');
  must(!duplicate(s, d), 'This movement is already recorded. It cannot be posted twice.');
  if (d.type === 'China receiving') { must(p.authorization === 'Approved for Production' && p.production === 'Production Completed', 'Confirm authorized production completion before posting China receipt.'); must(p.china + d.quantity <= p.quantity, 'Receipt exceeds remaining ordered quantity.'); p.china += d.quantity; }
  else if (d.type === 'Container loading') { must(p.loaded + d.quantity <= p.china, 'Loading exceeds available China warehouse quantity.'); must(d.shipment && d.container, 'Shipment and container references are required.'); p.loaded += d.quantity; p.shipment = d.shipment; p.container = d.container; }
  else if (d.type === 'India receiving') { must(p.india + d.quantity <= p.loaded, 'India receipt exceeds loaded quantity.'); p.india += d.quantity; }
  else if (d.type === 'Customer delivery') { must(p.delivered + d.quantity <= p.india, 'Delivery exceeds available India stock.'); p.delivered += d.quantity; }
  else throw new OperationError('Unsupported movement.');
  p.owner = p.india > p.delivered ? 'India Controller' : 'China Controller';
  p.nextAction = p.delivered === p.quantity ? 'Delivery complete' : p.india > p.delivered ? 'Schedule customer delivery' : p.loaded > p.india ? 'Track shipment and prepare India receiving' : 'Allocate warehouse goods to a shipment';
  p.deadline = p.required;
  s.activity.unshift({ id: randomUUID(), productId: p.id, action: d.type, quantity: d.quantity, document: d.document, notes: d.notes, actor, at: new Date().toISOString(), source: 'Operator approval', carton: d.carton, shipment: d.shipment, container: d.container });
}
export async function snapshot() { const s = await getState(); return { ...s, today: today(), products: s.products.map(p => ({ ...p, planning: plan(p, s) })), alerts: alerts(s), drafts: s.drafts.map(d => ({ ...d, duplicate: duplicate(s, d) })) }; }
