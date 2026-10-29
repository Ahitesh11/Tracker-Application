export interface Product {
  id: string; pi: string; order: string; customer: string; vendor: string; name: string; specs: string; dimensions: string;
  category: string; subcategory: string; quantity: number; unit: string; authorization: string; production: string;
  required: string; originalRequired: string; expectedCompletion: string; instructionDate: string; ackDate: string; startDate: string; completionDate: string;
  china: number; loaded: number; india: number; delivered: number; calledOut: number; owner: string; nextAction: string; deadline: string;
  shipment: string; container: string; notes: string; issues: string[];
  calloutDate: string; vendorCommitDate: string; quarantined: number; closed: string; closedBy: string; closedReason: string;
  planning: { manufacturing: number; logistics: number; confirmation: number; latestInstruction: string; latestComplete: string; latestStart: string; dueDays: number; overdue: boolean; risk: string; stage: string };
}
export interface LeadTime { category: string; subcategory: string; manufacturing: number; transit: number; chinaBuffer: number; consolidation: number; customs: number; delivery: number; safety: number; confirmation?: number }
export const movementTypes = ['China receiving', 'Container loading', 'India receiving', 'Customer delivery', 'Customer return'] as const;
export interface Audit { status: 'Match' | 'Mismatch' | 'Needs review' | 'Unavailable'; summary: string; findings: string[]; loadedSeen: number | null; receivedSeen: number | null; damageSeen: boolean; expectedQuantity: number; shortfall: number; model: string; at: string }
export interface Draft { photos?: string[]; audit?: Audit; requestId?: string; id: string; productId: string; type: string; quantity: number; document: string; carton: string; shipment: string; container: string; notes: string; confidence: string; status: string; duplicate: boolean; createdAt: string; createdBy?: string; evidence?: string; reviewedBy?: string }
export interface Activity { photos?: string[]; id: string; productId: string; action: string; quantity: number; document: string; notes: string; actor: string; at: string; source: string; carton?: string; shipment?: string; container?: string; evidence?: string }
export interface Alert { id: string; productId: string; title: string; detail: string; owner: string; severity: string; due: string }
/** Exception records use the workbook-style keys stored by the backend. */
export type ExceptionRow = Record<'Exception_ID' | 'Product_ID' | 'Problem_Type' | 'Description' | 'Quantity' | 'Quarantine' | 'Responsible_Person' | 'Date_Identified' | 'Deadline' | 'Status' | 'Resolution_Notes' | 'Disposition' | 'Raised_By' | 'Resolved_By' | 'Resolved_Date', string>;
export const exceptionTypes = ['Damage', 'Shortage', 'Late vendor', 'Missed container', 'Wrong item / specification', 'Other'] as const;
export interface WorkspaceData { revision: number; source: string; importedAt: string; today: string; products: Product[]; leads: LeadTime[]; drafts: Draft[]; activity: Activity[]; alerts: Alert[]; shipments: Record<string, string>[]; exceptions: ExceptionRow[] }
export interface AIStatus { local: boolean; ollama: boolean; models: string[]; gatewayConfigured: boolean; gatewayModel: string; openaiConfigured: boolean; openaiModel: string }
export interface MovementProposal { productId: string; productName: string; type: string; quantity: number; document: string; shipment: string; container: string; notes: string; confidence: string }
import { tx, dateLocale, getLang } from '@/lib/i18n';
const base = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
export const apiUrl = (path: string) => base + '/api' + path;
/** One key per form submit: if the same request is sent twice (double click, retry), the server creates only one record. */
export const newRequestId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`);
export async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(apiUrl(path), { method: body === undefined ? 'GET' : 'POST', credentials: 'include', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal });
  const data = await response.json().catch(() => ({ error: 'Backend returned an invalid response. Check the server.' }));
  if (response.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('auth-expired'));
  if (!response.ok) throw new Error(tx(data.error || 'Request failed.'));
  return data as T;
}
export const displayDate = (value: string) => !value ? '—' : new Intl.DateTimeFormat(dateLocale(), getLang() === 'zh' ? { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' } : { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(value.length === 10 ? `${value}T12:00:00+05:30` : value));
