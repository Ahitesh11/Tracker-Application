import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { useWorkspace } from '@/components/workspace-provider';
import { useAuth } from '@/components/auth-provider';
import { Field } from '@/components/operations-ui';
import { Button } from '@/components/ui/button';
import { ActorField, PhotoField, useRequestId } from '@/components/form-helpers';
import { useI18n } from '@/lib/i18n';
import { request, type Product } from '@/services/workspace-api';

// action -> permission needed. Closing, reopening and vendor call-outs stay one product at a time.
const actions: [string, string][] = [
  ['Finalise measurement', 'production.authorize'], ['Authorize production', 'production.authorize'], ['Record instruction', 'production.instruct'], ['Record acknowledgment', 'production.ack'],
  ['Start production', 'production.start'], ['Complete production', 'production.complete'], ['Update follow-up', 'followup'], ['Revise delivery date', 'delivery.revise'],
];
const dated = ['Finalise measurement', 'Record instruction', 'Record acknowledgment', 'Start production', 'Complete production'];
const proof = ['Start production', 'Complete production']; // China confirms these with photos
interface Outcome { updated: number; skipped: { id: string; name: string; error: string }[] }

/** One update applied to every selected product. Products that cannot take it are skipped and listed with the reason. */
export function BulkUpdate({ products, close }: { products: Product[]; close: () => void }) {
  const { refresh } = useWorkspace(), { can } = useAuth(), { t } = useI18n(), dialog = useRef<HTMLDialogElement>(null);
  const allowed = actions.filter(([, permission]) => can(permission)), [action, setAction] = useState(allowed[0]?.[0] || '');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [outcome, setOutcome] = useState<Outcome | null>(null), [requestId] = useRequestId(), [photos, setPhotos] = useState<string[]>([]), [uploading, setUploading] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('');
    if (proof.includes(action) && photos.length === 0) { setError('Attach at least one proof photo.'); return; }
    setBusy(true);
    try {
      const values = Object.fromEntries(new FormData(e.currentTarget));
      const result = await request<{ bulk: Outcome }>('/workspace/products/bulk-update', { ...values, action, photos, ids: products.map(p => p.id), requestId });
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
      <Field label={t('Update')}><select value={action} onChange={e => { setAction(e.target.value); setPhotos([]); }}>{allowed.map(([name]) => <option key={name} value={name}>{t(name)}</option>)}</select></Field>
      {dated.includes(action) && <Field label={t('Actual event date (leave empty for today)')}><input name="date" type="date" max={new Date().toISOString().slice(0, 10)}/></Field>}
      {action === 'Update follow-up' && <div className="form-grid"><Field label={t('Next-action deadline')}><input name="deadline" type="date" required/></Field><Field label={t('Owner (optional)')}><input name="owner" maxLength={100}/></Field></div>}
      {action === 'Revise delivery date' && <Field label={t('New required delivery date')}><input name="required" type="date" required/></Field>}
      {proof.includes(action) && <PhotoField kind="product" label={action === 'Start production' ? 'Photos proving production has started' : 'Photos proving production is complete'} required paths={photos} setPaths={setPhotos} onBusyChange={setUploading}/>}
      <Field label={action === 'Update follow-up' ? t('Next action') : t('Update note')}><textarea name="notes" rows={2} required maxLength={200}/></Field>
      <ActorField/>
      {error && <div className="error-banner" role="alert">{t(error)}</div>}
      <Button type="submit" disabled={busy || uploading || !allowed.length}>{busy ? t('Saving…') : t('Apply to {n} products', { n: products.length })}</Button>
    </form>}
  </dialog>;
}
