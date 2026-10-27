import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Plus, X, RotateCcw, CheckCheck, Pencil } from 'lucide-react';
import { useWorkspace } from '@/components/workspace-provider';
import { useAuth } from '@/components/auth-provider';
import { Badge, Field, SectionHeader, Stat } from '@/components/operations-ui';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { ExceptionForm } from '@/components/exception-form';
import { ActorField, useRequestId } from '@/components/form-helpers';
import { displayDate, type ExceptionRow } from '@/services/workspace-api';

type Mode = 'new' | 'update' | 'resolve' | 'reopen';
function ExceptionDialog({ mode, row, close }: { mode: Mode; row?: ExceptionRow; close: () => void }) {
  const { data, mutate, busy } = useWorkspace(), dialog = useRef<HTMLDialogElement>(null), [requestId] = useRequestId(), [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try { await mutate(`/workspace/exceptions/${row!.Exception_ID}/${mode}`, { ...values, requestId }); close(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); }
  }
  const product = data?.products.find(p => p.id === row?.Product_ID);
  const title = { new: 'Raise an exception', update: 'Change owner or deadline', resolve: 'Resolve exception', reopen: 'Reopen exception' }[mode];
  return <dialog className="op-dialog" ref={dialog} onCancel={close} onClick={e => { if (e.target === e.currentTarget) close(); }}>
    <div className="dialog-heading"><div><span className="eyebrow">{row ? `${row.Problem_Type.toUpperCase()} · ${product?.name || row.Product_ID}` : 'EXCEPTION'}</span><h2>{title}</h2></div><Button variant="ghost" size="icon" onClick={close} aria-label="Close"><X size={20}/></Button></div>
    {mode === 'new' ? <div className="op-form"><ExceptionForm onDone={close}/></div> : <form className="op-form" onSubmit={submit}>
      {mode === 'update' && <div className="form-grid"><Field label="Responsible person"><input name="owner" required maxLength={100} defaultValue={row?.Responsible_Person}/></Field><Field label="Fix by"><input name="deadline" type="date" required defaultValue={row?.Deadline}/></Field></div>}
      {mode === 'resolve' && row?.Quarantine === 'yes' && <Field label={`What happens to the ${row.Quantity} quarantined units?`}><select name="disposition" required defaultValue=""><option value="" disabled>Choose…</option><option>Release to stock</option><option>Remove from stock</option></select></Field>}
      <Field label={mode === 'resolve' ? 'Correction and evidence' : mode === 'reopen' ? 'Why is it reopened?' : 'Note'}><textarea name={mode === 'update' ? 'notes' : 'notes'} required maxLength={1000} rows={3} placeholder={mode === 'resolve' ? 'What was done? Add the supplier reply, photo or document reference.' : ''}/></Field>
      <ActorField/>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <Button type="submit" disabled={busy}>{busy ? 'Saving…' : title}</Button>
    </form>}
  </dialog>;
}

export function Exceptions() {
  const { data, select } = useWorkspace(), { can } = useAuth();
  const [status, setStatus] = useState('Open'), [dialog, setDialog] = useState<{ mode: Mode; row?: ExceptionRow } | null>(null);
  if (!data) return null;
  const all = data.exceptions, open = all.filter(e => e.Status === 'Open'), overdue = open.filter(e => e.Deadline && e.Deadline < data.today);
  const rows = all.filter(e => status === 'All' || e.Status === status);
  const held = data.products.reduce((sum, p) => sum + p.quarantined, 0);
  return <>
    <div className="metric-grid"><Stat tone="orange" label="Open" value={open.length} note="Waiting for a correction"/><Stat tone="red" label="Overdue" value={overdue.length} note="Past the fix-by date"/><Stat tone="sky" label="Units in quarantine" value={held} note="Held back from loading"/><Stat tone="green" label="Resolved" value={all.length - open.length} note="Kept as a record"/></div>
    <section className="panel"><SectionHeader title="Exception register" description="Identify, give an owner and a deadline, correct, check the evidence, then close or reopen."><div className="inline-actions">{can('exception.raise') && <Button onClick={() => setDialog({ mode: 'new' })}><Plus size={15}/>Raise exception</Button>}</div></SectionHeader>
      <div className="sample-toolbar"><select aria-label="Filter status" value={status} onChange={e => setStatus(e.target.value)}>{['Open', 'Resolved', 'All'].map(v => <option key={v}>{v}</option>)}</select><span className="sample-count">{rows.length} exceptions</span></div>
      <DataTable rows={rows} rowKey={e => e.Exception_ID} emptyMessage="No exceptions here. Raise one when something goes wrong: damage, shortage, delay or a wrong item." columns={[
        { key: 'type', title: 'Problem', sort: e => e.Problem_Type, render: e => <div className="cell-stack"><strong>{e.Problem_Type}</strong><small>{e.Exception_ID}</small></div> },
        { key: 'product', title: 'Product', sort: e => e.Product_ID, render: e => { const p = data.products.find(p => p.id === e.Product_ID); return p ? <button className="product-name" onClick={() => select(p.id)}><strong>{p.name}</strong><small>{p.pi} · {p.customer}</small></button> : e.Product_ID; } },
        { key: 'description', title: 'Details', render: e => <div className="approval-notes"><p>{e.Description}</p>{e.Quarantine === 'yes' && <Badge tone="amber">{e.Quantity} in quarantine{e.Disposition ? ` · ${e.Disposition}` : ''}</Badge>}{e.Resolution_Notes && <small>Fix: {e.Resolution_Notes}</small>}</div> },
        { key: 'owner', title: 'Owner', sort: e => e.Responsible_Person, render: e => <div className="cell-stack"><span>{e.Responsible_Person}</span><small>Raised by {e.Raised_By}</small></div> },
        { key: 'deadline', title: 'Fix by', sort: e => e.Deadline, render: e => <div className="cell-stack"><span>{displayDate(e.Deadline)}</span>{e.Status === 'Open' && e.Deadline < data.today && <small className="late">Overdue</small>}{e.Status === 'Resolved' && <small>Resolved {displayDate(e.Resolved_Date)} · {e.Resolved_By}</small>}</div> },
        { key: 'status', title: 'Status', sort: e => e.Status, render: e => <Badge tone={e.Status === 'Open' ? (e.Deadline < data.today ? 'red' : 'amber') : 'green'}>{e.Status}</Badge> },
        { key: 'act', title: '', render: e => <div className="inline-actions">
          {e.Status === 'Open' && can('exception.update') && <Button variant="ghost" size="icon" title="Change owner or deadline" aria-label="Change owner or deadline" onClick={() => setDialog({ mode: 'update', row: e })}><Pencil size={15}/></Button>}
          {e.Status === 'Open' && can('exception.resolve') && <Button size="sm" onClick={() => setDialog({ mode: 'resolve', row: e })}><CheckCheck size={14}/>Resolve</Button>}
          {e.Status === 'Resolved' && can('exception.reopen') && <Button size="sm" variant="outline" onClick={() => setDialog({ mode: 'reopen', row: e })}><RotateCcw size={14}/>Reopen</Button>}
        </div> },
      ]}/></section>
    {dialog && <ExceptionDialog mode={dialog.mode} row={dialog.row} close={() => setDialog(null)}/>}
  </>;
}
