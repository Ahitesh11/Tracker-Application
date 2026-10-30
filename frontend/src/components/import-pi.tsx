import { useEffect, useRef, useState, type FormEvent } from 'react';
import { FileUp, Trash2, X } from 'lucide-react';
import { useWorkspace } from '@/components/workspace-provider';
import { Field } from '@/components/operations-ui';
import { Button } from '@/components/ui/button';
import { ActorField, useRequestId } from '@/components/form-helpers';
import { useI18n } from '@/lib/i18n';
import { cropPictures, guessCategory, parsePiPages, readImages, readPdf, renderPdfPages, type PiResult } from '@/lib/pi-parser';
import { request } from '@/services/workspace-api';

interface Line { key: number; vendor: string; name: string; dimensions: string; specs: string; quantity: number; unit: string; lead: string; photo: string }
const cell = 'w-full min-w-0 rounded-md border border-[var(--border)] bg-white px-2 py-1 text-sm';

/** Upload a PI PDF: every product row in it becomes an editable line, then all lines are created in one go. */
export function ImportPi({ close }: { close: () => void }) {
  const { data, mutate, busy } = useWorkspace(), { t } = useI18n(), dialog = useRef<HTMLDialogElement>(null);
  const [lines, setLines] = useState<Line[]>([]), [customer, setCustomer] = useState(''), [reading, setReading] = useState(false), [fileName, setFileName] = useState('');
  const [error, setError] = useState(''), [requestId] = useRequestId(), [uploading, setUploading] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const leads = data?.leads || [], fallbackLead = leads.find(l => l.category === 'Furniture' && l.subcategory === 'Default') || leads[0], fallback = fallbackLead ? `${fallbackLead.category}|${fallbackLead.subcategory}` : '';

  /** A text PDF is read right in the browser. Photos and scanned PDFs are read by the AI (OpenAI key needed). */
  async function pick(files: File[]) {
    if (!files.length) return;
    if (files.filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)).length > 1) { setError('Choose either one PDF or photos, not both.'); return; } setError(''); setLines([]); setFileName(files.length > 1 ? `${files.length} files` : files[0].name); setReading(true);
    try {
      const pdf = files.find(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)), photos = files.filter(f => f !== pdf);
      if (pdf && photos.length) throw new Error('Choose either one PDF or photos, not both.');
      let result: PiResult | undefined, source: { pdf: File } | { images: string[] } | undefined;
      if (pdf) { result = parsePiPages(await readPdf(pdf)); source = { pdf }; if (!result.rows.length) { const images = await renderPdfPages(pdf); result = await request<PiResult>('/assistant/extract-pi', { images }); source = { images }; } }
      else { if (photos.length > 6) throw new Error('Send 1 to 6 images (JPG, PNG or WebP).'); const images = await readImages(photos); result = await request<PiResult>('/assistant/extract-pi', { images }); source = { images }; }
      if (!result.rows.length) throw new Error('No product rows were found in this file. Check that the Description and Qty columns are visible.');
      if (result.customer) setCustomer(c => c || result.customer);
      const pictures = await cropPictures(result.rows, source); // the product photos printed in the PI
      setLines(result.rows.map((r, i) => ({ key: i, photo: pictures[i], vendor: r.vendor, name: [r.description, r.code || (r.description && r.material)].filter(Boolean).join(' ').slice(0, 200), dimensions: r.size.slice(0, 200), specs: [r.material, r.colour, r.remark].filter(Boolean).join(', ').slice(0, 200), quantity: r.quantity, unit: r.unit || 'pcs', lead: guessCategory(r.description, leads, fallback) })));
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to read this file.'); } finally { setReading(false); }
  }
  const edit = (key: number, patch: Partial<Line>) => setLines(list => list.map(l => l.key === key ? { ...l, ...patch } : l));
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('');
    const values = Object.fromEntries(new FormData(e.currentTarget));
    const missing = [['pi', 'Final PI number'], ['order', 'Order reference'], ['required', 'Required customer delivery']].find(([key]) => !String(values[key] || '').trim());
    if (missing) { setError(`${t('Fill in')} “${t(missing[1])}” ${t('at the top of this window.')}`); dialog.current?.querySelector<HTMLElement>('.form-grid')?.scrollIntoView({ block: 'center' }); return; }
    if (!customer.trim()) { setError(`${t('Fill in')} “${t('Customer name')}” ${t('at the top of this window.')}`); return; }
    const badQty = lines.findIndex(l => !Number.isSafeInteger(l.quantity) || l.quantity < 1 || l.quantity > 1000000);
    if (badQty >= 0) { setError(t('Row {n}: quantity must be a positive whole number.', { n: badQty + 1 })); return; }
    const bad = lines.findIndex(l => !l.name.trim() || !l.vendor.trim());
    if (bad >= 0) { setError(t('Row {n}: product name and vendor cannot be empty.', { n: bad + 1 })); return; }
    try {
      setUploading(true);
      // each distinct photo is uploaded once (rows that share a merged photo cell share the upload), a few at a time
      const uploads = new Map<string, string>(), queue = [...new Set(lines.map(l => l.photo).filter(Boolean))];
      await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
        for (let image = queue.shift(); image; image = queue.shift()) uploads.set(image, (await request<{ path: string }>('/evidence', { kind: 'product', image }).catch(() => { throw new Error(t('A product photo could not be uploaded. Remove the photo or try again.')); })).path);
      }));
      const paths = lines.map(l => l.photo && uploads.has(l.photo) ? [uploads.get(l.photo)!] : []);
      setUploading(false);
      await mutate('/workspace/products/bulk', { ...values, customer, requestId, rows: lines.map((l, i) => { const [category, subcategory] = l.lead.split('|'); return { vendor: l.vendor, name: l.name, dimensions: l.dimensions, specs: l.specs, quantity: l.quantity, unit: l.unit, category, subcategory, photos: paths[i] }; }) }); close();
    } catch (e) { setUploading(false); setError(e instanceof Error ? e.message : t('Unable to create product.')); }
  }
  return <dialog className="op-dialog" style={{ width: 'min(1180px, 96vw)', maxWidth: '96vw' }} ref={dialog} onCancel={close} onClick={e => { if (e.target === e.currentTarget) close(); }}>
    <div className="dialog-heading"><div><span className="eyebrow">{t('IMPORT PI')}</span><h2>{t('Create product lines from a PI')}</h2></div><Button variant="ghost" size="icon" onClick={close} aria-label={t('Close import')}><X size={20}/></Button></div>
    <form className="op-form" onSubmit={submit} noValidate>
      <Field label={t('PI file (PDF or photos)')}><input type="file" multiple accept="application/pdf,.pdf,image/jpeg,image/png,image/webp" onChange={e => pick([...(e.target.files || [])])}/></Field><p className="muted">{t('A text PDF is read instantly. Photos and scanned PDFs are read by AI and need the OpenAI key.')}</p>
      {reading && <p className="muted">{t('Reading the file…')}</p>}
      {lines.length > 0 && <>
        <p className="muted">{t('{n} rows found in {file}. Check every row, fix anything that is wrong, and remove rows you do not need.', { n: lines.length, file: fileName })}</p>
        <div className="form-grid">
          <Field label={t('Final PI number')}><input name="pi" required maxLength={200}/></Field>
          <Field label={t('Order reference')}><input name="order" required maxLength={200}/></Field>
          <Field label={t('Customer name')}><input value={customer} onChange={e => setCustomer(e.target.value)} required maxLength={200}/></Field>
          <Field label={t('Required customer delivery')}><input name="required" type="date" required/></Field>
        </div>
        <div style={{ overflowX: 'auto' }}><table className="data-table"><thead><tr>{['#', 'Photo', 'Vendor', 'Product name', 'Dimensions', 'Specifications', 'Qty', 'Unit', 'Category', ''].map((h, i) => <th key={i}>{t(h)}</th>)}</tr></thead>
          <tbody>{lines.map((l, i) => <tr key={l.key}>
            <td>{i + 1}</td>
            <td>{l.photo ? <span className="photo-thumb"><img src={l.photo} alt={t('Product photo')}/><button type="button" aria-label={t('Remove photo')} onClick={() => edit(l.key, { photo: '' })}><X size={12}/></button></span> : <span className="muted">—</span>}</td>
            <td><input className={cell} value={l.vendor} onChange={e => edit(l.key, { vendor: e.target.value })} required maxLength={200} style={{ minWidth: 110 }}/></td>
            <td><input className={cell} value={l.name} onChange={e => edit(l.key, { name: e.target.value })} required maxLength={200} style={{ minWidth: 240 }}/></td>
            <td><input className={cell} value={l.dimensions} onChange={e => edit(l.key, { dimensions: e.target.value })} maxLength={200} style={{ minWidth: 200 }}/></td>
            <td><input className={cell} value={l.specs} onChange={e => edit(l.key, { specs: e.target.value })} maxLength={200} style={{ minWidth: 230 }}/></td>
            <td><input className={cell} type="number" min="1" max="1000000" step="1" value={l.quantity} onChange={e => edit(l.key, { quantity: Number(e.target.value) })} required style={{ width: 70, ...(l.quantity >= 1 && l.quantity <= 1000000 ? {} : { borderColor: '#ef4444', background: '#ffe6e6' }) }}/></td>
            <td><input className={cell} value={l.unit} onChange={e => edit(l.key, { unit: e.target.value })} required maxLength={20} style={{ width: 70 }}/></td>
            <td><select className={cell} value={l.lead} onChange={e => edit(l.key, { lead: e.target.value })}>{leads.map(x => <option key={x.category + x.subcategory} value={`${x.category}|${x.subcategory}`}>{t(x.category)} / {t(x.subcategory)}</option>)}</select></td>
            <td><Button type="button" variant="ghost" size="icon" aria-label={t('Remove row')} onClick={() => setLines(list => list.filter(x => x.key !== l.key))}><Trash2 size={15}/></Button></td>
          </tr>)}</tbody></table></div>
        <ActorField/>
      </>}
      {error && <div className="error-banner" role="alert">{t(error)}</div>}
      <Button type="submit" disabled={busy || uploading || reading || !lines.length}><FileUp size={15}/>{busy || uploading ? t('Saving…') : t('Create {n} product lines', { n: lines.length })}</Button>
    </form>
  </dialog>;
}
