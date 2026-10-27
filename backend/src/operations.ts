import { randomUUID } from 'node:crypto';
import { SupabaseStorage, supabaseConfig, type Storage } from './storage.js';
import { HttpError } from './http.js';
import { defaultLeads } from './default-leads.js';

export interface Product {
  id: string; pi: string; order: string; customer: string; vendor: string; name: string; specs: string; dimensions: string;
  category: string; subcategory: string; quantity: number; unit: string; authorization: string; production: string;
  required: string; originalRequired: string; expectedCompletion: string; instructionDate: string; ackDate: string;
  startDate: string; completionDate: string; china: number; loaded: number; india: number; delivered: number; calledOut: number;
  owner: string; nextAction: string; deadline: string; shipment: string; container: string; notes: string; issues: string[];
  calloutDate: string; vendorCommitDate: string; quarantined: number; closed: string; closedBy: string; closedReason: string;
}
export interface LeadTime { category: string; subcategory: string; manufacturing: number; transit: number; chinaBuffer: number; consolidation: number; customs: number; delivery: number; safety: number; confirmation?: number }
export const movements = ['China receiving', 'Container loading', 'India receiving', 'Customer delivery', 'Customer return'] as const;
export type Movement = typeof movements[number];
export interface Draft { id: string; productId: string; type: Movement; quantity: number; document: string; carton: string; shipment: string; container: string; notes: string; confidence: string; status: string; createdAt: string; createdBy?: string; evidence?: string; requestId?: string; reviewedBy?: string; reviewedAt?: string }
export interface Activity { id: string; productId: string; action: string; quantity: number; document: string; notes: string; actor: string; at: string; source: string; carton?: string; shipment?: string; container?: string; evidence?: string; requestId?: string }
export interface Store { version: number; revision?: number; source: string; importedAt: string; products: Product[]; leads: LeadTime[]; drafts: Draft[]; activity: Activity[]; shipments: Record<string, string>[]; exceptions: Record<string, string>[] }

export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export function date(value: string | undefined): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : '';
}
export function shift(value: string, days: number) { return new Date(Date.parse(value + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10); }
export function daysBetween(a: string, b: string) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }

function emptyStore(): Store {
  return { version: 1, source: 'Empty workspace', importedAt: new Date().toISOString(), products: [], leads: defaultLeads.map(lead => ({ ...lead })), drafts: [], activity: [], shipments: [], exceptions: [] };
}
/** Older saved records miss newer fields; give them safe defaults. */
export function normalize(s: Store): Store {
  for (const p of s.products) { p.calledOut ??= 0; p.calloutDate ??= ''; p.vendorCommitDate ??= ''; p.quarantined ??= 0; p.closed ??= ''; p.closedBy ??= ''; p.closedReason ??= ''; p.issues ??= []; }
  for (const lead of s.leads) lead.confirmation ??= 7;
  return s;
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
export const getState = async () => normalize(await store().read());
export const commit = async (next: Store) => { await store().save(next); };
export const databaseHealth = async () => supabaseConfig() ? store().health() : { engine: 'supabase', schemaVersion: 1, ready: false };
export const closeDatabase = () => storage?.close();

export class OperationError extends Error { status = 400; }
export function must(condition: unknown, message: string): asserts condition { if (!condition) throw new OperationError(message); }
const closedMessage = 'This product line is closed. Ask Management to reopen it first.';

export function getStage(p: Product) {
  if (p.closed) return 'Closed';
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
  const confirmation = lead.confirmation ?? 7;
  const latestComplete = shift(p.required, -logistics);
  const latestStart = shift(latestComplete, -lead.manufacturing);
  const latestInstruction = shift(latestStart, -confirmation);
  const stage = getStage(p);
  const finished = stage === 'Delivered' || stage === 'Closed';
  const dueDays = daysBetween(asOf, p.required);
  const overdue = Boolean(p.deadline && p.deadline < asOf && !finished);
  const productionRisk = !p.completionDate && p.production !== 'Production Completed' && latestStart < asOf;
  const risk = finished ? 'Completed' : dueDays < 0 ? 'Overdue' : productionRisk || overdue ? 'At risk' : 'On track';
  return { manufacturing: lead.manufacturing, logistics, confirmation, latestInstruction, latestComplete, latestStart, dueDays, overdue, risk, stage };
}
export function alerts(s: Store, asOf = today()) {
  return s.products.flatMap(p => {
    const result: { id: string; productId: string; title: string; detail: string; owner: string; severity: string; due: string }[] = [];
    const add = (key: string, title: string, detail: string, severity = 'Warning', due = p.deadline || p.required, owner = p.owner) => result.push({ id: `${p.id}-${key}`, productId: p.id, title, detail, owner, severity, due });
    const pl = plan(p, s, asOf);
    if (pl.stage === 'Delivered' || pl.stage === 'Closed') return result;
    if (p.authorization !== 'Approved for Production') add('auth', 'Authorization required', p.nextAction || 'India team must review specifications and authorize production.');
    else if (!p.instructionDate && !p.completionDate) add('instruction', 'Production instruction pending', `Latest instruction date ${pl.latestInstruction} (${pl.confirmation} days before the latest production start).`, pl.latestInstruction < asOf ? 'Critical' : 'Warning', pl.latestInstruction);
    if (p.instructionDate && !p.ackDate && daysBetween(p.instructionDate, asOf) > 3) add('ack', 'Vendor acknowledgment overdue', 'Follow up on the production instruction.', 'Critical');
    if (p.expectedCompletion && p.expectedCompletion < asOf && p.production !== 'Production Completed') add('production', 'Production completion overdue', `Expected ${p.expectedCompletion}; verify vendor update.`, 'Critical');
    if (p.production === 'Production Completed' && p.calledOut < p.quantity) add('callout', 'Vendor call-out pending', `${p.quantity - p.calledOut} ${p.unit} are ready at the vendor but not called out for collection.`, 'Warning', p.deadline, 'China Controller');
    if (p.calledOut > p.china) add('collection', 'Called-out goods not received', `${p.calledOut - p.china} ${p.unit} called out${p.vendorCommitDate ? `; vendor committed ${p.vendorCommitDate}` : ''}, not yet received in China.`, p.vendorCommitDate && p.vendorCommitDate < asOf ? 'Critical' : 'Warning', p.vendorCommitDate || p.deadline, 'China Controller');
    if (p.china - p.loaded - p.quarantined > 0) add('loading', 'Warehouse goods not loaded', `${p.china - p.loaded - p.quarantined} ${p.unit} available for loading.`);
    if (p.quarantined > 0) add('quarantine', 'Stock in quarantine', `${p.quarantined} ${p.unit} are held. Resolve the exception to release or remove them.`);
    if (p.india > p.delivered) add('delivery', 'Customer delivery pending', `${p.india - p.delivered} ${p.unit} available in India.`);
    if (pl.risk === 'Overdue') add('deadline', 'Customer delivery overdue', `Required ${p.required}.`, 'Critical');
    for (const e of s.exceptions) if (e.Product_ID === p.id && e.Status === 'Open') add(`exception-${e.Exception_ID}`, `${e.Problem_Type}: exception open`, e.Description, e.Deadline && e.Deadline < asOf ? 'Critical' : 'Warning', e.Deadline || p.deadline, e.Responsible_Person || p.owner);
    return result;
  }).sort((a, b) => ({ Critical: 0, Warning: 1, Review: 2 }[a.severity]! - { Critical: 0, Warning: 1, Review: 2 }[b.severity]!));
}

export function duplicate(s: Store, d: Draft) { return s.activity.some(a => a.productId === d.productId && a.action === d.type && a.document === d.document); }
export function applyMovement(s: Store, d: Draft, actor: string) {
  const p = s.products.find(p => p.id === d.productId);
  must(p, 'Choose a valid product. Unmatched records cannot be approved.');
  must(!p.closed, closedMessage);
  must(Number.isSafeInteger(d.quantity) && d.quantity > 0, 'Quantity must be a positive whole number.');
  must(d.document.trim(), 'A unique receipt or document reference is required.');
  must(!duplicate(s, d), 'This movement is already recorded. It cannot be posted twice.');
  if (d.type === 'China receiving') {
    must(p.authorization === 'Approved for Production' && p.production === 'Production Completed', 'Confirm authorized production completion before posting China receipt.');
    must(p.calledOut >= p.china + d.quantity, `Receipt exceeds the called-out quantity (called out ${p.calledOut}, already received ${p.china}, this receipt ${d.quantity}). Record a vendor call-out for the rest first.`);
    must(p.china + d.quantity <= p.quantity, 'Receipt exceeds remaining ordered quantity.'); p.china += d.quantity;
  } else if (d.type === 'Container loading') {
    const available = p.china - p.loaded - p.quarantined;
    must(d.quantity <= available, `Loading exceeds available China warehouse quantity (${Math.max(available, 0)} available${p.quarantined ? `, ${p.quarantined} in quarantine` : ''}).`);
    must(d.shipment && d.container, 'Shipment and container references are required.'); p.loaded += d.quantity; p.shipment = d.shipment; p.container = d.container;
  } else if (d.type === 'India receiving') { must(p.india + d.quantity <= p.loaded, 'India receipt exceeds loaded quantity.'); p.india += d.quantity; }
  else if (d.type === 'Customer delivery') { must(p.delivered + d.quantity <= p.india, 'Delivery exceeds available India stock.'); p.delivered += d.quantity; }
  else if (d.type === 'Customer return') { must(d.quantity <= p.delivered, `Return exceeds delivered quantity (${p.delivered} delivered).`); p.delivered -= d.quantity; }
  else throw new OperationError('Unsupported movement.');
  p.owner = p.india > p.delivered ? 'India Controller' : 'China Controller';
  p.nextAction = d.type === 'Customer return' ? 'Decide what happens to the returned units: redeliver or raise an exception' : p.delivered === p.quantity ? 'Delivery complete: close the product line' : p.india > p.delivered ? 'Schedule customer delivery' : p.loaded > p.india ? 'Track shipment and prepare India receiving' : 'Allocate warehouse goods to a shipment';
  p.deadline = p.required;
  s.activity.unshift({ id: randomUUID(), productId: p.id, action: d.type, quantity: d.quantity, document: d.document, notes: d.notes, actor, at: new Date().toISOString(), source: 'Operator approval', carton: d.carton, shipment: d.shipment, container: d.container, evidence: d.evidence });
}

/** Vendor call-out: the ready goods the China team asks the vendor to hand over. */
export function recordCallOut(p: Product, quantity: number, at: string, commitDate: string) {
  must(!p.closed, closedMessage);
  must(p.authorization === 'Approved for Production' && p.production === 'Production Completed', 'Complete production before calling goods out.');
  must(Number.isSafeInteger(quantity) && quantity > 0, 'Call-out quantity must be a positive whole number.');
  must(p.calledOut + quantity <= p.quantity, `Call-out exceeds the order. ${p.calledOut} of ${p.quantity} already called out.`);
  must(!commitDate || commitDate >= at, 'The vendor delivery commitment cannot be before the call-out date.');
  p.calledOut += quantity; p.calloutDate = at; p.vendorCommitDate = commitDate; p.owner = 'China Controller';
  p.nextAction = 'Collect the called-out goods from the vendor and receive them in the China warehouse';
}

export const exceptionTypes = ['Damage', 'Shortage', 'Late vendor', 'Missed container', 'Wrong item / specification', 'Other'] as const;
type ExceptionInput = { productId: string; type: string; description: string; quantity: number; quarantine: boolean; owner: string; deadline: string; actor: string; requestId?: string };
const log = (s: Store, productId: string, action: string, quantity: number, notes: string, actor: string, extra: Partial<Activity> = {}) =>
  s.activity.unshift({ id: randomUUID(), productId, action, quantity, document: '', notes, actor, at: new Date().toISOString(), source: 'Exception handling', ...extra });
/** Raises an exception; Damage/Shortage can hold units in quarantine so they cannot be loaded. */
export function raiseException(s: Store, input: ExceptionInput) {
  const p = s.products.find(p => p.id === input.productId);
  must(p, 'Choose a valid product.'); must(!p.closed, closedMessage);
  must((exceptionTypes as readonly string[]).includes(input.type), 'Choose a valid exception type.');
  must(input.description, 'Describe what went wrong.'); must(input.owner, 'Name the person responsible.');
  must(input.deadline && input.deadline >= today(), 'Enter a deadline that is today or later.');
  let quantity = 0;
  if (input.quarantine) {
    must(input.type === 'Damage' || input.type === 'Shortage', 'Only Damage or Shortage exceptions can quarantine stock.');
    quantity = input.quantity; must(Number.isSafeInteger(quantity) && quantity > 0, 'Enter how many units to quarantine.');
    const available = p.china - p.loaded - p.quarantined;
    must(quantity <= available, `Only ${Math.max(available, 0)} units are available in the China warehouse to quarantine.`);
    p.quarantined += quantity;
  }
  const id = `EXC-${randomUUID().slice(0, 8).toUpperCase()}`;
  s.exceptions.unshift({ Exception_ID: id, Product_ID: p.id, Problem_Type: input.type, Description: input.description, Quantity: String(quantity), Quarantine: input.quarantine ? 'yes' : 'no', Responsible_Person: input.owner, Date_Identified: today(), Deadline: input.deadline, Status: 'Open', Resolution_Notes: '', Disposition: '', Raised_By: input.actor, Resolved_By: '', Resolved_Date: '', Request_ID: input.requestId || '' });
  log(s, p.id, 'Exception raised', quantity, `${input.type}: ${input.description}${input.quarantine ? ` (${quantity} ${p.unit} quarantined)` : ''}`, input.actor, { requestId: input.requestId });
  return id;
}
const findException = (s: Store, id: string) => { const e = s.exceptions.find(e => e.Exception_ID === id); must(e, 'Exception not found.'); return e; };
export function updateException(s: Store, id: string, input: { owner: string; deadline: string; notes: string; actor: string; requestId?: string }) {
  const e = findException(s, id); must(e.Status === 'Open', 'Only open exceptions can be updated.');
  must(input.owner, 'Name the person responsible.'); must(input.deadline, 'Enter a valid deadline.'); must(input.notes, 'Add a note about the change.');
  e.Responsible_Person = input.owner; e.Deadline = input.deadline;
  log(s, e.Product_ID, 'Exception updated', 0, `${e.Problem_Type}: ${input.notes}`, input.actor, { requestId: input.requestId });
}
/** Resolving needs a note (the evidence of the correction). Quarantined units are released to stock or removed. */
export function resolveException(s: Store, id: string, input: { notes: string; disposition: string; actor: string; requestId?: string }) {
  const e = findException(s, id); must(e.Status === 'Open', 'This exception is already resolved.');
  must(input.notes, 'Describe the correction and the evidence.');
  const p = s.products.find(p => p.id === e.Product_ID)!, held = Number(e.Quantity) || 0;
  if (e.Quarantine === 'yes' && held > 0) {
    must(['Release to stock', 'Remove from stock'].includes(input.disposition), 'Choose what happens to the quarantined units: release to stock or remove from stock.');
    p.quarantined = Math.max(p.quarantined - held, 0);
    if (input.disposition === 'Remove from stock') { p.china = Math.max(p.china - held, p.loaded); p.calledOut = Math.max(p.calledOut - held, p.china); p.nextAction = 'Request a replacement: record a new vendor call-out'; }
  }
  e.Status = 'Resolved'; e.Resolution_Notes = input.notes; e.Disposition = e.Quarantine === 'yes' ? input.disposition : ''; e.Resolved_By = input.actor; e.Resolved_Date = today();
  log(s, e.Product_ID, 'Exception resolved', held, `${e.Problem_Type}: ${input.notes}${e.Disposition ? ` (${e.Disposition})` : ''}`, input.actor, { requestId: input.requestId });
}
export function reopenException(s: Store, id: string, input: { notes: string; actor: string; requestId?: string }) {
  const e = findException(s, id); must(e.Status === 'Resolved', 'Only resolved exceptions can be reopened.'); must(input.notes, 'Say why the exception is reopened.');
  // The held units were already released or removed, so a second resolution must not touch the stock again.
  e.Status = 'Open'; e.Resolution_Notes = ''; e.Resolved_By = ''; e.Resolved_Date = ''; e.Quarantine = 'no';
  log(s, e.Product_ID, 'Exception reopened', 0, `${e.Problem_Type}: ${input.notes}`, input.actor, { requestId: input.requestId });
}

/** Closing needs a clean balance: no open exceptions, no pending drafts, no stock left behind. */
export function closeProduct(s: Store, p: Product, input: { shortClose: boolean; notes: string; actor: string; at: string }) {
  must(!p.closed, 'This product line is already closed.');
  must(!s.exceptions.some(e => e.Product_ID === p.id && e.Status === 'Open'), 'Resolve the open exceptions for this product before closing it.');
  must(!s.drafts.some(d => d.productId === p.id && d.status === 'Pending'), 'Review or reject the pending movement drafts before closing.');
  must(p.china === p.loaded && p.loaded === p.india && p.india === p.delivered && p.quarantined === 0, `Goods are still in a warehouse, in transit or in quarantine (China ${p.china}, loaded ${p.loaded}, India ${p.india}, delivered ${p.delivered}). Deliver or resolve them first.`);
  const balance = p.quantity - p.delivered;
  must(balance === 0 || input.shortClose, `${balance} ${p.unit} were never delivered. Tick "close with the remaining balance" and explain why.`);
  p.closed = input.at; p.closedBy = input.actor; p.closedReason = balance > 0 ? `Short-closed with ${balance} ${p.unit} undelivered. ${input.notes}` : `Delivered in full. ${input.notes}`;
  p.nextAction = 'Closed'; p.deadline = '';
}
export function reopenProduct(p: Product) { must(p.closed, 'This product line is not closed.'); p.closed = ''; p.closedBy = ''; p.closedReason = ''; p.owner = 'India Controller'; p.nextAction = 'Reopened: review the balance and decide the next step'; p.deadline = today(); }

/** True when a request with this key was already processed (protects against double clicks and retries). */
export const seenRequest = (s: Store, requestId: string) => s.activity.some(a => a.requestId === requestId) || s.drafts.some(d => d.requestId === requestId) || s.exceptions.some(e => e.Request_ID === requestId);

export async function snapshot() { const s = await getState(); return { ...s, today: today(), products: s.products.map(p => ({ ...p, planning: plan(p, s) })), alerts: alerts(s), drafts: s.drafts.map(d => ({ ...d, duplicate: duplicate(s, d) })) }; }
