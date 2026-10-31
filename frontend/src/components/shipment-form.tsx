import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { useWorkspace } from '@/components/workspace-provider';
import { Field } from '@/components/operations-ui';
import { Button } from '@/components/ui/button';
import { ActorField, useRequestId } from '@/components/form-helpers';
import { useI18n } from '@/lib/i18n';
import { LoadingListTable, loadingListAccept, loadingListHint, useLoadingList } from '@/components/loading-list-import';
import { request, type WorkspaceData } from '@/services/workspace-api';

/** Create a shipment or update an existing one (status, dispatch, expected and actual arrival). */
export function ShipmentForm({ shipment, close }: { shipment?: Record<string, string>; close: () => void }) {
  const { data, mutate, busy, refresh } = useWorkspace(), { t } = useI18n(), dialog = useRef<HTMLDialogElement>(null), [requestId] = useRequestId(), [error, setError] = useState(''), list = useLoadingList();
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const values = Object.fromEntries(new FormData(event.currentTarget));
    if (list.lines.length && !String(values.container || '').trim()) { setError(t('Enter the container number for the loading list.')); return; }
    const id = String(shipment?.Shipment_ID || values.id);
    let saved: WorkspaceData | undefined;
    try { saved = await mutate('/workspace/shipments', { ...values, id, requestId }); } catch (e) { setError(e instanceof Error ? e.message : t('Could not save the shipment.')); return; }
    if (!list.lines.length) { close(); return; }
    // The shipment exists now: the loading list is saved against it and waits for the controller.
    try { await request<WorkspaceData>('/workspace/loading-lists', { actor: values.actor, shipment: id, container: values.container, requestId: `${requestId}-list`, revision: saved?.revision, ...list.payload() }); await refresh(); close(); }
    catch (e) { await refresh(); setError(`${t('The shipment was saved, but its loading list was not:')} ${e instanceof Error ? e.message : ''}`); }
  }
  const linked = shipment ? data?.products.filter(p => p.shipment === shipment.Shipment_ID) : [];
  return <dialog className="op-dialog" style={list.result ? { width: 'min(1180px, 96vw)', maxWidth: '96vw' } : undefined} ref={dialog} onCancel={close} onClick={e => { if (e.target === e.currentTarget) close(); }}>
    <div className="dialog-heading"><div><span className="eyebrow">{shipment ? t('UPDATE SHIPMENT') : t('NEW SHIPMENT')}</span><h2>{shipment ? shipment.Shipment_ID : t('Record a shipment')}</h2></div><Button variant="ghost" size="icon" onClick={close} aria-label={t('Close shipment form')}><X size={20}/></Button></div>
    <form className="op-form" onSubmit={submit}>
      <Field label={t('Container loading list (optional): Excel, CSV, PDF or photos')}><input type="file" multiple accept={loadingListAccept} onChange={e => list.pick([...(e.target.files || [])])}/></Field>
      <p className="muted">{t(loadingListHint)}</p>
      {list.reading && <p className="muted">{t('Reading the file…')}</p>}
      {list.result && <Field label={t('Container number')}><input name="container" maxLength={100} defaultValue={list.result.container || ''} placeholder="e.g. MSKU1234567"/></Field>}
      {list.error && <div className="error-banner" role="alert">{t(list.error)}</div>}
      <div className="form-grid">
        <Field label={t('Shipment reference')}><input name="id" required maxLength={100} defaultValue={shipment?.Shipment_ID} readOnly={Boolean(shipment)} placeholder="e.g. SHP-2026-014"/></Field>
        <Field label={t('Carrier')}><input name="carrier" required maxLength={200} defaultValue={shipment?.Carrier}/></Field>
        <Field label={t('Tracking / booking reference')}><input name="tracking" maxLength={200} defaultValue={shipment?.Tracking_Ref}/></Field>
        <Field label={t('Status')}><select name="status" defaultValue={shipment?.Status || 'Planned'}>{['Planned', 'In Transit', 'Arrived'].map(v => <option key={v} value={v}>{t(v)}</option>)}</select></Field>
        <Field label={t('Actual dispatch from China')}><input name="actualDispatch" type="date" max={data?.today} defaultValue={shipment?.Actual_Dispatch_Date}/></Field>
        <Field label={t('Expected arrival in India')}><input name="expectedArrival" type="date" defaultValue={shipment?.Expected_Arrival_India}/></Field>
        <Field label={t('Actual arrival in India')}><input name="actualArrival" type="date" max={data?.today} defaultValue={shipment?.Actual_Arrival_India}/></Field>
      </div>
      {linked && linked.length > 0 && <div className="info-banner">{t('Carries:')} {linked.map(p => `${p.name} (${p.loaded})`).join(', ')}</div>}
      {list.result && <LoadingListTable list={list}/>}
      <Field label={t('Update note')}><textarea name="notes" required maxLength={2000} rows={3} placeholder={t('What changed? Include the document or tracking evidence.')}/></Field>
      <ActorField/>
      {error && <div className="error-banner" role="alert">{t(error)}</div>}
      <Button type="submit" disabled={busy}>{busy ? t('Saving…') : list.lines.length ? t('Save shipment and send loading list for approval') : shipment ? t('Save shipment update') : t('Create shipment')}</Button>
    </form>
  </dialog>;
}
