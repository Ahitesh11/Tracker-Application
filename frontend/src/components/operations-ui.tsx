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

type JourneyInput = { authorization: string; production: string; quantity: number; china: number; loaded: number; india: number; delivered: number };
export const journeySteps = ['Authorization', 'Production', 'China warehouse', 'Loaded', 'India', 'Delivered'] as const;
/** Per-step state ('done' | 'now' | '') from authorization through customer delivery. */
export function journeyProgress(p: JourneyInput) {
  const reached = [p.authorization === 'Approved for Production', p.production === 'Production Completed', p.china >= p.quantity, p.loaded >= p.quantity, p.india >= p.quantity, p.delivered >= p.quantity];
  const partial = [false, p.production === 'In Production', p.china > 0, p.loaded > 0, p.india > 0, p.delivered > 0];
  return reached.map((done, i) => done ? 'done' : partial[i] ? 'now' : '');
}
/** Six-segment bar showing how far a product has travelled. */
export function Journey({ product, label }: { product: JourneyInput; label: string }) {
  const states = journeyProgress(product), { t } = useI18n();
  return <div className="journey" title={journeySteps.map((step, i) => `${t(step)}: ${states[i] === 'done' ? t('complete') : states[i] === 'now' ? t('in progress') : t('not started')}`).join(' · ')}><div className="journey-steps" aria-hidden="true">{states.map((state, i) => <i key={i} className={state}/>)}</div><span>{t(label)}</span></div>;
}
