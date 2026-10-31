import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useWorkspace } from '@/components/workspace-provider';
import { Badge } from '@/components/operations-ui';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { readLoadingList } from '@/lib/loading-list-file';
import { request, type LineStatus, type LoadingLine } from '@/services/workspace-api';

export const lineTone: Record<string, string> = { Matched: 'green', Unmatched: 'red', Ambiguous: 'amber', Duplicate: 'amber', 'Quantity issue': 'red', Approved: 'green', 'Pending approval': 'amber', Rejected: 'red' };
const cell = 'w-full min-w-0 rounded-md border border-[var(--border)] bg-white px-2 py-1 text-sm';
interface Read { container?: string; lines: LoadingLine[]; source: string; model: string; read: number }

/** Reading a loading list file, matching its lines to products and letting the reviewer correct them. Used by the import window and by the shipment form. */
export function useLoadingList() {
  const { data } = useWorkspace(), { t } = useI18n();
  const [result, setResult] = useState<Read | null>(null), [lines, setLines] = useState<LoadingLine[]>([]), [removed, setRemoved] = useState(0), [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false), [error, setError] = useState('');
  const products = useMemo(() => (data?.products || []).filter(p => !p.closed), [data]);
  async function pick(files: File[]) {
    if (!files.length) return;
    setError(''); setResult(null); setLines([]); setRemoved(0); setFileName(files.length > 1 ? `${files.length} files` : files[0].name); setReading(true);
    try { const read = await request<Read>('/workspace/loading-lists/interpret', await readLoadingList(files)); setResult(read); setLines(read.lines); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to read this file.'); } finally { setReading(false); }
  }
  const edit = (id: string, patch: Partial<LoadingLine>) => setLines(list => list.map(l => l.id === id ? { ...l, ...patch } : l));
  /** After the reviewer edits the text of a line (for example the carton mark SKY-5), it is matched again. */
  async function rematch(id: string) {
    const line = lines.find(l => l.id === id); if (!line) return;
    try { const m = await request<{ productId: string; pi: string; status: LineStatus; note: string }>('/workspace/loading-lists/rematch', { code: line.code, description: line.description, pi: line.pi }); edit(id, { productId: m.productId, pi: m.pi, status: m.status, note: m.note }); } catch { /* the reviewer can still choose the product by hand */ }
  }
  const remove = (id: string) => { setLines(list => list.filter(x => x.id !== id)); setRemoved(n => n + 1); };
  // Same checks the server runs, so a changed product or quantity shows its new status at once.
  const view = useMemo(() => { const seen = new Set<string>(); return lines.map(l => {
    const p = products.find(p => p.id === l.productId); let status: LineStatus, note = '';
    if (!p) { status = l.status === 'Ambiguous' ? 'Ambiguous' : 'Unmatched'; note = l.status === 'Matched' ? '' : l.note; }
    else if (seen.has(p.id)) { status = 'Duplicate'; note = 'This product is listed more than once in this loading list.'; }
    else if (!Number.isSafeInteger(l.quantity) || l.quantity < 1) { status = 'Quantity issue'; note = 'Quantity must be a positive whole number.'; }
    else if (l.quantity > p.china - p.loaded - p.quarantined) { status = 'Quantity issue'; note = t('Listed {a} but only {b} are in the China warehouse available to load.', { a: l.quantity, b: Math.max(p.china - p.loaded - p.quarantined, 0) }); }
    else status = 'Matched';
    if (p) seen.add(p.id);
    return { ...l, status, note, pi: p?.pi || l.pi };
  }); }, [lines, products, t]);
  /** What the server needs to save the reviewed list. */
  const payload = () => ({ fileName, source: result?.source, model: result?.model, removed, lines: view.map(l => ({ productId: l.productId, suggested: l.suggested, code: l.code, description: l.description, pi: l.pi, quantity: l.quantity, aiQuantity: l.aiQuantity, aiText: l.aiText, unit: l.unit })) });
  return { pick, reading, error, setError, result, lines, view, products, flagged: view.filter(l => l.status !== 'Matched').length, edit, rematch, remove, payload };
}

/** The matched lines, with a product and a quantity the reviewer can change. */
export function LoadingListTable({ list }: { list: ReturnType<typeof useLoadingList> }) {
  const { t } = useI18n(), { result, view, products, flagged, edit, rematch, remove } = list;
  if (!result) return null;
  return <>
    <div className="info-banner"><span>{t('{n} lines read ({how}). {m} need review.', { n: result.read, how: result.source === 'ai' ? t('AI reading') : t('Spreadsheet columns read by rules'), m: flagged })}</span></div>
    <div style={{ overflowX: 'auto' }}><table className="data-table"><thead><tr>{['#', 'As read from the list (editable)', 'Product (matched)', 'Customer / PI', 'Qty', 'Unit', 'Status', ''].map((h, i) => <th key={i}>{t(h)}</th>)}</tr></thead>
      <tbody>{view.map((l, i) => <tr key={l.id}>
        <td>{i + 1}</td>
        <td><div className="cell-stack"><input className={cell} style={{ minWidth: 130, fontWeight: 700 }} value={l.code} aria-label={t('Carton mark / model')} onChange={e => edit(l.id, { code: e.target.value })} onBlur={() => void rematch(l.id)} maxLength={100}/><input className={cell} style={{ minWidth: 190 }} value={l.description} aria-label={t('Product description')} onChange={e => edit(l.id, { description: e.target.value })} onBlur={() => void rematch(l.id)} maxLength={200}/></div></td>
        <td><select className={cell} style={{ minWidth: 260 }} value={l.productId} onChange={e => edit(l.id, { productId: e.target.value })}><option value="">{t('Choose the product')}</option>{products.map(p => <option key={p.id} value={p.id}>{p.pi} · {p.name}</option>)}</select></td>
        <td>{(() => { const p = products.find(x => x.id === l.productId); return p ? <div className="cell-stack"><span>{p.customer}</span><small>{p.pi}</small></div> : (l.pi || '—'); })()}</td>
        <td><input className={cell} type="number" min="1" step="1" value={l.quantity} onChange={e => edit(l.id, { quantity: Number(e.target.value) })} style={{ width: 80 }}/></td>
        <td>{l.unit}</td>
        <td><div className="cell-stack"><Badge tone={lineTone[l.status]}>{l.status}</Badge>{l.note && <small>{t(l.note)}</small>}</div></td>
        <td><Button type="button" variant="ghost" size="icon" aria-label={t('Remove row')} onClick={() => remove(l.id)}><Trash2 size={15}/></Button></td>
      </tr>)}</tbody></table></div>
  </>;
}

export const loadingListHint = 'Excel and CSV lists with Model / Description and Qty columns are read instantly. PDFs and photos are read by AI and need the OpenAI key. Nothing changes in your products until a controller approves the list.';
export const loadingListAccept = '.xlsx,.csv,.tsv,.txt,application/pdf,.pdf,image/jpeg,image/png,image/webp';
