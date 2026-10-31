import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { useWorkspace } from '@/components/workspace-provider';
import { useAuth } from '@/components/auth-provider';
import { Field, canTake } from '@/components/operations-ui';
import { Button } from '@/components/ui/button';
import { ActorField, PhotoField, useRequestId } from '@/components/form-helpers';
import { useI18n } from '@/lib/i18n';
import { request, type Product } from '@/services/workspace-api';

// action -> permission needed. Closing, reopening and vendor call-outs stay one product at a time.
const actions: [string, string][] = [
  ['Finalise measurement', 'production.authorize'], ['Authorize production', 'production.authorize'],
  ['Start production', 'production.start'], ['Complete production', 'production.complete'], ['Revise delivery date', 'delivery.revise'],
];
const dated = ['Finalise measurement', 'Start production', 'Complete production'];
const proof = ['Start production', 'Complete production']; // China confirms these with photos
interface Outcome { updated: number; skipped: { id: string; name: string; error: string }[] }

/** One update applied to every selected product. Products that cannot take it are skipped and listed with the reason. */
export function BulkUpdate({ products, close }: { products: Product[]; close: () => void }) {
  const { refresh, data } = useWorkspace(), { can } = useAuth(), { t } = useI18n(), dialog = useRef<HTMLDialogElement>(null);
  const allowed = actions.filter(([, permission]) => can(permission)), [picked, setAction] = useState('');
  // Only the updates that at least one selected product can still take; a step that is already done is not offered.
  const offered = allowed.map(([name]) => ({ name, ready: products.filter(p => canTake(name, p)) })).filter(o => o.ready.length > 0);
  const action = offered.some(o => o.name === picked) ? picked : offered[0]?.name || '', ready = offered.find(o => o.name === action)?.ready || [];
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [outcome, setOutcome] = useState<Outcome | null>(null), [requestId] = useRequestId(), [photos, setPhotos] = useState<string[]>([]), [uploading, setUploading] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  // An event cannot be dated before the step it follows (for example Start production before the acknowledgment).
  const today = data?.today || new Date().toISOString().slice(0, 10), latest = (pick: (p: Product) => string) => ready.map(pick).filter(Boolean).sort().at(-1) || '';
  const minDate = action === 'Complete production' ? latest(p => p.startDate) : '';
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('');
    if (proof.includes(action) && photos.length === 0) { setError('Attach at least one proof photo.'); return; }
    setBusy(true);
    try {
      const values = Object.fromEntries(new FormData(e.currentTarget));
      const result = await request<{ bulk: Outcome }>('/workspace/products/bulk-update', { ...values, action, photos, ids: ready.map(p => p.id), requestId });
      setOutcome(result.bulk); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : t('Unable to update.')); } finally { setBusy(false); }
  }
  return <dialog className="op-dialog" ref={dialog} onCancel={close} onClick={e => { if (e.target === e.currentTarget) close(); }}>
    <div className="dialog-heading"><div><span className="eyebrow">{t('BULK UPDATE')}</span><h2>{t('Update {n} products at once', { n: products.length })}</h2></div><Button variant="ghost" size="icon" onClick={close} aria-label={t('Close bulk update')}><X size={20}/></Button></div>
    {outcome ? <div className="op-form">
      <div className="success-banner" role="status"><CheckCircle2 size={16}/> {t('{n} products updated.', { n: outcome.updated })}</div>
      {outcome.skipped.length > 0 && <><p className="muted">{t('{n} products were skipped because the update is not allowed for them:', { n: outcome.skipped.length })}</p>
        <ul className="bulk-skipped">{outcome.skipped.map(s => <li key={s.id}><strong>{s.name}</strong> · <small>{s.id}</small><br/><span className="muted">{t(s.error)}</span></li>)}</ul></>}
      <Button onClick={close}>{t('Done')}</Button>
    </div> : <form className="op-form" onSubmit={submit}>
      <div className="info-banner" role="note">{t('Bulk update: the same update is applied to every selected product. To update one product, close this and open that product.')}</div>
      <p className="muted">{products.slice(0, 5).map(p => p.name).join(', ')}{products.length > 5 ? ` +${products.length - 5}` : ''}</p>
      {offered.length === 0 ? <div className="info-banner">{t('Nothing is left to update together for these products. Production steps they already completed are not offered again.')}</div> : <Field label={t('Update')}><select value={action} onChange={e => { setAction(e.target.value); setPhotos([]); }}>{offered.map(o => <option key={o.name} value={o.name}>{t(o.name)} ({o.ready.length}/{products.length})</option>)}</select></Field>}
      {offered.length > 0 && ready.length < products.length && <p className="muted">{t('{n} of the selected products cannot take this update (already done, or an earlier step is missing) and are left out.', { n: products.length - ready.length })}</p>}
      {dated.includes(action) && <Field label={t('Actual event date')}><input name="date" type="date" key={action} defaultValue={today} min={minDate || undefined} max={today} required/></Field>}
      {dated.includes(action) && minDate && <p className="muted">{t('The date cannot be earlier than {date}, when the previous step was recorded.', { date: minDate })}</p>}
      {action === 'Revise delivery date' && <Field label={t('New required delivery date')}><input name="required" type="date" required/></Field>}
      {proof.includes(action) && <PhotoField kind="product" label={action === 'Start production' ? 'Photos proving production has started' : 'Photos proving production is complete'} required paths={photos} setPaths={setPhotos} onBusyChange={setUploading}/>}
      <Field label={t('Update note')}><textarea name="notes" rows={2} required maxLength={200}/></Field>
      <ActorField/>
      {error && <div className="error-banner" role="alert">{t(error)}</div>}
      <Button type="submit" disabled={busy || uploading || !ready.length}>{busy ? t('Saving…') : t('Apply to {n} products', { n: ready.length })}</Button>
    </form>}
  </dialog>;
}
