import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WorkspaceDatabase } from './database.js';
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
type Workbook = { source: string; importedAt: string; sheets: Record<string, { row: number; cells: Record<string, string> }[]> };
const dataDirectory = fileURLToPath(new URL('../data/', import.meta.url));
const stateFile = process.env.FMS_STATE_FILE || dataDirectory + 'workspace.json';
// Optional workbook snapshot (kept out of git). Without it the app starts as an empty workspace.
const seedFile = process.env.FMS_SEED_FILE || dataDirectory + 'workbook.json';
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export function date(value: string | undefined): string {
  if (!value || value === '0') return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) { const parsed = new Date(value + 'T00:00:00Z'); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : ''; }
  if (/^\d+(\.\d+)?$/.test(value) && Number(value) > 0 && Number(value) < 200000) return new Date(Date.UTC(1899, 11, 30) + Number(value) * 86400000).toISOString().slice(0, 10);
  return '';
}
export function shift(value: string, days: number) { return new Date(Date.parse(value + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10); }
export function daysBetween(a: string, b: string) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
function records(w: Workbook, sheet: string, header: number, until = Infinity) {
  const rows = w.sheets[sheet] || [];
  const keys = rows.find(r => r.row === header)?.cells || {};
  return rows.filter(r => r.row > header && r.row < until).map(r => Object.fromEntries(Object.entries(keys).map(([column, key]) => [key, r.cells[column] || ''])));
}
function emptyStore(): Store {
  return { version: 1, source: 'Empty workspace', importedAt: new Date().toISOString(), products: [], leads: defaultLeads.map(lead => ({ ...lead })), drafts: [], activity: [], shipments: [], exceptions: [] };
}
function seed(): Store {
  if (!existsSync(seedFile)) return emptyStore();
  const w = JSON.parse(readFileSync(seedFile, 'utf8')) as Workbook;
  const products = records(w, '01_Master_Products', 1).filter(r => r.Product_ID).map(r => {
    const issues: string[] = [];
    // The workbook has two columns named Qty_Received_China. Read both original cells explicitly.
    const source = w.sheets['01_Master_Products'].find(row => row.cells.A === r.Product_ID)!.cells;
    if (Number(source.AF || 0) !== Number(source.BY || 0)) issues.push(`China quantity conflict: original ${source.AF || 0}, call-out view ${source.BY || 0}. Imported higher figure; reconcile with receipt evidence.`);
    if (date(r.Required_Delivery_Date) !== date(r.Effective_Required_Date)) issues.push('Legacy and effective delivery dates differ. Planning uses the effective date; confirm with customer.');
    const china = Math.max(Number(source.AF || 0), Number(source.BY || 0));
    if (china > 0 && r.Production_Status !== 'Production Completed') issues.push('Warehouse receipt exists while production is not marked complete. Verify production status.');
    return {
      id: r.Product_ID, pi: r.Final_PI_Number, order: r.Order_ID, customer: r.Customer_Name, vendor: r.Vendor_Name, name: r.Product_Name,
      specs: r.Specifications, dimensions: r.Dimensions, category: r.Production_Category, subcategory: r.Production_Subcategory,
      quantity: Number(r.Quantity_Ordered), unit: r.Unit || 'pcs', authorization: r.Production_Authorization, production: r.Production_Status,
      required: date(r.Revised_Customer_Required_Date) || date(r.Effective_Required_Date) || date(r.Required_Delivery_Date), originalRequired: date(r.Required_Delivery_Date),
      expectedCompletion: date(r.Expected_Completion_Date), instructionDate: date(r.Instruction_Sent_Date), ackDate: date(r.Vendor_Ack_Date), startDate: date(r.Production_Start_Date), completionDate: date(r.Actual_Completion_Date),
      china, loaded: Number(r.Qty_Loaded || 0), india: Number(r.Qty_Received_India || 0), delivered: Number(r.Qty_Delivered || 0), calledOut: Number(r.Qty_Called_Out || 0),
      owner: r.Current_Owner, nextAction: r.Next_Action, deadline: date(r.Next_Action_Deadline), shipment: r.Shipment_ID_China || r.Planned_Container_ID,
      container: '', notes: r.Notes, issues,
    } satisfies Product;
  });
  const leads = records(w, 'Production_Lead_Time_Master', 4).filter(r => r.Subcategory && r.Mfg_Lead_Days).map(r => ({ category: r.Category, subcategory: r.Subcategory, manufacturing: Number(r.Mfg_Lead_Days), transit: Number(r.Transit_Days), chinaBuffer: Number(r.China_WH_Buffer), consolidation: Number(r.Consolidation_Buffer), customs: Number(r.Customs_India_Buffer), delivery: Number(r.Final_Delivery_Buffer), safety: Number(r.Safety_Buffer) }));
  const movement: Record<string, Movement> = { 'China Warehouse Receiving': 'China receiving', 'China Container Loading': 'Container loading', 'China Dispatch': 'Container loading', 'India Warehouse Receiving': 'India receiving' };
  const activity = records(w, 'Logistics_Transactions', 4).filter(r => r.Transaction_ID).map(r => ({ id: r.Transaction_ID, productId: r.Product_Line_ID, action: movement[r.Transaction_Type] || r.Transaction_Type, quantity: Number(r.Qty), document: r.Document_Ref, notes: `Imported approved movement: ${r.From_Location} → ${r.To_Location}`, actor: r.Approved_By || 'Workbook', at: `${date(r.Transaction_Date)}T12:00:00+05:30`, source: 'Workbook', carton: r.Carton_ID, shipment: r.Shipment_ID, container: r.Container_No }));
  const drafts = records(w, 'AI_Approval_Queue', 4).filter(r => r.Batch_ID).map(r => ({ id: r.Batch_ID, productId: r.Product_Line_ID, type: movement[r.Transaction_Type] || 'China receiving', quantity: Number(r.Qty), document: r.Document_Ref, carton: r.Carton_ID, shipment: r.Shipment_ID, container: r.Container_No, notes: [r.AI_Extracted_Notes, r.Discrepancy_Flag].filter(Boolean).join(' · '), confidence: r.AI_Confidence, status: r.Approval_Status === 'Approved' ? 'Approved' : 'Pending', createdAt: date(r.Upload_Date), reviewedBy: r.Reviewed_By, reviewedAt: date(r.Review_Date) } satisfies Draft));
  return { version: 1, source: w.source, importedAt: w.importedAt, products, leads, drafts, activity, shipments: records(w, '(BE)04_Shipments', 4, 9).filter(r => r.Shipment_ID), exceptions: records(w, '07_Exceptions_Actions', 4).filter(r => r.Exception_ID) };
}
const database = new WorkspaceDatabase(process.env.FMS_DB_FILE || (process.env.FMS_STATE_FILE ? stateFile + '.sqlite' : dataDirectory + 'forma.sqlite'), stateFile, seed);
export const getState = () => database.read();
export const activityHeaders = ['Time', 'Product ID', 'Action', 'Quantity', 'Document', 'Notes', 'Actor', 'Source', 'Shipment', 'Container', 'Event ID'];
export const productHeaders = ['Product ID', 'PI', 'Order', 'Customer', 'Vendor', 'Product', 'Category', 'Subcategory', 'Ordered', 'China', 'Loaded', 'India', 'Delivered', 'Stage', 'Authorization', 'Production', 'Required date', 'Owner', 'Next action', 'Deadline'];
export const activityRow = (a: Activity) => [a.at, a.productId, a.action, a.quantity, a.document, a.notes, a.actor, a.source, a.shipment || '', a.container || '', a.id];
export const productRows = (s: Store) => s.products.map(p => [p.id, p.pi, p.order, p.customer, p.vendor, p.name, p.category, p.subcategory, p.quantity, p.china, p.loaded, p.india, p.delivered, getStage(p), p.authorization, p.production, p.required, p.owner, p.nextAction, p.deadline]);
let sheetQueue: Promise<unknown> = Promise.resolve();
/** Queue a background push to Google Sheets. Local save is already committed, so a Sheets failure never loses or blocks data. */
export function pushToSheets(s: Store, fresh: Activity[]) {
  if (!sheets.enabled) return;
  sheetQueue = sheetQueue.then(async () => {
    await sheets.append('Activity_Log', activityHeaders, fresh.map(activityRow));
    await sheets.replace('Products', productHeaders, productRows(s));
  }).catch(error => { sheets.lastError = error instanceof Error ? error.message : 'Sheets sync failed'; console.error(JSON.stringify({ sheets: 'sync failed', error: sheets.lastError })); });
}
export const commit = (next: Store) => {
  const known = new Set(database.read().activity.map(a => a.id));
  database.save(next);
  pushToSheets(next, next.activity.filter(a => !known.has(a.id)).reverse());
};
export const databaseHealth = () => database.health();
export const closeDatabase = () => database.close();
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
export function snapshot() { const s = getState(); return { ...s, today: today(), products: s.products.map(p => ({ ...p, planning: plan(p, s) })), alerts: alerts(s), drafts: s.drafts.map(d => ({ ...d, duplicate: duplicate(s, d) })) }; }
