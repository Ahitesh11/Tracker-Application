import { useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { useWorkspace } from '@/components/workspace-provider';
import { Badge, SectionHeader, Stat } from '@/components/operations-ui';
import { Button } from '@/components/ui/button';
import { PhotoList } from '@/components/form-helpers';
import { useI18n } from '@/lib/i18n';
import { displayDate } from '@/services/workspace-api';

const tone: Record<string, string> = { Match: 'green', 'Needs review': 'amber', Mismatch: 'red', Unavailable: 'amber' };
/** CSV cell; a leading = + - @ is neutralised so a spreadsheet never runs typed text as a formula. */
const csvCell = (value: unknown) => { const text = String(value ?? ''), safe = /^[=+\-@]/.test(text) ? `'${text}` : text; return `"${safe.replace(/"/g, '""')}"`; };

/** India receiving audit report: loading photos (China) against receiving photos (India), with the AI verdict and the reviewer decision. */
function ReceivingAudit() {
  const { data } = useWorkspace(), { t } = useI18n(), [verdict, setVerdict] = useState('All');
  if (!data) return null;
  const all = data.drafts.filter(d => d.type === 'India receiving');
  const rows = all.map(d => {
    const p = data.products.find(p => p.id === d.productId);
    const loading = data.activity.filter(a => a.productId === d.productId && a.action === 'Container loading' && a.photos?.length && (!d.shipment || a.shipment === d.shipment)).flatMap(a => a.photos || []).slice(0, 4);
    return { d, p, loading, status: d.audit?.status || 'Not audited' };
  }).filter(r => verdict === 'All' || r.status === verdict);
  const count = (...statuses: string[]) => all.filter(d => statuses.includes(d.audit?.status || 'Not audited')).length;
  function download() {
    const head = ['Date', 'Draft', 'Product', 'PI', 'Customer', 'Shipment', 'Container', 'Document', 'Quantity', 'Expected', 'Shortfall', 'AI verdict', 'AI summary', 'Findings', 'Draft status', 'Reviewed by', 'Loading photos', 'Receiving photos'];
    const lines = rows.map(({ d, p, loading, status }) => [d.createdAt.slice(0, 10), d.id, p?.name, p?.pi, p?.customer, d.shipment, p?.container, d.document, d.quantity, d.audit?.expectedQuantity, d.audit?.shortfall, status, d.audit?.summary, d.audit?.findings.join(' | '), d.status, d.reviewedBy, loading.length, d.photos?.length || 0].map(csvCell).join(','));
    const url = URL.createObjectURL(new Blob(['﻿' + [head.map(csvCell).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `india-receiving-audit-${data!.today}.csv`; link.click(); URL.revokeObjectURL(url);
  }
  return <><div className="metric-grid"><Stat tone="green" label="Match" value={count('Match')} note="Photos agree with the loading record"/><Stat tone="red" label="Mismatch" value={count('Mismatch')} note="Check before approving"/><Stat tone="orange" label="Needs review" value={count('Needs review')} note="Photos unclear or incomplete"/><Stat tone="sky" label="Not audited" value={count('Not audited', 'Unavailable')} note="Run the AI audit in the Approval Inbox"/></div>
    <section className="panel audit-report"><SectionHeader title="India receiving audit report" description="Loaded in China versus received in India, checked by AI. The reviewer decides."/>
      <div className="sample-toolbar no-print"><select value={verdict} onChange={e => setVerdict(e.target.value)} aria-label={t('AI verdict filter')}>{['All', 'Match', 'Mismatch', 'Needs review', 'Unavailable', 'Not audited'].map(v => <option key={v} value={v}>{t(v)}</option>)}</select><span className="sample-count">{t('{n} drafts', { n: rows.length })}</span><Button variant="outline" onClick={download} disabled={!rows.length}><Download size={14}/>{t('Download CSV')}</Button><Button variant="outline" onClick={() => window.print()}><Printer size={14}/>{t('Print report')}</Button></div>
      {rows.length === 0 ? <p className="muted" style={{ padding: '0 24px 24px' }}>{t('No India receiving drafts match this filter.')}</p> : <div className="audit-cards">{rows.map(({ d, p, loading, status }) => <article key={d.id} className="audit-card">
        <header><div><strong>{p?.name || d.productId}</strong><small>{p ? `${p.pi} · ${p.customer} · ` : ''}{d.shipment || p?.shipment || '—'} · {d.document}</small></div><div className="inline-actions"><Badge tone={tone[status]}>{status}</Badge><Badge>{d.status}</Badge></div></header>
        <p><strong>{d.quantity} {t('pcs')}</strong> · {displayDate(d.createdAt)} · {d.createdBy || '—'}{d.reviewedBy ? ` · ${t('Reviewed by')} ${d.reviewedBy}` : ''}</p>
        <div className="audit-photos"><div><small>{t('Loaded in China')}</small>{loading.length ? <PhotoList paths={loading}/> : <p className="muted">{t('No loading photos')}</p>}</div><div><small>{t('Received in India')}</small><PhotoList paths={d.photos}/></div></div>
        {d.audit ? <div className="audit-box" data-status={d.audit.status}><p>{d.audit.summary}</p><small>{t('Loaded photos show {a} · received photos show {b} · expected {c}', { a: d.audit.loadedSeen ?? '?', b: d.audit.receivedSeen ?? '?', c: d.audit.expectedQuantity })}{d.audit.shortfall > 0 ? ` · ${t('Missing after this receipt')}: ${d.audit.shortfall}` : ''}</small>{d.audit.findings.length > 0 && <ul>{d.audit.findings.map(f => <li key={f}>{f}</li>)}</ul>}<small>{d.audit.model || '—'} · {displayDate(d.audit.at)}</small></div> : <p className="muted">{t('Not audited yet. Run the AI audit in the Approval Inbox.')}</p>}
      </article>)}</div>}
    </section></>;
}

/** Loading list audit: what the AI read, every correction, who approved, and PI quantity against loaded and received. */
function LoadingAudit() {
  const { data } = useWorkspace(), { t } = useI18n(), [status, setStatus] = useState('All');
  if (!data || !data.loadingLists.length) return null;
  const lists = data.loadingLists.filter(l => status === 'All' || l.status === status);
  const rows = lists.flatMap(l => l.lines.map(line => ({ l, line, p: data.products.find(p => p.id === line.productId) })));
  function download() {
    const head = ['Date', 'Loading list', 'Shipment', 'Container', 'File', 'List status', 'Created by', 'Decided by', 'Code', 'Product', 'PI', 'Listed', 'Ordered', 'Loaded', 'India received', 'Line status', 'Note'];
    const lines = rows.map(({ l, line, p }) => [l.createdAt.slice(0, 10), l.id, l.shipment, l.container, l.fileName, l.status, l.createdBy, l.decidedBy, line.code, p?.name, p?.pi || line.pi, line.quantity, p?.quantity, p?.loaded, p?.india, line.status, line.note].map(csvCell).join(','));
    const url = URL.createObjectURL(new Blob(['﻿' + [head.map(csvCell).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `loading-list-audit-${data!.today}.csv`; link.click(); URL.revokeObjectURL(url);
  }
  const count = (s: string) => data.loadingLists.filter(l => l.status === s).length;
  return <section className="panel audit-report"><SectionHeader title="Loading list audit" description="AI reading, manual corrections and controller approval of every container loading list, with PI, loaded and received quantities."/>
    <div className="sample-toolbar no-print"><select value={status} onChange={e => setStatus(e.target.value)} aria-label={t('Loading list status filter')}>{['All', 'Pending approval', 'Approved', 'Rejected'].map(v => <option key={v} value={v}>{t(v)}</option>)}</select><span className="sample-count">{t('{a} pending · {b} approved · {c} rejected', { a: count('Pending approval'), b: count('Approved'), c: count('Rejected') })}</span><Button variant="outline" onClick={download} disabled={!rows.length}><Download size={14}/>{t('Download CSV')}</Button></div>
    <div className="audit-cards">{lists.map(l => <article key={l.id} className="audit-card">
      <header><div><strong>{l.id} · {l.shipment} / {l.container}</strong><small>{l.fileName} · {l.createdBy} · {displayDate(l.createdAt)}{l.decidedBy ? ` · ${l.decidedBy}` : ''}</small></div><Badge tone={l.status === 'Approved' ? 'green' : l.status === 'Rejected' ? 'red' : 'amber'}>{l.status}</Badge></header>
      <div style={{ overflowX: 'auto' }}><table className="data-table"><thead><tr>{['Product', 'PI', 'Listed', 'Ordered', 'Loaded', 'India received', 'Status'].map(h => <th key={h}>{t(h)}</th>)}</tr></thead><tbody>{l.lines.map(line => { const p = data.products.find(x => x.id === line.productId); return <tr key={line.id}><td>{p?.name || line.code || line.description}</td><td>{p?.pi || line.pi || '—'}</td><td>{line.quantity}</td><td>{p?.quantity ?? '—'}</td><td>{p?.loaded ?? '—'}</td><td>{p?.india ?? '—'}</td><td><Badge tone={line.status === 'Matched' ? 'green' : 'red'}>{line.status}</Badge>{line.note && <small> {line.note}</small>}</td></tr>; })}</tbody></table></div>
      <details open={l.status !== 'Approved'}><summary>{t('Audit trail')} ({l.trail.length})</summary><ul>{l.trail.map((e, i) => <li key={i}><strong>{t(e.event)}</strong> · {e.actor} · {displayDate(e.at)}<br/><small>{e.detail}</small></li>)}</ul></details>
    </article>)}</div>
  </section>;
}
export function AuditReport() { return <><ReceivingAudit/><LoadingAudit/></>; }
