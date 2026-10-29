import { useState } from 'react';
import { Check, X, ShieldCheck, Sparkles } from 'lucide-react';
import { useWorkspace } from '@/components/workspace-provider';
import { Badge, SectionHeader, Stat } from '@/components/operations-ui';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/auth-provider';
import { useI18n } from '@/lib/i18n';
import { PhotoList } from '@/components/form-helpers';
import { request, type Audit } from '@/services/workspace-api';
export function Approvals(){
  const {data,mutate,busy,select,refresh}=useWorkspace(),{can,enabled,user}=useAuth(),{t}=useI18n(),allowed=can('draft.review');const [actor,setActor]=useState(''),[error,setError]=useState(''),[status,setStatus]=useState('Pending');if(!data)return null;
  async function review(id:string,decision:string,acknowledgeAudit=false){setError('');try{await mutate(`/workspace/drafts/${id}/review`,{actor:enabled?user?.name:actor,decision,acknowledgeAudit});}catch(e){setError(e instanceof Error?e.message:t('Review failed.'));}}
  const [auditing,setAuditing]=useState('');
  async function audit(id:string){setError('');setAuditing(id);try{await request(`/workspace/drafts/${id}/audit`,{actor:enabled?user?.name:actor});await refresh();}catch(e){setError(e instanceof Error?e.message:t('Audit failed.'));}finally{setAuditing('');}}
  async function approve(d:{id:string;audit?:Audit}){if(d.audit?.status==='Mismatch'&&!window.confirm(t('The AI audit found a mismatch. Approve only if you checked the photos yourself. Continue?')))return;await review(d.id,'Approve',d.audit?.status==='Mismatch');}
  const rows=data.drafts.filter(d=>status==='All'||d.status===status);
  return <><div className="metric-grid"><Stat tone="orange" label="Pending review" value={data.drafts.filter(d=>d.status==='Pending').length} note="Check evidence before approving"/><Stat tone="sky" label="Already recorded" value={data.drafts.filter(d=>d.status==='Pending'&&d.duplicate).length} note="Duplicate postings are blocked"/><Stat tone="green" label="Approved" value={data.drafts.filter(d=>d.status==='Approved').length} note="Posted to the official log"/><Stat tone="red" label="Rejected" value={data.drafts.filter(d=>d.status==='Rejected').length} note="Kept for traceability"/></div><div className="info-banner"><ShieldCheck size={20}/><span>{t('Review product, quantity and document. Approval posts the movement once. Unmatched or duplicate drafts must be rejected or corrected with a new draft.')}</span></div><section className="panel"><SectionHeader title="Movement approval inbox" description="Movement drafts waiting for review, and the decisions already made."/><div className="sample-toolbar">{enabled?<span className="reviewer-note">{allowed?<>{t('Reviewing as')} <strong>{user?.name}</strong></>:t('Your role can create drafts but cannot approve them.')}</span>:<input aria-label={t('Reviewer name')} placeholder={t('Your name (required to review)')} value={actor} onChange={e=>setActor(e.target.value)} maxLength={100}/>}<select value={status} onChange={e=>setStatus(e.target.value)} aria-label={t('Approval status filter')}>{['Pending','Approved','Rejected','All'].map(v=><option key={v} value={v}>{t(v)}</option>)}</select><span className="sample-count">{t('{n} drafts',{n:rows.length})}</span></div>{error&&<div className="error-banner" role="alert">{t(error)}</div>}<DataTable rows={rows} rowKey={d=>d.id} columns={[
    {key:'id',title:'Draft / document',render:d=><div className="cell-stack"><strong>{d.id}</strong><small>{d.document}</small></div>},
    {key:'product',title:'Product',render:d=>{const p=data.products.find(p=>p.id===d.productId);return p?<button className="product-name" onClick={()=>select(p.id)}><strong>{p.name}</strong><small>{p.pi} · {p.customer}</small></button>:<Badge tone="red">Unmatched product</Badge>;}},
    {key:'type',title:'Movement / quantity',render:d=><div className="cell-stack"><span>{t(d.type)}</span><strong>{d.quantity} {t('pcs')}</strong><small>{d.carton}</small></div>},
    {key:'review',title:'Review notes',render:d=><div className="approval-notes">{d.duplicate&&<Badge tone="amber">Already in official log</Badge>}<p>{d.notes}</p>{d.evidence&&<small>{t('Evidence')}: {d.evidence}</small>}<small>{t('Source confidence:')} {t(d.confidence)}</small>{d.photos&&d.photos.length>0&&<PhotoList paths={d.photos}/>}{d.type==='India receiving'&&<AuditBox audit={d.audit} pending={d.status==='Pending'} busy={auditing===d.id} run={()=>void audit(d.id)}/>}</div>},
    {key:'status',title:'Status',render:d=><Badge>{d.status}</Badge>},
    {key:'action',title:'Review',render:d=>d.status==='Pending'?<div className="inline-actions"><Button disabled={busy||!allowed||(!enabled&&!actor.trim())||d.duplicate||!data.products.some(p=>p.id===d.productId)} onClick={()=>void approve(d)}><Check size={14}/>{t('Approve')}</Button><Button variant="outline" disabled={busy||!allowed||(!enabled&&!actor.trim())} onClick={()=>void review(d.id,'Reject')}><X size={14}/>{t('Reject')}</Button></div>:<small>{d.reviewedBy||'—'}</small>},
  ]} emptyMessage="No drafts in this status. Create a movement draft from a product’s detail panel."/></section></>;
}

const auditTone:Record<string,string>={Match:'green','Needs review':'amber',Mismatch:'red',Unavailable:'amber'};
/** The AI receiving audit: loading photos (China) against receiving photos (India) and the recorded quantities. */
function AuditBox({audit,pending,busy,run}:{audit?:Audit;pending:boolean;busy:boolean;run:()=>void}){
  const {t}=useI18n();
  if(!audit)return pending?<Button variant="outline" disabled={busy} onClick={run}><Sparkles size={14}/>{busy?t('AI is auditing…'):t('Run AI audit')}</Button>:null;
  return <div className="audit-box" data-status={audit.status}><div className="audit-head"><Sparkles size={14}/><strong>{t('AI receiving audit')}</strong><Badge tone={auditTone[audit.status]}>{audit.status}</Badge></div><p>{audit.summary}</p>
    <small>{t('Loaded photos show {a} · received photos show {b} · expected {c}',{a:audit.loadedSeen??'?',b:audit.receivedSeen??'?',c:audit.expectedQuantity})}</small>
    {audit.findings.length>0&&<ul>{audit.findings.map(f=><li key={f}>{f}</li>)}</ul>}
    {pending&&<Button variant="ghost" disabled={busy} onClick={run}>{busy?t('AI is auditing…'):t('Run again')}</Button>}</div>;
}
