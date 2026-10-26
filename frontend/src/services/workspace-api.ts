export interface Product {
  id: string; pi: string; order: string; customer: string; vendor: string; name: string; specs: string; dimensions: string;
  category: string; subcategory: string; quantity: number; unit: string; authorization: string; production: string;
  required: string; originalRequired: string; expectedCompletion: string; instructionDate: string; ackDate: string; startDate: string; completionDate: string;
  china: number; loaded: number; india: number; delivered: number; calledOut: number; owner: string; nextAction: string; deadline: string;
  shipment: string; container: string; notes: string; issues: string[];
  planning: { manufacturing: number; logistics: number; latestComplete: string; latestStart: string; dueDays: number; overdue: boolean; risk: string; stage: string };
}
export interface LeadTime { category: string; subcategory: string; manufacturing: number; transit: number; chinaBuffer: number; consolidation: number; customs: number; delivery: number; safety: number }
export interface Draft { id: string; productId: string; type: string; quantity: number; document: string; carton: string; shipment: string; container: string; notes: string; confidence: string; status: string; duplicate: boolean; createdAt: string; reviewedBy?: string }
export interface Activity { id: string; productId: string; action: string; quantity: number; document: string; notes: string; actor: string; at: string; source: string; carton?: string; shipment?: string; container?: string }
export interface Alert { id: string; productId: string; title: string; detail: string; owner: string; severity: string; due: string }
export interface WorkspaceData { revision: number; source: string; importedAt: string; today: string; products: Product[]; leads: LeadTime[]; drafts: Draft[]; activity: Activity[]; alerts: Alert[]; shipments: Record<string, string>[]; exceptions: Record<string, string>[] }
export interface AIStatus { local: boolean; ollama: boolean; models: string[]; gatewayConfigured: boolean; gatewayModel: string }
const base = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
export const apiUrl = (path: string) => base + '/api' + path;
export async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(apiUrl(path), { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal });
  const data = await response.json().catch(() => ({ error: 'Backend returned an invalid response. Check the server.' }));
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data as T;
}
export const displayDate = (value: string) => !value ? '—' : new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(value.length === 10 ? `${value}T12:00:00+05:30` : value));
