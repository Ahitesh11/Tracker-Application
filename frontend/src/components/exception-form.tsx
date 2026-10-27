import { useState, type FormEvent } from 'react';
import { useWorkspace } from '@/components/workspace-provider';
import { Field } from '@/components/operations-ui';
import { Button } from '@/components/ui/button';
import { ActorField, useRequestId } from '@/components/form-helpers';
import { exceptionTypes } from '@/services/workspace-api';

/** Raise an exception: what went wrong, who owns it, by when. Damage and Shortage can hold units in quarantine. */
export function ExceptionForm({ productId, onDone }: { productId?: string; onDone?: () => void }) {
  const { data, mutate, busy } = useWorkspace(), [requestId, renew] = useRequestId();
  const [type, setType] = useState('Damage'), [product, setProduct] = useState(productId || ''), [quarantine, setQuarantine] = useState(false), [error, setError] = useState('');
  const chosen = data?.products.find(p => p.id === product), available = chosen ? Math.max(chosen.china - chosen.loaded - chosen.quarantined, 0) : 0;
  const canQuarantine = type === 'Damage' || type === 'Shortage';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const form = event.currentTarget, values = Object.fromEntries(new FormData(form));
    try { await mutate('/workspace/exceptions', { ...values, productId: product, type, quarantine: canQuarantine && quarantine, quantity: Number(values.quantity || 0), requestId }); renew(); form.reset(); setQuarantine(false); onDone?.(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not raise the exception.'); }
  }
  return <form className="op-form" onSubmit={submit}>
    {!productId && <Field label="Product"><select value={product} onChange={e => setProduct(e.target.value)} required><option value="">Choose a product…</option>{data?.products.filter(p => !p.closed).map(p => <option key={p.id} value={p.id}>{p.name} · {p.pi}</option>)}</select></Field>}
    <div className="form-grid"><Field label="What went wrong?"><select value={type} onChange={e => setType(e.target.value)}>{exceptionTypes.map(value => <option key={value}>{value}</option>)}</select></Field><Field label="Responsible person"><input name="owner" required maxLength={100} placeholder="Who will fix it?"/></Field></div>
    <Field label="Description"><textarea name="description" required maxLength={1000} rows={3} placeholder="What happened? Which cartons or units?"/></Field>
    <div className="form-grid"><Field label="Fix by"><input name="deadline" type="date" required min={data?.today}/></Field>{canQuarantine && <label className="check-field"><input type="checkbox" checked={quarantine} onChange={e => setQuarantine(e.target.checked)} disabled={!chosen || available < 1}/><span>Hold units in quarantine{chosen ? ` (${available} available in China)` : ''}</span></label>}</div>
    {canQuarantine && quarantine && <Field label="Units to quarantine"><input name="quantity" type="number" min="1" max={available} step="1" required/></Field>}
    <ActorField/>
    {error && <div className="error-banner" role="alert">{error}</div>}
    <Button type="submit" disabled={busy || !product}>{busy ? 'Saving…' : 'Raise exception'}</Button>
  </form>;
}
