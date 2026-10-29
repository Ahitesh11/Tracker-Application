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
export function AuditReport() {
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
