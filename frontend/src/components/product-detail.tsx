import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X, ArrowRight, ClipboardCheck, ExternalLink, Lock } from 'lucide-react';
import { useWorkspace } from '@/components/workspace-provider';
import { useAuth } from '@/components/auth-provider';
import { Badge, Field } from '@/components/operations-ui';
import { Button } from '@/components/ui/button';
import { ExceptionForm } from '@/components/exception-form';
import { ActorField, EvidenceField, PhotoField, PhotoList, useRequestId } from '@/components/form-helpers';
import { useI18n } from '@/lib/i18n';
import { displayDate, movementTypes, request, type Product } from '@/services/workspace-api';

const isLink = (value?: string) => Boolean(value && /^https?:\/\//i.test(value));
const tabNames = ['Overview', 'Update product', 'Record movement', 'Exceptions', 'History'];
function Detail({ product: p, close }: { product: Product; close: () => void }) {
  const { data, mutate, busy, refresh } = useWorkspace(), { can } = useAuth(), { t } = useI18n(), [requestId, renew] = useRequestId();
  const allowedMovements = movementTypes.filter(type => can(`movement.${type}`));
  const actions = p.closed ? (can('product.reopen') ? ['Reopen product line'] : []) : [
    ...(can('followup') ? ['Update follow-up'] : []), ...(can('delivery.revise') ? ['Revise delivery date'] : []),
    ...(p.authorization !== 'Approved for Production' && can('production.authorize') ? ['Authorize production'] : []),
    ...(p.authorization === 'Approved for Production' && !p.instructionDate && !p.completionDate && can('production.instruct') ? ['Record instruction'] : []),
    ...(p.instructionDate && !p.ackDate && can('production.ack') ? ['Record acknowledgment'] : []),
    ...(p.ackDate && !p.startDate && !p.completionDate && can('production.start') ? ['Start production'] : []),
    ...(p.startDate && !p.completionDate && p.production !== 'Production Completed' && can('production.complete') ? ['Complete production'] : []),
    ...(p.production === 'Production Completed' && p.calledOut < p.quantity && can('callout') ? ['Record vendor call-out'] : []),
    ...(can('product.close') ? ['Close product line'] : []),
  ];
  const [tab, setTab] = useState('Overview'), [action, setAction] = useState(actions[0] || ''), [movement, setMovement] = useState<string>(allowedMovements[0] || 'China receiving'), [error, setError] = useState(''), [saved, setSaved] = useState(''), [photos, setPhotos] = useState<string[]>([]);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
      if (event.key === 'Tab') {
        const elements = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea,a[href]');
        if (!elements?.length) return;
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [close]);
  const current = actions.includes(action) ? action : actions[0] || '';
  const balance = p.quantity - p.delivered, noDate = ['Update follow-up', 'Revise delivery date', 'Close product line', 'Reopen product line'], unit = t(p.unit);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setSaved('');
    const form = event.currentTarget, values = Object.fromEntries(new FormData(form));
    try {
      if (tab === 'Record movement') {
        const needsPhotos = movement === 'Container loading' || movement === 'India receiving';
        if (needsPhotos && photos.length === 0) throw new Error(movement === 'Container loading' ? 'Attach at least one photo of the goods loaded in the container.' : 'Attach at least one photo of the goods received in India.');
        const result = await mutate('/workspace/drafts', { ...values, productId: p.id, type: movement, quantity: Number(values.quantity), photos: needsPhotos ? photos : [], requestId });
        const draft = result?.drafts.find(d => d.requestId === requestId);
        setSaved(t('Draft created. A reviewer approves it in the Approval Inbox before any quantity changes.'));
        setPhotos([]);
        // India receiving: the AI compares the loading photos with these receiving photos right away.
        if (movement === 'India receiving' && draft) { setSaved(t('Draft created. The AI is auditing the received goods…')); void request(`/workspace/drafts/${draft.id}/audit`, {}).then(() => refresh()).then(() => setSaved(t('Draft created and audited by AI. A reviewer approves it in the Approval Inbox.'))).catch(() => setSaved(t('Draft created. The AI audit could not run; run it from the Approval Inbox.'))); }
      } else {
        await mutate(`/workspace/products/${p.id}/update`, { ...values, action: current, quantity: Number(values.quantity || 0), shortClose: values.shortClose === 'on', requestId });
        setSaved(t('Saved. Planning and alerts have been recalculated.'));
      }
      renew(); form.reset();
    } catch (e) { setError(e instanceof Error ? e.message : t('Unable to save.')); }
  }
  const timeline = [
    ['Authorization', p.authorization === 'Approved for Production'], ['Production', p.production === 'Production Completed'], ['Vendor call-out', p.calledOut >= p.quantity],
    ['China warehouse', p.china >= p.quantity], ['Container loading', p.loaded >= p.quantity], ['India receiving', p.india >= p.quantity], ['Customer delivery', p.delivered >= p.quantity], ['Closed', Boolean(p.closed)],
  ] as const;
  const exceptions = data?.exceptions.filter(e => e.Product_ID === p.id) || [];
  const openExceptions = exceptions.filter(e => e.Status === 'Open').length;
  return <div className="drawer-backdrop" onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <aside className="product-drawer" ref={panel} role="dialog" aria-modal="true" aria-labelledby="product-title">
      <div className="drawer-header"><div><span className="eyebrow">{p.pi} · {p.id}</span><h2 id="product-title">{p.name}</h2><p>{p.customer} <ArrowRight size={13}/> {p.vendor}</p></div><Button variant="ghost" size="icon" aria-label={t('Close product details')} onClick={close}><X size={20}/></Button></div>
      <div className="drawer-tabs" role="tablist" aria-label={t('Product details')}>{tabNames.map(name => <button key={name} role="tab" id={`detail-${name.replaceAll(' ', '-')}`} aria-selected={tab === name} aria-controls="detail-panel" onClick={() => { setTab(name); setError(''); setSaved(''); setPhotos([]); }}>{t(name)}{name === 'Exceptions' && openExceptions > 0 ? ` (${openExceptions})` : ''}</button>)}</div>
      <div className="drawer-body" role="tabpanel" id="detail-panel" aria-labelledby={`detail-${tab.replaceAll(' ', '-')}`}>
        {tab === 'Overview' && <>
          <div className="detail-badges"><Badge>{p.planning.stage}</Badge><Badge>{p.planning.risk}</Badge>{p.quarantined > 0 && <Badge tone="amber">{t('{n} in quarantine', { n: p.quarantined })}</Badge>}{openExceptions > 0 && <Badge tone="red">{t('{n} open exceptions', { n: openExceptions })}</Badge>}</div>
          {p.closed && <div className="info-banner"><Lock size={18}/><span>{t('Closed on {date} by {name}.', { date: displayDate(p.closed), name: p.closedBy })} {t(p.closedReason)}</span></div>}
          <div className="quantity-flow">{[['Ordered', p.quantity], ['Called out', p.calledOut], ['China', p.china], ['Loaded', p.loaded], ['India', p.india], ['Delivered', p.delivered]].map(([label, value]) => <div key={label}><strong>{value}</strong><span>{t(String(label))}</span></div>)}</div>
          <div className="step-list">{timeline.map(([label, complete]) => <div className={complete ? 'done' : ''} key={label}><span>{complete ? '✓' : '○'}</span>{t(label)}</div>)}</div>
          {!p.closed && <div className="next-action-card"><span className="eyebrow">{t('NEXT ACTION')}</span><h3>{t(p.nextAction)}</h3><p>{t(p.owner)} · {t('Due {date}', { date: displayDate(p.deadline) })}</p></div>}
          <dl className="detail-grid">{[['Required delivery', displayDate(p.required)], ['Latest instruction', displayDate(p.planning.latestInstruction)], ['Latest production start', displayDate(p.planning.latestStart)], ['Latest completion', displayDate(p.planning.latestComplete)], ['Manufacturing / logistics', t('{a} / {b} days (+{c} confirmation)', { a: p.planning.manufacturing, b: p.planning.logistics, c: p.planning.confirmation })], ['Production status', t(p.production)], ['Vendor call-out', p.calledOut ? `${p.calledOut} / ${p.quantity}${p.vendorCommitDate ? ' · ' + t('vendor promised {date}', { date: displayDate(p.vendorCommitDate) }) : ''}` : t('Not called out')], ['Original customer date', displayDate(p.originalRequired)], ['Specifications', p.specs], ['Dimensions', p.dimensions], ['Order', p.order], ['Shipment', p.shipment ? `${p.shipment}${p.container ? ' · ' + p.container : ''}` : t('Not allocated')]].map(([label, value]) => <div key={label}><dt>{t(label)}</dt><dd>{value || '—'}</dd></div>)}</dl>
        </>}
        {(tab === 'Update product' || tab === 'Record movement') && (tab === 'Update product' ? actions.length === 0 : allowedMovements.length === 0 || Boolean(p.closed))
          ? <div className="info-banner"><Lock size={18}/><span>{p.closed ? t('This product line is closed.') : t('Your role has no actions here.')}</span></div>
          : (tab === 'Update product' || tab === 'Record movement') && <form className="op-form" onSubmit={submit} key={tab + current + movement}>
          {tab === 'Update product' ? <><Field label="What happened?"><select value={current} onChange={e => { setAction(e.target.value); setSaved(''); }}>{actions.map(value => <option key={value} value={value}>{t(value)}</option>)}</select></Field>
            {current === 'Update follow-up' && <div className="form-grid"><Field label="Responsible person"><input name="owner" defaultValue={p.owner} required maxLength={100}/></Field><Field label="Next-action deadline"><input type="date" name="deadline" defaultValue={data?.today} required/></Field></div>}
            {current === 'Revise delivery date' && <Field label="Customer-confirmed required date"><input type="date" name="required" defaultValue={p.required} required/></Field>}
            {current === 'Record vendor call-out' && <div className="form-grid"><Field label={t('Units called out (up to {n})', { n: p.quantity - p.calledOut })}><input type="number" name="quantity" min="1" max={p.quantity - p.calledOut} step="1" defaultValue={p.quantity - p.calledOut} required/></Field><Field label="Vendor promises delivery by"><input type="date" name="vendorCommitDate" min={data?.today}/></Field></div>}
            {current === 'Close product line' && <>{balance > 0 && <label className="check-field"><input type="checkbox" name="shortClose"/><span>{t('Close with the remaining {n} undelivered (short close)', { n: `${balance} ${unit}` })}</span></label>}<div className="info-banner"><ClipboardCheck size={18}/>{t('Closing needs: no open exceptions, no pending drafts and no goods left in a warehouse or in transit.')}</div></>}
            {!noDate.includes(current) && <Field label="Actual event date"><input type="date" name="date" defaultValue={data?.today} max={data?.today} required/></Field>}
            {!['Update follow-up', 'Revise delivery date'].includes(current) && <EvidenceField/>}
          </> : <>
            <div className="info-banner"><ClipboardCheck size={18}/>{t('This creates a draft. Quantities change only after a reviewer approves it in the inbox.')}</div>
            <Field label="Movement"><select value={movement} onChange={e => { setMovement(e.target.value); setSaved(''); setPhotos([]); }}>{allowedMovements.map(value => <option key={value} value={value}>{t(value)}</option>)}</select></Field>
            <div className="form-grid"><Field label={`${t('Quantity')} (${unit})`}><input type="number" name="quantity" min="1" max={p.quantity} step="1" required defaultValue="1"/></Field><Field label="Carton reference (optional)"><input name="carton" maxLength={100} placeholder="CTN-…"/></Field></div>
            <Field label="Unique receipt / document reference"><input name="document" maxLength={200} required placeholder={t('e.g. CN-RECEIPT-20261024-01')}/></Field>
            {movement === 'Container loading' && <div className="form-grid"><Field label="Shipment reference"><input name="shipment" defaultValue={p.shipment} required maxLength={100}/></Field><Field label="Container number"><input name="container" defaultValue={p.container} required maxLength={100}/></Field></div>}
            {movement === 'Container loading' && <PhotoField kind="loading" label="Photos of the goods loaded in the container" required paths={photos} setPaths={setPhotos}/>}
            {movement === 'India receiving' && <PhotoField kind="receiving" label="Photos of the goods received in India" required paths={photos} setPaths={setPhotos}/>}
            <EvidenceField/>
          </>}
          <ActorField/>
          <Field label={tab === 'Update product' && current === 'Update follow-up' ? 'Next action' : 'Evidence / update note'}><textarea name="notes" required maxLength={2000} rows={4} placeholder={t('What changed? Include the evidence or document reference.')}/></Field>
          {error && <div className="error-banner" role="alert">{t(error)}</div>}{saved && <div className="success-banner" role="status">{saved}</div>}
          <Button type="submit" disabled={busy}>{busy ? t('Saving…') : tab === 'Record movement' ? t('Create movement draft') : current === 'Close product line' ? t('Close product line') : t('Save product update')}</Button>
        </form>}
        {tab === 'Exceptions' && <>
          {exceptions.length === 0 ? <p className="muted">{t('No exceptions for this product.')}</p> : <div className="exception-list">{exceptions.map(e => <article key={e.Exception_ID}><div><strong>{t(e.Problem_Type)}</strong><Badge tone={e.Status === 'Open' ? (e.Deadline < (data?.today || '') ? 'red' : 'amber') : 'green'}>{e.Status}</Badge></div><p>{e.Description}</p><small>{e.Responsible_Person} · {t('fix by {date}', { date: displayDate(e.Deadline) })}{e.Quarantine === 'yes' ? ` · ${t('{n} quarantined', { n: e.Quantity })}` : ''}{e.Resolution_Notes ? ` · ${e.Resolution_Notes}` : ''}</small></article>)}</div>}
          {!p.closed && can('exception.raise') && <><h3 className="drawer-subtitle">{t('Raise a new exception')}</h3><ExceptionForm productId={p.id}/></>}
        </>}
        {tab === 'History' && <div className="activity-timeline">{data?.activity.filter(a => a.productId === p.id).map(a => <article key={a.id}><span className="timeline-dot"/><strong>{t(a.action)}{a.quantity ? ` · ${a.quantity} ${unit}` : ''}</strong><small>{displayDate(a.at)} · {a.actor} · {a.document || t(a.source)}</small><p>{a.notes}</p>{a.evidence && (isLink(a.evidence) ? <a className="text-link" href={a.evidence} target="_blank" rel="noreferrer noopener">{t('Evidence')} <ExternalLink size={13}/></a> : <small>{t('Evidence')}: {a.evidence}</small>)}<PhotoList paths={a.photos}/></article>)}{!data?.activity.some(a => a.productId === p.id) && <p className="muted">{t('No events yet.')}</p>}</div>}
      </div>
    </aside>
  </div>;
}
export function ProductDetail() {
  const { data, selected, select } = useWorkspace();
  const p = data?.products.find(p => p.id === selected);
  // Stable setter avoids resetting focus when workspace data refreshes.
  const close = useRef(() => select('')).current;
  return p ? <Detail key={p.id} product={p} close={close}/> : null;
}
