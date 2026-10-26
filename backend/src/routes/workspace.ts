import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { getState, snapshot, commit, must, date, today, applyMovement, duplicate, type Draft, type Movement } from '../operations.js';
import { text, integer, HttpError } from '../http.js';
export const workspaceRouter = Router();
workspaceRouter.use((req,_res,next)=>{if(req.method==='POST' && req.body.revision!==undefined && integer(req.body.revision,1)!==getState().revision)throw new HttpError(409,'Workspace changed. Refresh and try again.');next();});
workspaceRouter.get('/', (_req, res) => res.json(snapshot()));
workspaceRouter.get('/backup', (_req, res) => res.attachment(`forma-backup-${today()}.json`).json(getState()));
workspaceRouter.post('/shipments',(req,res)=>{
  const s=getState(),id=text(req.body.id,100),actor=text(req.body.actor,100),notes=text(req.body.notes),carrier=text(req.body.carrier,200),tracking=text(req.body.tracking,200),status=text(req.body.status,50);
  must(id&&actor&&notes&&carrier,'Shipment reference, carrier, your name and an update note are required.');
  must(['Planned','In Transit','Arrived'].includes(status),'Choose a valid shipment status.');
  const parse=(key:string)=>{const raw=text(req.body[key],10),value=date(raw);must(!raw||value,`Enter a valid ${key} date.`);return value;};
  const expected=parse('expectedArrival'),dispatch=parse('actualDispatch'),arrival=parse('actualArrival');
  must(!dispatch||dispatch<=today(),'Dispatch cannot be in the future.');must(!arrival||arrival<=today(),'Actual arrival cannot be in the future.');
  if(status==='In Transit'||status==='Arrived')must(dispatch,'Actual dispatch date is required.');
  if(status==='Arrived')must(arrival,'Actual India arrival date is required.');
  must(!arrival||Boolean(dispatch&&arrival>=dispatch),'Arrival must be on or after dispatch.');
  must(!expected||!dispatch||expected>=dispatch,'Expected arrival cannot precede dispatch.');
  const existing=s.shipments.find(sh=>sh.Shipment_ID===id);
  const shipment={...(existing||{}),Shipment_ID:id,Carrier:carrier,Tracking_Ref:tracking,Status:status,Expected_Arrival_India:expected,Actual_Dispatch_Date:dispatch,Actual_Arrival_India:arrival,Notes:notes,Confirmed_By:actor};
  if(existing)Object.assign(existing,shipment);else s.shipments.push(shipment);
  s.activity.unshift({id:randomUUID(),productId:'',action:existing?'Shipment updated':'Shipment created',quantity:0,document:tracking,notes:`${id}: ${status}. ${notes}`,actor,at:new Date().toISOString(),source:'Operator shipment update',shipment:id});
  commit(s);res.status(existing?200:201).json(snapshot());
});
workspaceRouter.post('/products', (req, res) => {
  const s = getState();
  const fields = Object.fromEntries(['pi', 'order', 'customer', 'vendor', 'name', 'specs', 'dimensions', 'category', 'subcategory', 'actor'].map(key => [key, text(req.body[key], 200)]));
  must(['pi','order','customer','vendor','name','category','subcategory','actor'].every(key => fields[key]), 'Complete all required product fields.');
  must(s.leads.some(l => l.category === fields.category && l.subcategory === fields.subcategory), 'Choose an existing lead-time category.');
  const quantity = integer(req.body.quantity,1), required = date(text(req.body.required));
  must(Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 1000000, 'Quantity must be a positive whole number up to 1,000,000.');
  must(required, 'A valid required delivery date is needed for planning.');
  must(!s.products.some(p => p.pi === fields.pi && (p.customer !== fields.customer || p.order !== fields.order)), 'This PI already belongs to another customer or order. Use its existing customer/order or a new PI number.');
  const id = `PRD-${randomUUID().slice(0, 8).toUpperCase()}`;
  s.products.push({ id, pi: fields.pi, order: fields.order, customer: fields.customer, vendor: fields.vendor, name: fields.name, specs: fields.specs, dimensions: fields.dimensions, category: fields.category, subcategory: fields.subcategory, quantity, unit: 'pcs', authorization: 'Not Reviewed', production: 'Not Started', required, originalRequired: required, expectedCompletion: '', instructionDate: '', ackDate: '', startDate: '', completionDate: '', china: 0, loaded: 0, india: 0, delivered: 0, calledOut: 0, owner: 'India Controller', nextAction: 'Review specifications and authorize production', deadline: today(), shipment: '', container: '', notes: '', issues: [] });
  s.activity.unshift({ id: randomUUID(), productId: id, action: 'Product created', quantity, document: fields.pi, notes: fields.name, actor: fields.actor, at: new Date().toISOString(), source: 'Operator entry' });
  commit(s); res.status(201).json(snapshot());
});
workspaceRouter.post('/products/:id/update', (req, res) => {
  const s = getState();
  const p = s.products.find(p => p.id === req.params.id);
  must(p, 'Product not found.');
  const action = text(req.body.action), actor = text(req.body.actor, 100), notes = text(req.body.notes);
  must(actor && notes, 'Your name and an update note are required.');
  const actualDate = text(req.body.date);
  const at = actualDate ? date(actualDate) : today();
  must(at, 'Enter a valid actual event date.');
  must(at <= today(), 'Actual event dates cannot be in the future.');
  if (action === 'Authorize production') {
    must(p.authorization !== 'Approved for Production', 'Product is already authorized.');
    p.authorization = 'Approved for Production'; p.owner = 'China Controller'; p.nextAction = 'Send production instruction';
  } else if (action === 'Record instruction') {
    must(p.authorization === 'Approved for Production', 'India authorization is required first.');
    must(!p.instructionDate && !p.completionDate, 'Instruction is already recorded.');
    p.instructionDate = at; p.production = 'Instruction Sent — Awaiting Acknowledgment'; p.nextAction = 'Obtain vendor acknowledgment';
  } else if (action === 'Record acknowledgment') {
    must(p.instructionDate && !p.ackDate, 'Record instruction first; acknowledgment must be new.');
    must(at >= p.instructionDate, 'Acknowledgment cannot precede instruction.');
    p.ackDate = at; p.production = 'Acknowledged — Awaiting Production Start'; p.nextAction = 'Confirm production start';
  } else if (action === 'Start production') {
    must(p.authorization === 'Approved for Production' && p.ackDate, 'Authorization and vendor acknowledgment are required.');
    must(!p.startDate && !p.completionDate, 'Production has already started or completed.');
    must(at >= p.ackDate, 'Start cannot precede acknowledgment.');
    p.startDate = at; p.production = 'In Production'; p.nextAction = 'Monitor production completion';
  } else if (action === 'Complete production') {
    must(p.authorization === 'Approved for Production' && p.startDate, 'Record authorized production start first.');
    must(!p.completionDate && p.production !== 'Production Completed', 'Production is already complete.');
    must(at >= p.startDate, 'Completion cannot precede start.');
    p.completionDate = at; p.production = 'Production Completed'; p.nextAction = 'Arrange vendor collection';
  } else if (action === 'Update follow-up') {
    const deadline = date(text(req.body.deadline));
    must(deadline, 'Enter a valid next-action deadline.');
    p.nextAction = notes; p.deadline = deadline; p.owner = text(req.body.owner, 100) || p.owner;
  } else if (action === 'Revise delivery date') {
    const required = date(text(req.body.required));
    must(required, 'Enter a valid required delivery date.');
    p.required = required;
  } else if (action === 'Reconcile imported balances') {
    must(p.issues.length, 'Opening balance reconciliation is available only for imported data reviews.');
    const quantities = ['china', 'loaded', 'india', 'delivered'].map(key => integer(req.body[key]));
    must(quantities.every(q => Number.isSafeInteger(q) && q >= 0), 'All reconciled quantities must be nonnegative whole numbers.');
    must(p.quantity >= quantities[0] && quantities[0] >= quantities[1] && quantities[1] >= quantities[2] && quantities[2] >= quantities[3], 'Balances must satisfy: ordered ≥ China received ≥ loaded ≥ India received ≥ delivered.');
    const previous = { china: p.china, loaded: p.loaded, india: p.india, delivered: p.delivered };
    [p.china, p.loaded, p.india, p.delivered] = quantities;
    s.activity.unshift({ id: randomUUID(), productId: p.id, action: 'Opening balances reconciled', quantity: 0, document: text(req.body.document, 200), notes: `${notes}. Before: ${JSON.stringify(previous)}. After: ${JSON.stringify({ china: p.china, loaded: p.loaded, india: p.india, delivered: p.delivered })}`, actor, at: new Date().toISOString(), source: 'Evidence reconciliation' });
  } else if (action === 'Resolve data review') {
    must(p.issues.length, 'No imported data issues are open.');
    p.issues = []; // Note and actor remain permanently in the activity log.
  } else { must(false, 'Unsupported update action.'); }
  if (!['Update follow-up', 'Revise delivery date', 'Resolve data review', 'Reconcile imported balances'].includes(action)) p.deadline = p.expectedCompletion > today() ? p.expectedCompletion : today();
  if (action !== 'Reconcile imported balances') s.activity.unshift({ id: randomUUID(), productId: p.id, action, quantity: 0, document: text(req.body.document, 200), notes, actor, at: new Date().toISOString(), source: 'Operator update' });
  commit(s); res.json(snapshot());
});
workspaceRouter.post('/drafts', (req, res) => {
  const s = getState();
  const type = text(req.body.type) as Movement;
  must(['China receiving', 'Container loading', 'India receiving', 'Customer delivery'].includes(type), 'Choose a valid movement.');
  const p = s.products.find(p => p.id === req.body.productId);
  must(p, 'Choose a matched product.');
  const quantity = integer(req.body.quantity,1);
  must(Number.isSafeInteger(quantity) && quantity > 0 && quantity <= p.quantity, 'Enter a valid quantity within the order quantity.');
  const document = text(req.body.document, 200);
  must(document, 'Document reference is required.');
  const draft: Draft = { id: `DRAFT-${randomUUID().slice(0, 8)}`, productId: p.id, type, quantity, document, carton: text(req.body.carton, 100), shipment: text(req.body.shipment, 100), container: text(req.body.container, 100), notes: text(req.body.notes), confidence: 'Operator entry', status: 'Pending', createdAt: new Date().toISOString() };
  must(!duplicate(s, draft), 'This document movement is already in the official log.');
  must(!s.drafts.some(d => d.status === 'Pending' && d.productId === draft.productId && d.type === draft.type && d.document === draft.document), 'This document movement is already awaiting review.');
  s.drafts.unshift(draft); commit(s); res.status(201).json(snapshot());
});
workspaceRouter.post('/drafts/:id/review', (req, res) => {
  const s = getState(), d = s.drafts.find(d => d.id === req.params.id);
  must(d && d.status === 'Pending', 'This draft is missing or already reviewed.');
  const actor = text(req.body.actor, 100), decision = text(req.body.decision);
  must(actor, 'Enter the reviewer name.');
  must(decision === 'Approve' || decision === 'Reject', 'Choose Approve or Reject.');
  if (decision === 'Approve') applyMovement(s, d, actor);
  d.status = decision === 'Approve' ? 'Approved' : 'Rejected'; d.reviewedBy = actor; d.reviewedAt = new Date().toISOString();
  if (decision === 'Reject') s.activity.unshift({ id: randomUUID(), productId: d.productId, action: 'Draft rejected', quantity: d.quantity, document: d.document, notes: d.notes, actor, at: d.reviewedAt, source: 'Operator review' });
  commit(s); res.json(snapshot());
});
workspaceRouter.post('/lead-times', (req, res) => {
  const s = getState();
  const lead = s.leads.find(l => l.category === req.body.category && l.subcategory === req.body.subcategory);
  must(lead, 'Lead-time category not found.');
  for (const key of ['manufacturing', 'transit', 'chinaBuffer', 'consolidation', 'customs', 'delivery', 'safety'] as const) {
    lead[key] = integer(req.body[key],0,730);
  }
  const actor = text(req.body.actor, 100); must(actor, 'Your name is required.');
  s.activity.unshift({ id: randomUUID(), productId: '', action: 'Lead times updated', quantity: 0, document: '', notes: `${lead.category} / ${lead.subcategory}: ${JSON.stringify(lead)}`, actor, at: new Date().toISOString(), source: 'Planning settings' });
  commit(s); res.json(snapshot());
});
