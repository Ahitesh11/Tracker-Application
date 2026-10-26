import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X, ArrowRight, ClipboardCheck } from 'lucide-react';
import { useWorkspace } from '@/components/workspace-provider';
import { Badge, Field } from '@/components/operations-ui';
import { Button } from '@/components/ui/button';
import { displayDate, type Product } from '@/services/workspace-api';

function Detail({ product: p, close }: { product: Product; close: () => void }) {
  const { data, mutate, busy } = useWorkspace();
  const [tab, setTab] = useState('Overview'), [action, setAction] = useState('Update follow-up'), [movement, setMovement] = useState('China receiving'), [error, setError] = useState(''), [saved, setSaved] = useState('');
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
  const actions = ['Update follow-up', 'Revise delivery date', ...(p.issues.length ? ['Reconcile imported balances', 'Resolve data review'] : []),
    ...(p.authorization !== 'Approved for Production' ? ['Authorize production'] : []),
    ...(p.authorization === 'Approved for Production' && !p.instructionDate && !p.completionDate ? ['Record instruction'] : []),
    ...(p.instructionDate && !p.ackDate ? ['Record acknowledgment'] : []),
    ...(p.ackDate && !p.startDate && !p.completionDate ? ['Start production'] : []),
    ...(p.startDate && !p.completionDate && p.production !== 'Production Completed' ? ['Complete production'] : []),
  ];
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setSaved('');
    const form = new FormData(event.currentTarget), values = Object.fromEntries(form);
    try {
      if (tab === 'Record movement') {
        await mutate('/workspace/drafts', { ...values, productId: p.id, type: movement, quantity: Number(values.quantity) });
        setSaved('Draft created. Open Approval Inbox to review and post the movement.');
      } else { await mutate(`/workspace/products/${p.id}/update`, { ...values, action }); setAction('Update follow-up'); setSaved('Product updated. Planning and alerts have been recalculated.'); }
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save.'); }
  }
  const timeline = [
    ['Authorization', p.authorization === 'Approved for Production'], ['Production', p.production === 'Production Completed'],
    ['China warehouse', p.china >= p.quantity], ['Container loading', p.loaded >= p.quantity], ['India receiving', p.india >= p.quantity], ['Customer delivery', p.delivered >= p.quantity],
  ] as const;
  return <div className="drawer-backdrop" onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <aside className="product-drawer" ref={panel} role="dialog" aria-modal="true" aria-labelledby="product-title">
      <div className="drawer-header"><div><span className="eyebrow">{p.pi} · {p.id}</span><h2 id="product-title">{p.name}</h2><p>{p.customer} <ArrowRight size={13}/> {p.vendor}</p></div><Button variant="ghost" size="icon" aria-label="Close product details" onClick={close}><X size={20}/></Button></div>
      <div className="drawer-tabs" role="tablist" aria-label="Product details">{['Overview', 'Update product', 'Record movement', 'History'].map(name => <button key={name} role="tab" id={`detail-${name.replaceAll(' ', '-')}`} aria-selected={tab === name} aria-controls="detail-panel" onClick={() => { setTab(name); setError(''); setSaved(''); }}>{name}</button>)}</div>
      <div className="drawer-body" role="tabpanel" id="detail-panel" aria-labelledby={`detail-${tab.replaceAll(' ', '-')}`}>
        {tab === 'Overview' && <>
          <div className="detail-badges"><Badge>{p.planning.stage}</Badge><Badge>{p.planning.risk}</Badge></div>
          <div className="quantity-flow">{[['Ordered',p.quantity],['China',p.china],['Loaded',p.loaded],['India',p.india],['Delivered',p.delivered]].map(([label,value]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
          <div className="step-list">{timeline.map(([label,complete]) => <div className={complete ? 'done' : ''} key={label}><span>{complete ? '✓' : '○'}</span>{label}</div>)}</div>
          <div className="next-action-card"><span className="eyebrow">NEXT ACTION</span><h3>{p.nextAction}</h3><p>{p.owner} · Due {displayDate(p.deadline)}</p></div>
          <dl className="detail-grid">{[['Required delivery',displayDate(p.required)],['Latest production start',displayDate(p.planning.latestStart)],['Latest completion',displayDate(p.planning.latestComplete)],['Manufacturing / logistics',`${p.planning.manufacturing} / ${p.planning.logistics} days`],['Production status',p.production],['Expected completion',displayDate(p.expectedCompletion)],['Specifications',p.specs],['Dimensions',p.dimensions],['Order',p.order],['Shipment',p.shipment || 'Not allocated']].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}</dl>
          {p.issues.length > 0 && <div className="review-box"><strong>Imported data to review</strong>{p.issues.map(issue => <p key={issue}>{issue}</p>)}<small>Confirm the source evidence, record any missing updates, then resolve the review with a note.</small></div>}
        </>}
        {(tab === 'Update product' || tab === 'Record movement') && <form className="op-form" onSubmit={submit}>
          {tab === 'Update product' ? <><Field label="What happened?"><select value={actions.includes(action) ? action : 'Update follow-up'} onChange={e => {setAction(e.target.value);setSaved('');}}>{actions.map(value => <option key={value}>{value}</option>)}</select></Field>
            {action === 'Update follow-up' && <div className="form-grid"><Field label="Responsible person"><input name="owner" defaultValue={p.owner} required maxLength={100}/></Field><Field label="Next-action deadline"><input type="date" name="deadline" defaultValue={data?.today} required/></Field></div>}
            {action === 'Revise delivery date' && <Field label="Customer-confirmed required date"><input type="date" name="required" defaultValue={p.required} required/></Field>}
            {action === 'Reconcile imported balances' && <><div className="review-box">Use the verified opening balances from physical evidence. This correction is logged with before/after quantities. Resolve the data review separately after checking dates and status.</div><div className="form-grid">{(['china','loaded','india','delivered'] as const).map(key => <Field key={key} label={{china:'China received',loaded:'Container loaded',india:'India received',delivered:'Customer delivered'}[key]}><input type="number" name={key} min="0" max={p.quantity} step="1" defaultValue={p[key]} required/></Field>)}</div><Field label="Evidence document reference"><input name="document" required maxLength={200}/></Field></>}
            {!['Update follow-up','Revise delivery date','Resolve data review','Reconcile imported balances'].includes(action) && <Field label="Actual event date"><input type="date" name="date" defaultValue={data?.today} max={data?.today} required/></Field>}
          </> : <>
            <div className="info-banner"><ClipboardCheck size={18}/>This creates a draft. Quantities change after approval in the inbox.</div>
            <Field label="Movement"><select value={movement} onChange={e => {setMovement(e.target.value);setSaved('');}}>{['China receiving','Container loading','India receiving','Customer delivery'].map(value => <option key={value}>{value}</option>)}</select></Field>
            <div className="form-grid"><Field label={`Quantity (${p.unit})`}><input type="number" name="quantity" min="1" max={p.quantity} step="1" required defaultValue="1"/></Field><Field label="Carton reference (optional)"><input name="carton" maxLength={100} placeholder="CTN-…"/></Field></div>
            <Field label="Unique receipt / document reference"><input name="document" maxLength={200} required placeholder="e.g. CN-RECEIPT-20261024-01"/></Field>
            {movement === 'Container loading' && <div className="form-grid"><Field label="Shipment reference"><input name="shipment" defaultValue={p.shipment} required maxLength={100}/></Field><Field label="Container number"><input name="container" defaultValue={p.container} required maxLength={100}/></Field></div>}
          </>}
          <Field label="Your name"><input name="actor" required placeholder="Operator / reviewer name" maxLength={100}/></Field>
          <Field label={tab === 'Update product' && action === 'Update follow-up' ? 'Next action' : 'Evidence / update note'}><textarea name="notes" required maxLength={2000} rows={4} placeholder="What changed? Include the evidence or document reference."/></Field>
          {error && <div className="error-banner" role="alert">{error}</div>}{saved && <div className="success-banner" role="status">{saved}</div>}
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : tab === 'Record movement' ? 'Create movement draft' : 'Save product update'}</Button>
        </form>}
        {tab === 'History' && <div className="activity-timeline">{data?.activity.filter(a => a.productId === p.id).map(a => <article key={a.id}><span className="timeline-dot"/><strong>{a.action}{a.quantity ? ` · ${a.quantity} ${p.unit}` : ''}</strong><small>{displayDate(a.at)} · {a.actor} · {a.document || a.source}</small><p>{a.notes}</p></article>)}{!data?.activity.some(a => a.productId === p.id) && <p className="muted">No movement events yet. Initial status was imported from the workbook.</p>}</div>}
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
