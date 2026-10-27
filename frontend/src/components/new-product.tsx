import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { useWorkspace } from '@/components/workspace-provider';
import { Field } from '@/components/operations-ui';
import { Button } from '@/components/ui/button';
import { ActorField, useRequestId } from '@/components/form-helpers';
import { useI18n } from '@/lib/i18n';
export function NewProduct({ close }: { close: () => void }) {
  const { data, mutate, busy } = useWorkspace(), { t } = useI18n(), dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState(''), [requestId] = useRequestId();
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); setError(''); const values = Object.fromEntries(new FormData(e.currentTarget)); const [category, subcategory] = String(values.lead).split('|'); try { await mutate('/workspace/products', { ...values, category, subcategory, quantity: Number(values.quantity), requestId }); close(); } catch (e) { setError(e instanceof Error ? e.message : t('Unable to create product.')); } }
  return <dialog className="op-dialog" ref={dialog} onCancel={close} onClick={e => { if (e.target === e.currentTarget) close(); }}><div className="dialog-heading"><div><span className="eyebrow">{t('NEW PRODUCT LINE')}</span><h2>{t('Add to your workspace')}</h2></div><Button variant="ghost" size="icon" onClick={close} aria-label={t('Close new product')}><X size={20}/></Button></div><form className="op-form" onSubmit={submit}><div className="form-grid">{[['pi', 'Final PI number'], ['order', 'Order reference'], ['customer', 'Customer name'], ['vendor', 'Vendor name'], ['name', 'Product name'], ['dimensions', 'Dimensions (optional)']].map(([name, label]) => <Field key={name} label={t(label)}><input name={name} required={name !== 'dimensions'} maxLength={200}/></Field>)}<Field label={t('Ordered quantity (pcs)')}><input name="quantity" type="number" min="1" max="1000000" step="1" required/></Field><Field label={t('Required customer delivery')}><input name="required" type="date" required/></Field></div><Field label={t('Production category / subcategory')}><select name="lead" required>{data?.leads.map(l => <option key={l.category + l.subcategory} value={`${l.category}|${l.subcategory}`}>{t(l.category)} / {t(l.subcategory)}</option>)}</select></Field><Field label={t('Specifications (optional)')}><textarea name="specs" rows={2} maxLength={200}/></Field><ActorField/>{error && <div className="error-banner" role="alert">{t(error)}</div>}<Button disabled={busy}>{busy ? t('Saving…') : t('Create product line')}</Button></form></dialog>;
}
