import { useState, type FormEvent } from 'react';
import { useWorkspace } from '@/components/workspace-provider';
import { Field } from '@/components/operations-ui';
import { Button } from '@/components/ui/button';
import { ActorField, useRequestId } from '@/components/form-helpers';
import { useI18n } from '@/lib/i18n';
import { exceptionTypes } from '@/services/workspace-api';

/** Raise an exception: what went wrong, who owns it, by when. Damage and Shortage can hold units in quarantine. */
export function ExceptionForm({ productId, onDone }: { productId?: string; onDone?: () => void }) {
  const { data, mutate, busy } = useWorkspace(), { t } = useI18n(), [requestId, renew] = useRequestId();
  const [type, setType] = useState('Damage'), [product, setProduct] = useState(productId || ''), [quarantine, setQuarantine] = useState(false), [error, setError] = useState('');
  const chosen = data?.products.find(p => p.id === product), available = chosen ? Math.max(chosen.china - chosen.loaded - chosen.quarantined, 0) : 0;
  const canQuarantine = type === 'Damage' || type === 'Shortage';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const form = event.currentTarget, values = Object.fromEntries(new FormData(form));
    try { await mutate('/workspace/exceptions', { ...values, productId: product, type, quarantine: canQuarantine && quarantine, quantity: Number(values.quantity || 0), requestId }); renew(); form.reset(); setQuarantine(false); onDone?.(); }
    catch (e) { setError(e instanceof Error ? e.message : t('Could not raise the exception.')); }
  }
  return <form className="op-form" onSubmit={submit}>
    {!productId && <Field label={t('Product')}><select value={product} onChange={e => setProduct(e.target.value)} required><option value="">{t('Choose a product…')}</option>{data?.products.filter(p => !p.closed).map(p => <option key={p.id} value={p.id}>{p.name} · {p.pi}</option>)}</select></Field>}
    <div className="form-grid"><Field label={t('What went wrong?')}><select value={type} onChange={e => setType(e.target.value)}>{exceptionTypes.map(value => <option key={value} value={value}>{t(value)}</option>)}</select></Field><Field label={t('Responsible person')}><input name="owner" required maxLength={100} placeholder={t('Who will fix it?')}/></Field></div>
    <Field label={t('Description')}><textarea name="description" required maxLength={1000} rows={3} placeholder={t('What happened? Which cartons or units?')}/></Field>
    <div className="form-grid"><Field label={t('Fix by')}><input name="deadline" type="date" required min={data?.today}/></Field>{canQuarantine && <label className="check-field"><input type="checkbox" checked={quarantine} onChange={e => setQuarantine(e.target.checked)} disabled={!chosen || available < 1}/><span>{t('Hold units in quarantine')}{chosen ? ` (${t('{n} available in China', { n: available })})` : ''}</span></label>}</div>
    {canQuarantine && quarantine && <Field label={t('Units to quarantine')}><input name="quantity" type="number" min="1" max={available} step="1" required/></Field>}
    <ActorField/>
    {error && <div className="error-banner" role="alert">{t(error)}</div>}
    <Button type="submit" disabled={busy || !product}>{busy ? t('Saving…') : t('Raise exception')}</Button>
  </form>;
}
