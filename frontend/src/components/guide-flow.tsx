import { ArrowRight } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { OwnerTag } from '@/components/operations-ui';

type Tone = 'accent' | 'sky' | 'orange' | 'green' | 'pink';
// title, where you do it, what changes in the data, where it shows afterwards
const steps: { tone: Tone; title: string; owner?: 'India' | 'China'; proof?: string; where: string; changes: string; shows: string }[] = [
  { tone: 'accent', title: 'Create product', where: 'Products & Orders → Add product or Import PI', changes: 'A new product line. Measurement is not finalised, authorization is Not Reviewed, production is Not Started and every quantity is 0.', shows: 'Products & Orders, PI Tracker, Production' },
  { tone: 'accent', title: 'Finalise measurement', owner: 'India', where: 'Update product, or Bulk update', changes: 'Measurement date is saved. Production cannot be authorized before this.', shows: 'Production, Action Centre' },
  { tone: 'accent', title: 'Authorize production', owner: 'India', where: 'Update product, or Bulk update', changes: 'Authorization becomes Approved for Production. The owner moves to China Controller.', shows: 'Production → Authorization column' },
  { tone: 'sky', title: 'Record instruction', where: 'Update product, or Bulk update', changes: 'Instruction date is saved. Status: Instruction Sent, Awaiting Acknowledgment.', shows: 'Production, Action Centre' },
  { tone: 'sky', title: 'Record acknowledgment', where: 'Update product, or Bulk update', changes: 'Vendor acknowledgment date is saved. It cannot be earlier than the instruction.', shows: 'Production' },
  { tone: 'sky', title: 'Start production', owner: 'China', proof: 'Proof photo', where: 'Update product, or Bulk update', changes: 'Start date is saved. Status: In Production.', shows: 'Production' },
  { tone: 'sky', title: 'Complete production', owner: 'China', proof: 'Proof photo', where: 'Update product, or Bulk update', changes: 'Completion date is saved. Status: Production Completed.', shows: 'The product now appears in Vendor Call-out' },
  { tone: 'orange', title: 'Vendor call-out', owner: 'China', where: 'Update product (one product at a time)', changes: 'The called-out quantity goes up and the vendor’s promised date is saved.', shows: 'Vendor Call-out register' },
  { tone: 'orange', title: 'China receiving', owner: 'China', where: 'Record movement → Approval Inbox', changes: 'After approval the China received quantity goes up. It can never exceed the called-out quantity.', shows: 'China Warehouse' },
  { tone: 'pink', title: 'Container loading', owner: 'China', proof: 'Loading photo', where: 'Record movement → Approval Inbox', changes: 'After approval the loaded quantity goes up and the shipment and container are saved on the product. Only stock that is not in quarantine can be loaded.', shows: 'Shipments, India Receiving' },
  { tone: 'pink', title: 'India receiving', owner: 'India', proof: 'Carton photo', where: 'Record movement → Approval Inbox', changes: 'After approval the India received quantity goes up. It can never exceed the loaded quantity.', shows: 'India Receiving, Customer Delivery' },
  { tone: 'green', title: 'Customer delivery', owner: 'India', proof: 'Carton photo', where: 'Record movement → Approval Inbox', changes: 'After approval the delivered quantity goes up. It can never exceed the India stock.', shows: 'Customer Delivery, Overview' },
  { tone: 'green', title: 'Close product line', where: 'Update product', changes: 'The line is closed once everything is delivered. If goods are still pending, a reason is needed (short-close).', shows: 'Stage: Delivered or Closed' },
];

/** The journey of one product: what each step changes and where the change shows up. */
export function GuideFlow() {
  const { t } = useI18n();
  return <section className="panel guide-card guide-flow">
    <span className="eyebrow">{t('DATA JOURNEY')}</span><h2>{t('What happens to the data, step by step')}</h2>
    <ol className="flow-chips" aria-label={t('Product journey')}>{steps.map((s, i) => <li key={s.title} className={`flow-chip tone-${s.tone}`}><b>{i + 1}</b>{t(s.title)}{i < steps.length - 1 && <ArrowRight size={14} aria-hidden/>}</li>)}</ol>
    <div className="table-wrap"><table className="data-table"><thead><tr>{['#', 'Step', 'Team', 'Proof', 'Where you do it', 'What changes in the data', 'Where it shows'].map(h => <th key={h}>{t(h)}</th>)}</tr></thead>
      <tbody>{steps.map((s, i) => <tr key={s.title}><td><span className={`flow-num tone-${s.tone}`}>{i + 1}</span></td><td><strong>{t(s.title)}</strong></td><td>{s.owner && <OwnerTag owner={s.owner}/>}</td><td>{s.proof ? t(s.proof) : '—'}</td><td>{t(s.where)}</td><td>{t(s.changes)}</td><td>{t(s.shows)}</td></tr>)}</tbody></table></div>
    <div className="flow-notes">
      <div className="review-box"><strong>{t('Movements need approval')}</strong><p>{t('Steps 9 to 12 are saved as drafts first. Quantities change only when the draft is approved in the Approval Inbox. A rejected draft changes nothing.')}</p></div>
      <div className="review-box"><strong>{t('The stage is calculated')}</strong><p>{t('You never set the stage by hand. The app works it out from the quantities: factory, China warehouse, in transit, India or delivered.')}</p></div>
      <div className="review-box"><strong>{t('Every step is logged')}</strong><p>{t('Each update adds an Activity Log entry (who, when, quantity, document), updates the owner and next action, and recalculates the alerts.')}</p></div>
    </div>
  </section>;
}
