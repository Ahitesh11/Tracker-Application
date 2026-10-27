import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { useWorkspace } from '@/components/workspace-provider';
import { Field } from '@/components/operations-ui';
import { Button } from '@/components/ui/button';
import { ActorField, useRequestId } from '@/components/form-helpers';

/** Create a shipment or update an existing one (status, dispatch, expected and actual arrival). */
export function ShipmentForm({ shipment, close }: { shipment?: Record<string, string>; close: () => void }) {
  const { data, mutate, busy } = useWorkspace(), dialog = useRef<HTMLDialogElement>(null), [requestId] = useRequestId(), [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try { await mutate('/workspace/shipments', { ...values, id: shipment?.Shipment_ID || values.id, requestId }); close(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save the shipment.'); }
  }
  const linked = shipment ? data?.products.filter(p => p.shipment === shipment.Shipment_ID) : [];
  return <dialog className="op-dialog" ref={dialog} onCancel={close} onClick={e => { if (e.target === e.currentTarget) close(); }}>
    <div className="dialog-heading"><div><span className="eyebrow">{shipment ? 'UPDATE SHIPMENT' : 'NEW SHIPMENT'}</span><h2>{shipment ? shipment.Shipment_ID : 'Record a shipment'}</h2></div><Button variant="ghost" size="icon" onClick={close} aria-label="Close shipment form"><X size={20}/></Button></div>
    <form className="op-form" onSubmit={submit}>
      <div className="form-grid">
        <Field label="Shipment reference"><input name="id" required maxLength={100} defaultValue={shipment?.Shipment_ID} readOnly={Boolean(shipment)} placeholder="e.g. SHP-2026-014"/></Field>
        <Field label="Carrier"><input name="carrier" required maxLength={200} defaultValue={shipment?.Carrier}/></Field>
        <Field label="Tracking / booking reference"><input name="tracking" maxLength={200} defaultValue={shipment?.Tracking_Ref}/></Field>
        <Field label="Status"><select name="status" defaultValue={shipment?.Status || 'Planned'}>{['Planned', 'In Transit', 'Arrived'].map(v => <option key={v}>{v}</option>)}</select></Field>
        <Field label="Actual dispatch from China"><input name="actualDispatch" type="date" max={data?.today} defaultValue={shipment?.Actual_Dispatch_Date}/></Field>
        <Field label="Expected arrival in India"><input name="expectedArrival" type="date" defaultValue={shipment?.Expected_Arrival_India}/></Field>
        <Field label="Actual arrival in India"><input name="actualArrival" type="date" max={data?.today} defaultValue={shipment?.Actual_Arrival_India}/></Field>
      </div>
      {linked && linked.length > 0 && <div className="info-banner">Carries: {linked.map(p => `${p.name} (${p.loaded})`).join(', ')}</div>}
      <Field label="Update note"><textarea name="notes" required maxLength={2000} rows={3} placeholder="What changed? Include the document or tracking evidence."/></Field>
      <ActorField/>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <Button type="submit" disabled={busy}>{busy ? 'Saving…' : shipment ? 'Save shipment update' : 'Create shipment'}</Button>
    </form>
  </dialog>;
}
