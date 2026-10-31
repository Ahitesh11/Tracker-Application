import { useState } from 'react';
import { Check, ClipboardCheck, X } from 'lucide-react';
import { useWorkspace } from '@/components/workspace-provider';
import { useAuth } from '@/components/auth-provider';
import { Badge, SectionHeader } from '@/components/operations-ui';
import { Button } from '@/components/ui/button';
import { lineTone } from '@/components/loading-list-import';
import { useI18n } from '@/lib/i18n';
import { displayDate, type LoadingList } from '@/services/workspace-api';

type Edit = { productId?: string; quantity?: number; remove?: boolean };
const cell = 'min-w-0 rounded-md border border-[var(--border)] bg-white px-2 py-1 text-sm';

/** Loading lists waiting for the controller, and the ones already decided. "OK to All" is the controller's approval of the whole list. */
export function LoadingLists() {
  const { data, mutate, busy } = useWorkspace(), { can, enabled, user } = useAuth(), { t } = useI18n();
  const [actor, setActor] = useState(''), [error, setError] = useState(''), [edits, setEdits] = useState<Record<string, Record<string, Edit>>>({});
  if (!data || !data.loadingLists.length) return null;
  const name = enabled ? user?.name : actor, canApprove = can('loadinglist.approve'), canEdit = canApprove || can('shipment.manage');
  const act = async (list: LoadingList, action: string, body: Record<string, unknown> = {}) => { setError(''); try { await mutate(`/workspace/loading-lists/${list.id}/${action}`, { actor: name, ...body }); setEdits(e => ({ ...e, [list.id]: {} })); } catch (e) { setError(e instanceof Error ? e.message : t('Request failed.')); } };
  const patch = (list: LoadingList, lineId: string, change: Edit) => setEdits(e => ({ ...e, [list.id]: { ...e[list.id], [lineId]: { ...e[list.id]?.[lineId], ...change } } }));
  const products = data.products.filter(p => !p.closed), lists = [...data.loadingLists].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return <section className="panel">
    <SectionHeader title="Loading lists" description="AI-read container loading lists. Products move to Container loading only after the controller approves the whole list."/>
    {!enabled && <div className="sample-toolbar"><input aria-label={t('Your name (required to review)')} placeholder={t('Your name (required to review)')} value={actor} onChange={e => setActor(e.target.value)} maxLength={100}/></div>}
    {error && <div className="error-banner" role="alert">{t(error)}</div>}
    <div className="audit-cards">{lists.map(list => {
      const pending = list.status === 'Pending approval', mine = edits[list.id] || {}, flagged = list.lines.filter(l => l.status !== 'Matched').length, changes = Object.entries(mine).filter(([, v]) => v.productId !== undefined || v.quantity !== undefined || v.remove);
      return <article key={list.id} className="audit-card">
        <header><div><strong>{list.id} · {list.shipment} / {list.container}</strong><small>{list.fileName} · {list.createdBy} · {displayDate(list.createdAt)}</small></div><div className="inline-actions"><Badge tone={lineTone[list.status]}>{list.status}</Badge>{flagged > 0 && <Badge tone="red">{t('{n} need review', { n: flagged })}</Badge>}</div></header>
        <div style={{ overflowX: 'auto' }}><table className="data-table"><thead><tr>{['Product', 'PI', 'Listed qty', 'Status'].map(h => <th key={h}>{t(h)}</th>)}{pending && canEdit && <th/>}</tr></thead><tbody>{list.lines.map(l => {
          const p = data.products.find(x => x.id === l.productId), e = mine[l.id] || {}, gone = e.remove;
          return <tr key={l.id} style={gone ? { opacity: 0.4 } : undefined}>
            <td>{pending && canEdit && l.status !== 'Matched' ? <select className={cell} style={{ minWidth: 240 }} value={e.productId ?? l.productId} onChange={ev => patch(list, l.id, { productId: ev.target.value })}><option value="">{t('Choose the product')}</option>{products.map(x => <option key={x.id} value={x.id}>{x.pi} · {x.name}</option>)}</select> : <div className="cell-stack"><strong>{p?.name || l.code || l.description}</strong><small>{l.code}</small></div>}</td>
            <td>{p?.pi || l.pi || '—'}</td>
            <td>{pending && canEdit && l.status !== 'Matched' ? <input className={cell} type="number" min="1" style={{ width: 80 }} value={e.quantity ?? l.quantity} onChange={ev => patch(list, l.id, { quantity: Number(ev.target.value) })}/> : `${l.quantity} ${l.unit}`}</td>
            <td><div className="cell-stack"><Badge tone={lineTone[l.status]}>{l.status}</Badge>{l.note && <small>{t(l.note)}</small>}</div></td>
            {pending && canEdit && <td>{l.status !== 'Matched' && <Button variant="ghost" size="sm" onClick={() => patch(list, l.id, { remove: !gone })}>{gone ? t('Keep') : t('Remove row')}</Button>}</td>}
          </tr>; })}</tbody></table></div>
        {pending && <div className="inline-actions">
          {canEdit && changes.length > 0 && <Button variant="outline" disabled={busy || !name?.trim()} onClick={() => void act(list, 'correct', { lines: changes.map(([id, v]) => ({ id, ...v })) })}><ClipboardCheck size={14}/>{t('Save corrections')}</Button>}
          {canApprove && <Button disabled={busy || !name?.trim() || flagged > 0 || changes.length > 0} onClick={() => { if (window.confirm(t('Approve all {n} lines? Every product will move to Container loading.', { n: list.lines.length }))) void act(list, 'approve', { okToAll: true }); }}><Check size={14}/>{t('Controller approval: OK to All')}</Button>}
          {canApprove && <Button variant="outline" disabled={busy || !name?.trim()} onClick={() => { const notes = window.prompt(t('Why is this loading list rejected?')); if (notes?.trim()) void act(list, 'reject', { notes }); }}><X size={14}/>{t('Reject')}</Button>}
          {!canApprove && <small className="muted">{t('Your role can upload and correct loading lists but cannot approve them.')}</small>}
        </div>}
        <details><summary>{t('Audit trail')} ({list.trail.length})</summary><ul>{list.trail.map((e, i) => <li key={i}><strong>{t(e.event)}</strong> · {e.actor} · {displayDate(e.at)}<br/><small>{e.detail}</small></li>)}</ul></details>
      </article>; })}</div>
  </section>;
}
