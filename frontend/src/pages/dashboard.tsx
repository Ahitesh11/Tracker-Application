import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Package, TriangleAlert, Clock, FileSearch, Ship, ListChecks, ShieldAlert, ClipboardCheck, ScanSearch, Sparkles, Boxes } from 'lucide-react';
import { useWorkspace } from '@/components/workspace-provider';
import { Badge, Stat, SectionHeader, Journey } from '@/components/operations-ui';
import { EmptyState } from '@/components/empty-state';
import { dateLocale, useI18n } from '@/lib/i18n';
import { displayDate, type Draft } from '@/services/workspace-api';
import { stageColors } from '@/pages/workspace';

const severityIcon = { Critical: TriangleAlert, Warning: Clock, Review: FileSearch } as const;
const days = (from: string, to: string) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
const auditTone: Record<string, string> = { Match: 'green', Mismatch: 'red', 'Needs review': 'amber', Unavailable: 'amber' };
const n = (value: number) => value.toLocaleString('en-IN');
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

/** The landing screen: what is late, where the units are, what is moving, and what the AI flagged on arrival. */
export function Dashboard() {
  const { data, select } = useWorkspace(), { t } = useI18n();
  if (!data) return null;
  const { products, alerts, drafts, shipments, exceptions, today } = data;
  const open = products.filter(p => p.planning.stage !== 'Delivered' && p.planning.stage !== 'Closed');
  const overdue = open.filter(p => p.planning.risk === 'Overdue'), atRisk = open.filter(p => p.planning.risk === 'At risk');
  const sum = (pick: (p: (typeof products)[number]) => number) => products.reduce((s, p) => s + pick(p), 0);
  const ordered = sum(p => p.quantity), notInChina = sum(p => p.quantity - p.china), quarantined = sum(p => p.quarantined);
  const inChina = sum(p => p.china - p.loaded), inTransit = sum(p => p.loaded - p.india), inIndia = sum(p => p.india - p.delivered), delivered = sum(p => p.delivered);
  const pending = drafts.filter(d => d.status === 'Pending'), receiving = pending.filter(d => d.type === 'India receiving');
  const flagged = receiving.filter(d => d.audit?.status === 'Mismatch' || d.audit?.status === 'Needs review');
  const openExceptions = exceptions.filter(e => e.Status === 'Open');
  const critical = alerts.filter(a => a.severity === 'Critical').length;
  const where: [string, number, string, string][] = [
    ['Still with vendors', notInChina, '#f97316', '/callout'], ['China warehouse', inChina, '#10b981', '/china-warehouse'], ['In transit', inTransit, '#0ea5e9', '/shipments'],
    ['India warehouse', inIndia, '#0d9488', '/india-receiving'], ['Delivered', delivered, '#16a34a', '/delivery'],
  ];
  const waitingCallout = sum(p => p.calledOut - p.china), waitingDelivery = inIndia;
  const stuck: [string, number, string][] = ([['{n} units called out but not yet received in China', waitingCallout, '/china-warehouse'], ['{n} units in the China warehouse waiting for a container', inChina, '/shipments'], ['{n} units in transit, not yet received in India', inTransit, '/india-receiving'], ['{n} units in India waiting for customer delivery', waitingDelivery, '/delivery']] as [string, number, string][]).filter(r => r[1] > 0);
  const pipeline = Object.keys(stageColors);
  const activeShipments = shipments.filter(s => s.Status !== 'Arrived').sort((a, b) => (a.Expected_Arrival_India || '9').localeCompare(b.Expected_Arrival_India || '9')).slice(0, 5);
  const vendors = Object.values(open.reduce<Record<string, { name: string; lines: number; qty: number; done: number; late: number }>>((acc, p) => {
    const v = (acc[p.vendor] ||= { name: p.vendor, lines: 0, qty: 0, done: 0, late: 0 });
    v.lines++; v.qty += p.quantity; v.done += p.china; if (p.planning.risk === 'Overdue') v.late++;
    return acc;
  }, {})).sort((a, b) => b.late - a.late || b.qty - a.qty).slice(0, 6);
  const upcoming = [...open].sort((a, b) => a.required.localeCompare(b.required)).slice(0, 4);
  const funnel: [string, number][] = [['Ordered', ordered], ['Called out', sum(p => p.calledOut)], ['Received in China', sum(p => p.china)], ['Loaded in container', sum(p => p.loaded)], ['Received in India', sum(p => p.india)], ['Delivered', delivered]];
  const monthName = new Intl.DateTimeFormat(dateLocale(), { month: 'short', year: '2-digit', timeZone: 'UTC' });
  const due = open.reduce<Record<string, number>>((acc, p) => { const left = p.quantity - p.delivered, key = p.required < today ? 'late' : p.required.slice(0, 7); acc[key] = (acc[key] || 0) + left; return acc; }, {});
  const months = Object.keys(due).sort((a, b) => (a === 'late' ? -1 : b === 'late' ? 1 : a.localeCompare(b))).slice(0, 7), peak = Math.max(1, ...months.map(m => due[m]));
  const needAction = overdue.length + atRisk.length, onTrack = open.filter(p => p.planning.risk === 'On track'), pendingLists = data.loadingLists.filter(l => l.status === 'Pending approval');
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date())) % 24, greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return <>
    <section className="dash-hero">
      <div className="dash-hero-main">
        <span className="hero-tag"><span/>{t('LIVE OVERVIEW')} · {displayDate(today)}</span>
        <h2>{t(greeting)}</h2>
        <p>{needAction ? t('{a} product lines are overdue or at risk. {b} units are on the water.', { a: needAction, b: n(inTransit) }) : t('Nothing is overdue. {b} units are on the water.', { b: n(inTransit) })}</p>
        <div className="dash-actions"><Link to="/fms" className="hero-button">{t('View today’s actions')} <ArrowRight size={16}/></Link><Link to="/audit-report" className="dash-ghost"><ScanSearch size={15}/>{t('Audit Report')}</Link><Link to="/ai-assistant" className="dash-ghost"><Sparkles size={15}/>{t('Ask your assistant')}</Link></div>
      </div>
      <div className="hero-stats">
        <div className="ring" role="img" aria-label={t('{a}% of units delivered', { a: pct(delivered, ordered) })}><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="50" className="ring-bg"/><circle cx="60" cy="60" r="50" className="ring-fg" strokeDasharray={`${(pct(delivered, ordered) / 100) * 314} 314`}/></svg><div><strong>{pct(delivered, ordered)}%</strong><small>{t('delivered')}</small></div></div>
        <ul className="health-list">{([['On track', onTrack.length, '#bbf7d0'], ['At risk', atRisk.length, '#fde68a'], ['Overdue', overdue.length, '#fecaca']] as [string, number, string][]).map(([label, count, color]) => <li key={label}><i style={{ background: color }}/><strong>{count}</strong><span>{t(label)}</span></li>)}</ul>
      </div>
    </section>
    {pendingLists.length > 0 && <Link className="dash-banner" to="/shipments"><ClipboardCheck size={18}/><span>{t('{n} loading lists are waiting for controller approval.', { n: pendingLists.length })}</span><b>{t('Review now')} <ArrowRight size={14}/></b></Link>}

    <div className="kpi-grid">
      <Link className="stat-link" to="/orders"><Stat label="Open product lines" value={n(open.length)} note={t('{a} PIs · {b} customers',{a:new Set(products.map(p=>p.pi)).size,b:new Set(products.map(p=>p.customer)).size})} icon={<Package size={18}/>}/></Link>
      <Link className="stat-link" to="/fms"><Stat tone="red" label="Overdue deliveries" value={overdue.length} note={t('{n} critical alerts',{n:critical})} icon={<TriangleAlert size={18}/>}/></Link>
      <Link className="stat-link" to="/fms"><Stat tone="amber" label="At risk" value={atRisk.length} note="Will miss the date without action" icon={<Clock size={18}/>}/></Link>
      <Link className="stat-link" to="/shipments"><Stat tone="sky" label="Units in transit" value={n(inTransit)} note={t('{n} active shipments',{n:activeShipments.length})} icon={<Ship size={18}/>}/></Link>
      <Link className="stat-link" to="/approvals"><Stat tone="orange" label="Awaiting review" value={pending.length} note={t('{n} India receipts to audit',{n:receiving.length})} icon={<ListChecks size={18}/>}/></Link>
      <Link className="stat-link" to="/exceptions"><Stat tone={openExceptions.length ? 'pink' : 'green'} label="Open exceptions" value={openExceptions.length} note={quarantined ? t('{n} units in quarantine',{n:quarantined}) : 'Damage, shortage and delays'} icon={<ShieldAlert size={18}/>}/></Link>
    </div>

    <div className="operations-grid">
      <section className="panel"><SectionHeader title="Where your units are" description="All ordered units, by where they physically are now."/>
        {ordered > 0 ? <>
          <div className="stack-bar" role="img" aria-label={t('Units by location')}>{where.map(([label, value, color]) => value > 0 && <i key={label} title={`${t(label)}: ${n(value)}`} style={{ flexGrow: value, background: color }}/>)}</div>
          <div className="stack-legend">{where.map(([label, value, color, path]) => <Link to={path} key={label} style={{ ['--c' as string]: color }}><span/><div><strong>{n(value)}</strong><small>{t(label)}</small><small>{pct(value, ordered)}%</small></div></Link>)}</div>
          {stuck.length > 0 && <div className="stuck-list"><h4>{t('Where goods are waiting')}</h4>{stuck.map(([label, value, path]) => <Link to={path} key={label}><b>{n(value)}</b><span>{t(label.replace('{n} ', ''))}</span><ArrowRight size={14}/></Link>)}</div>}
          <p className="dash-foot">{t('{a} units ordered in total.', { a: n(ordered) })}{quarantined > 0 && ` ${t('{n} units in quarantine', { n: quarantined })}.`}</p>
        </> : <EmptyState title="No products yet" description="Import a PI to start tracking."/>}
      </section>
      <section className="panel"><SectionHeader title="Needs your attention" description="Resolve these first to keep orders moving."><Link className="text-link" to="/fms">{t('All actions')} <ArrowUpRight size={15}/></Link></SectionHeader>
        <div className="attention-list">{alerts.slice(0, 5).map(a => { const Icon = severityIcon[a.severity as keyof typeof severityIcon] || TriangleAlert, p = products.find(p => p.id === a.productId); return <button key={a.id} className="attention-item" onClick={() => select(a.productId)}><span className={`sev ${a.severity}`}><Icon size={18}/></span><div><strong>{t(a.title)}</strong><p>{p?.name} · {t(a.detail)}</p></div><time>{displayDate(a.due)}</time></button>; })}{!alerts.length && <EmptyState title="All clear" description="Nothing needs attention right now."/>}</div></section>
    </div>

    <div className="dash-duo">
      <section className="panel"><SectionHeader title="Order funnel" description="How many units reached each stage, from order to customer."/>
        {ordered > 0 ? <div className="funnel">{funnel.map(([label, value], i) => <div className="funnel-row" key={label}><span>{t(label)}</span><div className="funnel-track"><i style={{ width: `${Math.max(pct(value, ordered), value ? 2 : 0)}%`, opacity: 1 - i * 0.1 }}/></div><b>{n(value)}<small>{pct(value, ordered)}%</small></b></div>)}</div> : <EmptyState title="No products yet" description="Import a PI to start tracking."/>}
      </section>
      <section className="panel"><SectionHeader title="Deliveries due by month" description="Units still to deliver, by the customer’s required date."/>
        {months.length ? <div className="columns" role="img" aria-label={t('Units still to deliver by month')}>{months.map(m => <div className={m === 'late' ? 'column late' : 'column'} key={m}><b>{n(due[m])}</b><div className="column-bar"><i style={{ height: `${Math.max((due[m] / peak) * 100, 4)}%` }}/></div><span>{m === 'late' ? t('Overdue') : monthName.format(new Date(`${m}-01T00:00:00Z`))}</span></div>)}</div> : <p className="muted dash-empty">{t('No open product lines.')}</p>}
      </section>
    </div>

    <div className="dash-trio">
      <section className="panel"><SectionHeader title="Active shipments" description="Not yet arrived in India, nearest arrival first."><Link className="text-link" to="/shipments">{t('Shipments')} <ArrowUpRight size={15}/></Link></SectionHeader>
        <div className="dash-list">{activeShipments.map(s => {
          const eta = s.Expected_Arrival_India, left = eta ? days(today, eta) : null, units = products.filter(p => p.shipment === s.Shipment_ID).reduce((x, p) => x + (p.loaded - p.india), 0);
          return <div className="dash-row" key={s.Shipment_ID}><div><strong>{s.Shipment_ID}</strong><small>{s.Carrier} · {t('{n} units on board', { n: n(units) })}</small></div><div className="dash-row-end"><Badge>{s.Status}</Badge><small className={left !== null && left < 0 ? 'late' : ''}>{eta ? (left! < 0 ? t('{n} days late', { n: -left! }) : left === 0 ? t('Arrives today') : t('Arrives in {n} days', { n: left! })) : t('No arrival date')}</small></div></div>;
        })}{!activeShipments.length && <p className="muted dash-empty">{t('No active shipments.')}</p>}</div></section>

      <section className="panel"><SectionHeader title="India receiving audit" description="AI check of loaded versus received goods."><Link className="text-link" to="/audit-report">{t('Audit Report')} <ArrowUpRight size={15}/></Link></SectionHeader>
        <div className="audit-tally">{(['Match', 'Needs review', 'Mismatch'] as const).map(status => <div key={status} data-status={status}><strong>{drafts.filter(d => d.type === 'India receiving' && d.audit?.status === status).length}</strong><small>{t(status)}</small></div>)}<div><strong>{receiving.filter(d => !d.audit).length}</strong><small>{t('Not audited')}</small></div></div>
        <div className="dash-list">{flagged.slice(0, 3).map((d: Draft) => { const p = products.find(p => p.id === d.productId); return <Link to="/approvals" className="dash-row" key={d.id}><div><strong>{p?.name || d.productId}</strong><small>{d.audit?.summary}</small></div><div className="dash-row-end"><Badge tone={auditTone[d.audit!.status]}>{d.audit!.status}</Badge></div></Link>; })}
          {!flagged.length && <p className="muted dash-empty">{receiving.length ? t('No pending receipt is flagged. Run the AI audit on pending receipts.') : t('No India receipts are waiting for review.')}</p>}</div></section>

      <section className="panel"><SectionHeader title="Vendors to chase" description="Open lines, most overdue first."/>
        <div className="dash-list">{vendors.map(v => <div className="vendor-row" key={v.name}><div><strong>{v.name}</strong><small>{t('{a} lines · {b} units', { a: v.lines, b: n(v.qty) })}{v.late > 0 && <b className="late"> · {t('{n} overdue', { n: v.late })}</b>}</small></div><div className="vendor-meter"><small>{t('{n}% in China', { n: pct(v.done, v.qty) })}</small><div className="vendor-bar"><i style={{ width: `${pct(v.done, v.qty)}%` }}/></div></div></div>)}{!vendors.length && <p className="muted dash-empty">{t('No open vendor lines.')}</p>}</div></section>
    </div>

    <section className="panel pipeline-panel"><SectionHeader title="Your sourcing pipeline" description="Product lines by their furthest recorded physical stage."/>
      <div className="pipeline-bar" role="img" aria-label={t('Share of product lines by stage')}>{pipeline.map(stage => { const c = products.filter(p => p.planning.stage === stage).length; return c ? <i key={stage} title={`${t(stage)}: ${c}`} style={{ flexGrow: c, background: stageColors[stage] }}/> : null; })}</div>
      <div className="pipeline">{pipeline.map((stage, i) => <div key={stage} style={{ ['--stage' as string]: stageColors[stage] }}><span className="pipeline-number">{String(i + 1).padStart(2, '0')}</span><strong>{products.filter(p => p.planning.stage === stage).length}</strong><span>{t(stage)}</span></div>)}</div></section>

    <section className="panel"><SectionHeader title="Upcoming customer deadlines" description="Open product lines, nearest required delivery first."/>
      <div className="deadline-grid">{upcoming.map(p => { const late = p.planning.dueDays < 0; return <button key={p.id} className={late ? 'deadline-card late' : 'deadline-card'} onClick={() => select(p.id)}><span className="deadline-days"><b>{Math.abs(p.planning.dueDays)}</b>{late ? t('days late') : t('days left')}</span><strong>{p.name}</strong><small>{p.customer} · {p.pi}</small><Journey product={p} label={p.planning.stage}/></button>; })}{!upcoming.length && <p className="muted dash-empty">{t('No open product lines.')}</p>}</div></section>
    <section className="panel source-note"><Boxes size={14}/> {t('Alerts and deadlines are calculated from the dates recorded in the workspace, using today’s date in India: {date}.', { date: displayDate(today) })}</section>
  </>;
}
