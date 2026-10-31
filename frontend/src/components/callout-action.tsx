import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { useWorkspace } from '@/components/workspace-provider';
import { useAuth } from '@/components/auth-provider';
import { Field } from '@/components/operations-ui';
import { Button } from '@/components/ui/button';
import { ActorField, useRequestId } from '@/components/form-helpers';
import { useI18n } from '@/lib/i18n';
import { request, type Product } from '@/services/workspace-api';

export type CalloutChoice = 'China warehouse' | 'Shipments' | 'Hold';
export const calloutLabels: Record<CalloutChoice, string> = { 'China warehouse': 'Move to China Warehouse', Shipments: 'Move to Shipments', Hold: 'Hold' };
const holdReasons = ['Vendor quality check pending', 'Vendor asked for more time', 'Customer asked to wait', 'Payment or paperwork pending', 'Packing not ready', 'Other'];
interface Outcome { updated: number; skipped: { id: string; name: string; error: string }[] }

/** The three decisions for finished goods: Move to China Warehouse, Move to Shipments, or Hold (a reason is required). One or many products. */
export function CalloutAction({ products, action, close }: { products: Product[]; action: CalloutChoice; close: () => void }) {
  const { refresh } = useWorkspace(), { enabled, user } = useAuth(), { t } = useI18n(), dialog = useRef<HTMLDialogElement>(null), [requestId] = useRequestId();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [outcome, setOutcome] = useState<Outcome | null>(null), [pick, setPick] = useState(holdReasons[0]);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const hold = action === 'Hold', single = products.length === 1, remaining = single ? products[0].quantity - products[0].china : 0;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('');
    const values = Object.fromEntries(new FormData(e.currentTarget)), reason = pick === 'Other' ? String(values.other || '').trim() : pick;
    if (hold && !reason) { setError(t('Say why the goods are held. A reason is required.')); return; }
    setBusy(true);
    try {
      const result = await request<{ bulk: Outcome }>('/workspace/products/callout-action', { actor: enabled ? user?.name : values.actor, ids: products.map(p => p.id), action, reason: hold ? reason : '', notes: values.notes, quantity: single && !hold ? Number(values.quantity) : undefined, requestId });
      setOutcome(result.bulk); await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : t('Unable to update.')); } finally { setBusy(false); }
  }
  return <dialog className="op-dialog" ref={dialog} onCancel={close} onClick={e => { if (e.target === e.currentTarget) close(); }}>
    <div className="dialog-heading"><div><span className="eyebrow">{t('VENDOR CALL-OUT')}</span><h2>{t(calloutLabels[action])}</h2></div><Button variant="ghost" size="icon" onClick={close} aria-label={t('Close')}><X size={20}/></Button></div>
    {outcome ? <div className="op-form">
      <div className={outcome.updated ? 'success-banner' : 'error-banner'} role="status"><CheckCircle2 size={16}/> {t('{n} products updated.', { n: outcome.updated })}</div>
      {outcome.skipped.length > 0 && <><p className="muted">{t('{n} products were skipped because the update is not allowed for them:', { n: outcome.skipped.length })}</p><ul className="bulk-skipped">{outcome.skipped.map(s => <li key={s.id}><strong>{s.name}</strong> · <small>{s.id}</small><br/><span className="muted">{t(s.error)}</span></li>)}</ul></>}
      <Button onClick={close}>{t('Done')}</Button>
    </div> : <form className="op-form" onSubmit={submit}>
      <div className="info-banner" role="note">{hold ? t('Hold keeps the finished goods at the vendor. The reason is saved and shown on the Vendor Call-out page until the goods are moved.') : action === 'Shipments' ? t('The goods are taken from the vendor and are ready to go straight onto a container loading list.') : t('The goods are taken from the vendor into the China warehouse.')}</div>
      <p className="muted">{products.slice(0, 5).map(p => p.name).join(', ')}{products.length > 5 ? ` +${products.length - 5}` : ''}</p>
      {hold && <><Field label={t('Why are you holding these goods?')}><select value={pick} onChange={e => setPick(e.target.value)}>{holdReasons.map(r => <option key={r} value={r}>{t(r)}</option>)}</select></Field>
        {pick === 'Other' && <Field label={t('Reason')}><input name="other" required maxLength={300} placeholder={t('Write the reason')}/></Field>}</>}
      {!hold && single && <Field label={t('Quantity to move ({n} still at the vendor)', { n: remaining })}><input name="quantity" type="number" min="1" max={remaining} step="1" defaultValue={remaining} required/></Field>}
      {!hold && !single && <p className="muted">{t('The full remaining quantity of every selected product is moved.')}</p>}
      <Field label={hold ? t('Extra note (optional)') : t('Note (optional)')}><textarea name="notes" rows={2} maxLength={400}/></Field>
      <ActorField/>
      {error && <div className="error-banner" role="alert">{t(error)}</div>}
      <Button type="submit" disabled={busy}>{busy ? t('Saving…') : hold ? t('Put on hold') : t(calloutLabels[action])}</Button>
    </form>}
  </dialog>;
}
