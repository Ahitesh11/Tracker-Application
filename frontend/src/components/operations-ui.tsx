import type { ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';
export function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  const text = String(children);
  const color = tone || (/Critical|Overdue|At risk|Rejected/.test(text) ? 'red' : /Delivered|Completed|Approved|On track|Passed/.test(text) ? 'green' : /Pending|Awaiting|Review|Warning|risk/.test(text) ? 'amber' : 'blue');
  const { t } = useI18n();
  return <span className={`op-badge ${color}`}>{typeof children === 'string' ? t(children) : children}</span>;
}
export function Stat({ label, value, note, icon, tone }: { label: string; value: ReactNode; note: string; icon?: ReactNode; tone?: 'red' | 'amber' | 'blue' | 'green' | 'pink' | 'orange' | 'sky' }) { const { t } = useI18n(); return <article className={tone ? `stat-card tone-${tone}` : 'stat-card'}><div className="stat-top"><span>{t(label)}</span>{icon}</div><strong>{value}</strong><small>{t(note)}</small></article>; }
export function SectionHeader({ title, description, children }: { title: string; description?: string; children?: ReactNode }) { const { t } = useI18n(); return <div className="panel-heading"><div><h3>{t(title)}</h3>{description && <p>{t(description)}</p>}</div>{children}</div>; }
export function Field({ label, children }: { label: string; children: ReactNode }) { const { t } = useI18n(); return <label className="op-field"><span>{t(label)}</span>{children}</label>; }

type JourneyInput = { authorization: string; production: string; measurementDate?: string; startDate?: string; quantity: number; calledOut?: number; china: number; loaded: number; india: number; delivered: number };
/** The product journey: who confirms each stage and what proof they must attach. */
export const journeyStages = [
  { step: 'Finalise measurement', owner: 'India', proof: '' },
  { step: 'Authorise production', owner: 'India', proof: '' },
  { step: 'In production', owner: 'China', proof: 'Proof photo' },
  { step: 'Production complete', owner: 'China', proof: 'Proof photo' },
  { step: 'Ready to dispatch', owner: 'China', proof: '' },
  { step: 'China warehouse', owner: 'China', proof: '' },
  { step: 'Container loading', owner: 'China', proof: 'Loading photo · Shipments' },
  { step: 'India receiving', owner: 'India', proof: 'Carton photo' },
  { step: 'Delivered', owner: 'India', proof: 'Carton photo' },
] as const;
export const journeySteps = journeyStages.map(s => s.step);
/** Per-stage state ('done' | 'now' | '') for the nine journey stages. */
export function journeyProgress(p: JourneyInput) {
  const authorized = p.authorization === 'Approved for Production', completed = p.production === 'Production Completed', calledOut = p.calledOut ?? 0;
  const reached = [Boolean(p.measurementDate) || authorized, authorized, Boolean(p.startDate) || completed, completed, calledOut >= p.quantity, p.china >= p.quantity, p.loaded >= p.quantity, p.india >= p.quantity, p.delivered >= p.quantity];
  const partial = [false, false, false, p.production === 'In Production', calledOut > 0, p.china > 0, p.loaded > 0, p.india > 0, p.delivered > 0];
  return reached.map((done, i) => done ? 'done' : partial[i] ? 'now' : '');
}
/** Country tag for the team that confirms a stage. */
export function OwnerTag({ owner }: { owner: 'India' | 'China' }) { const { t } = useI18n(); return <span className={`owner-tag ${owner.toLowerCase()}`}>{t(owner)}</span>; }
/** Nine-segment bar showing how far a product has travelled. */
export function Journey({ product, label }: { product: JourneyInput; label: string }) {
  const states = journeyProgress(product), { t } = useI18n();
  return <div className="journey" title={journeyStages.map(({ step, owner }, i) => `${t(step)} (${t(owner)}):${states[i] === 'done' ? t('complete') : states[i] === 'now' ? t('in progress') : t('not started')}`).join(' · ')}><div className="journey-steps" aria-hidden="true">{states.map((state, i) => <i key={i} className={state}/>)}</div><span>{t(label)}</span></div>;
}
