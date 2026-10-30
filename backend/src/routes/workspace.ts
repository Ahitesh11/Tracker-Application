import { Router, type Request } from 'express';
import { randomUUID } from 'node:crypto';
import { getState, snapshot, commit, must, date, today, applyMovement, duplicate, recordCallOut, raiseException, updateException, resolveException, reopenException, closeProduct, reopenProduct, seenRequest, movements, type Draft, type Movement, type Product, type Store, OperationError } from '../operations.js';
import { text, integer, HttpError } from '../http.js';
import { actorOf, requirePermission } from '../auth.js';
import { evidencePathPattern } from '../evidence.js';
import { auditReceiving } from '../audit.js';
export const workspaceRouter = Router();

/** Optional idempotency key sent by the screens: the same key never creates a second record. */
const requestKey = (req: Request) => { const value = req.body?.requestId; return typeof value === 'string' && /^[\w-]{8,100}$/.test(value) ? value : undefined; };
// Every write: replay-safe (same requestId answers with the current data) and protected against stale screens (revision).
workspaceRouter.use(async (req, res, next) => {
  if (req.method !== 'POST') { next(); return; }
  const s = await getState(), key = requestKey(req);
  if (key && seenRequest(s, key)) { res.json(await snapshot()); return; }
  if (req.body.revision !== undefined && integer(req.body.revision, 1) !== s.revision) throw new HttpError(409, 'Workspace changed. Refresh and try again.');
  next();
});
workspaceRouter.get('/', async (_req, res) => res.json(await snapshot()));
workspaceRouter.get('/backup', async (req, res) => { requirePermission(req, 'product.reopen'); res.attachment(`forma-backup-${today()}.json`).json(await getState()); });

workspaceRouter.post('/shipments', async (req, res) => {
  requirePermission(req, 'shipment.manage');
  const s = await getState(), id = text(req.body.id, 100), actor = actorOf(req, req.body.actor), notes = text(req.body.notes), carrier = text(req.body.carrier, 200), tracking = text(req.body.tracking, 200), status = text(req.body.status, 50);
  must(id && actor && notes && carrier, 'Shipment reference, carrier, your name and an update note are required.');
  must(['Planned', 'In Transit', 'Arrived'].includes(status), 'Choose a valid shipment status.');
  const parse = (key: string) => { const raw = text(req.body[key], 10), value = date(raw); must(!raw || value, `Enter a valid ${key} date.`); return value; };
  const expected = parse('expectedArrival'), dispatch = parse('actualDispatch'), arrival = parse('actualArrival');
  must(!dispatch || dispatch <= today(), 'Dispatch cannot be in the future.'); must(!arrival || arrival <= today(), 'Actual arrival cannot be in the future.');
  if (status === 'In Transit' || status === 'Arrived') must(dispatch, 'Actual dispatch date is required.');
  if (status === 'Arrived') must(arrival, 'Actual India arrival date is required.');
  must(!arrival || Boolean(dispatch && arrival >= dispatch), 'Arrival must be on or after dispatch.');
  must(!expected || !dispatch || expected >= dispatch, 'Expected arrival cannot precede dispatch.');
  const existing = s.shipments.find(sh => sh.Shipment_ID === id);
  const shipment = { ...(existing || {}), Shipment_ID: id, Carrier: carrier, Tracking_Ref: tracking, Status: status, Expected_Arrival_India: expected, Actual_Dispatch_Date: dispatch, Actual_Arrival_India: arrival, Notes: notes, Confirmed_By: actor };
  if (existing) Object.assign(existing, shipment); else s.shipments.push(shipment);
  s.activity.unshift({ id: randomUUID(), productId: '', action: existing ? 'Shipment updated' : 'Shipment created', quantity: 0, document: tracking, notes: `${id}: ${status}. ${notes}`, actor, at: new Date().toISOString(), source: 'Operator shipment update', shipment: id, requestId: requestKey(req) });
  await commit(s); res.status(existing ? 200 : 201).json(await snapshot());
});

const newProduct = (id: string, f: Record<string, string>, quantity: number, required: string, unit = 'pcs'): Product => ({ id, pi: f.pi, order: f.order, customer: f.customer, vendor: f.vendor, name: f.name, specs: f.specs, dimensions: f.dimensions, category: f.category, subcategory: f.subcategory, quantity, unit, authorization: 'Not Reviewed', production: 'Not Started', required, originalRequired: required, expectedCompletion: '', instructionDate: '', ackDate: '', startDate: '', completionDate: '', china: 0, loaded: 0, india: 0, delivered: 0, calledOut: 0, owner: 'India Controller', nextAction: 'Finalise measurement', deadline: today(), shipment: '', container: '', notes: '', issues: [], calloutDate: '', vendorCommitDate: '', quarantined: 0, closed: '', closedBy: '', closedReason: '', measurementDate: '' });
const productFields = (body: Record<string, unknown>) => Object.fromEntries(['pi', 'order', 'customer', 'vendor', 'name', 'specs', 'dimensions', 'category', 'subcategory'].map(key => [key, text(body[key], 200)]));

workspaceRouter.post('/products', async (req, res) => {
  requirePermission(req, 'product.create');
  const s = await getState(), actor = actorOf(req, req.body.actor), fields = productFields(req.body);
  must(['pi', 'order', 'customer', 'vendor', 'name', 'category', 'subcategory'].every(key => fields[key]) && actor, 'Complete all required product fields.');
  must(s.leads.some(l => l.category === fields.category && l.subcategory === fields.subcategory), 'Choose an existing lead-time category.');
  const quantity = integer(req.body.quantity, 1), required = date(text(req.body.required));
  must(Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 1000000, 'Quantity must be a positive whole number up to 1,000,000.');
  must(required, 'A valid required delivery date is needed for planning.');
  must(!s.products.some(p => p.pi === fields.pi && (p.customer !== fields.customer || p.order !== fields.order)), 'This PI already belongs to another customer or order. Use its existing customer/order or a new PI number.');
  const id = `PRD-${randomUUID().slice(0, 8).toUpperCase()}`;
  s.products.push(newProduct(id, fields, quantity, required));
  s.activity.unshift({ id: randomUUID(), productId: id, action: 'Product created', quantity, document: fields.pi, notes: fields.name, actor, at: new Date().toISOString(), source: 'Operator entry', requestId: requestKey(req) });
  await commit(s); res.status(201).json(await snapshot());
});

// One PI with many rows (read from an uploaded PI document): all lines are created together or none.
workspaceRouter.post('/products/bulk', async (req, res) => {
  requirePermission(req, 'product.create');
  const s = await getState(), actor = actorOf(req, req.body.actor), rows = req.body.rows;
  const head = productFields(req.body), required = date(text(req.body.required));
  must(actor && head.pi && head.order && head.customer, 'PI number, order reference, customer and your name are required.');
  must(required, 'A valid required delivery date is needed for planning.');
  must(Array.isArray(rows) && rows.length > 0 && rows.length <= 200, 'Add between 1 and 200 product rows.');
  must(!s.products.some(p => p.pi === head.pi && (p.customer !== head.customer || p.order !== head.order)), 'This PI already belongs to another customer or order. Use its existing customer/order or a new PI number.');
  const now = new Date().toISOString(), key = requestKey(req), created: Product[] = [];
  rows.forEach((row: Record<string, unknown>, index: number) => {
    const f: Record<string, string> = { ...productFields(row), pi: head.pi, order: head.order, customer: head.customer }, n = index + 1, quantity = (() => { try { return integer(row.quantity, 1); } catch { must(false, `Row ${n}: quantity must be a positive whole number.`); return 0; } })();
    must(f.name && f.vendor && f.category && f.subcategory, `Row ${n}: product name, vendor and category are required.`);
    must(s.leads.some(l => l.category === f.category && l.subcategory === f.subcategory), `Row ${n}: choose an existing lead-time category.`);
    must(Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 1000000, `Row ${n}: quantity must be a positive whole number.`);
    const product = newProduct(`PRD-${randomUUID().slice(0, 8).toUpperCase()}`, f, quantity, required, text(row.unit, 20).toLowerCase() || 'pcs');
    const photos = Array.isArray(row.photos) ? row.photos : [];
    must(photos.length <= 8 && photos.every((v: unknown) => typeof v === 'string' && evidencePathPattern.test(v)), `Row ${n}: attach up to 8 photos uploaded through the app.`);
    if (photos.length) product.photos = photos;
    created.push(product); s.products.push(product);
    s.activity.unshift({ id: randomUUID(), productId: product.id, action: 'Product created', quantity, document: head.pi, notes: product.name, actor, at: now, source: 'PI import', requestId: key && index === 0 ? key : undefined });
  });
  await commit(s); res.status(201).json(await snapshot());
});

// Which permission each product update needs.
const updatePermission: Record<string, string> = {
  'Finalise measurement': 'production.authorize', 'Authorize production': 'production.authorize', 'Record instruction': 'production.instruct', 'Record acknowledgment': 'production.ack', 'Start production': 'production.start', 'Complete production': 'production.complete',
  'Record vendor call-out': 'callout', 'Update follow-up': 'followup', 'Revise delivery date': 'delivery.revise', 'Close product line': 'product.close', 'Reopen product line': 'product.reopen',
};
/** Applies one product update (authorize, instruct, start, revise date...) to a product in the loaded workspace; throws when it is not allowed. */
function applyUpdate(req: Request, s: Store, p: Product) {
  const action = text(req.body.action), actor = actorOf(req, req.body.actor), notes = text(req.body.notes);
  must(updatePermission[action], 'Unsupported update action.');
  requirePermission(req, updatePermission[action]);
  must(actor && notes, 'Your name and an update note are required.');
  const actualDate = text(req.body.date);
  const at = actualDate ? date(actualDate) : today();
  must(at, 'Enter a valid actual event date.');
  must(at <= today(), 'Actual event dates cannot be in the future.');
  if (p.closed && action !== 'Reopen product line') throw new HttpError(400, 'This product line is closed. Ask Management to reopen it first.');
  // China's start and completion confirmations need photo proof.
  const photos = Array.isArray(req.body.photos) ? req.body.photos : [];
  must(photos.length <= 8 && photos.every((v: unknown) => typeof v === 'string' && evidencePathPattern.test(v)) && new Set(photos).size === photos.length, 'Attach up to 8 photos uploaded through the app.');
  if (action === 'Start production' || action === 'Complete production') must(photos.length >= 1, action === 'Start production' ? 'Attach at least one photo proving production has started.' : 'Attach at least one photo proving production is complete.');
  if (action === 'Finalise measurement') {
    must(p.authorization !== 'Approved for Production' && !p.measurementDate, 'Measurement is already finalised.');
    p.measurementDate = at; p.nextAction = 'Review specifications and authorize production';
  } else if (action === 'Authorize production') {
    must(p.authorization !== 'Approved for Production', 'Product is already authorized.');
    must(p.measurementDate, 'Finalise the measurement before authorizing production.');
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
    p.completionDate = at; p.production = 'Production Completed'; p.owner = 'China Controller'; p.nextAction = 'Record the vendor call-out for the ready goods';
  } else if (action === 'Record vendor call-out') {
    const commit_ = text(req.body.vendorCommitDate, 10), commitDate = commit_ ? date(commit_) : '';
    must(!commit_ || commitDate, 'Enter a valid vendor delivery commitment date.');
    recordCallOut(p, integer(req.body.quantity, 1), at, commitDate);
  } else if (action === 'Update follow-up') {
    const deadline = date(text(req.body.deadline));
    must(deadline, 'Enter a valid next-action deadline.');
    p.nextAction = notes; p.deadline = deadline; p.owner = text(req.body.owner, 100) || p.owner;
  } else if (action === 'Revise delivery date') {
    const required = date(text(req.body.required));
    must(required, 'Enter a valid required delivery date.');
    p.required = required;
  } else if (action === 'Close product line') {
    closeProduct(s, p, { shortClose: req.body.shortClose === true, notes, actor, at });
  } else { reopenProduct(p); }
  if (!['Update follow-up', 'Revise delivery date', 'Close product line', 'Reopen product line'].includes(action)) p.deadline = p.expectedCompletion > today() ? p.expectedCompletion : today();
  s.activity.unshift({ id: randomUUID(), productId: p.id, action, quantity: action === 'Record vendor call-out' ? integer(req.body.quantity, 1) : 0, document: text(req.body.document, 200), notes, actor, at: new Date().toISOString(), source: 'Operator update', evidence: text(req.body.evidence, 500) || undefined, photos: photos.length ? photos : undefined, requestId: requestKey(req) });
}
workspaceRouter.post('/products/:id/details', async (req, res) => {
  requirePermission(req, 'product.edit');
  const s = await getState(), p = s.products.find(p => p.id === req.params.id);
  must(p, 'Product not found.');
  must(!p.closed, 'This product line is closed. Ask Management to reopen it first.');
  const actor = actorOf(req, req.body.actor), notes = text(req.body.notes);
  must(actor && notes, 'Your name and an update note are required.');
  const fields = Object.fromEntries(['vendor', 'name', 'specs', 'dimensions'].map(key => [key, text(req.body[key], 200)]));
  must(fields.vendor && fields.name, 'Product name and vendor are required.');
  const photos = req.body.photos;
  must(Array.isArray(photos) && photos.length <= 8 && photos.every(v => typeof v === 'string' && evidencePathPattern.test(v)) && new Set(photos).size === photos.length, 'Attach up to 8 photos uploaded through the app.');
  const before = { vendor: p.vendor, name: p.name, specs: p.specs, dimensions: p.dimensions, photos: p.photos || [] };
  Object.assign(p, fields, { photos });
  s.activity.unshift({ id: randomUUID(), productId: p.id, action: 'Product details corrected', quantity: 0, document: p.pi, notes: JSON.stringify({ reason: notes, before, after: { ...fields, photos } }), actor, at: new Date().toISOString(), source: 'Operator update', requestId: requestKey(req), photos });
  await commit(s); res.json(await snapshot());
});
workspaceRouter.post('/products/:id/update', async (req, res) => {
  const s = await getState();
  const p = s.products.find(p => p.id === req.params.id);
  must(p, 'Product not found.');
  applyUpdate(req, s, p);
  await commit(s); res.json(await snapshot());
});
// The same update for many products at once. Each product is checked on its own: the ones that cannot take the update are skipped and listed.
workspaceRouter.post('/products/bulk-update', async (req, res) => {
  const ids = req.body.ids, action = text(req.body.action);
  must(Array.isArray(ids) && ids.length >= 1 && ids.length <= 200 && ids.every((i: unknown) => typeof i === 'string'), 'Select between 1 and 200 products.');
  must(updatePermission[action] && !['Close product line', 'Reopen product line', 'Record vendor call-out'].includes(action), 'This update cannot be applied to many products at once.');
  requirePermission(req, updatePermission[action]);
  const s = await getState(), skipped: { id: string; name: string; error: string }[] = []; let updated = 0;
  for (const id of new Set<string>(ids)) {
    const p = s.products.find(x => x.id === id);
    if (!p) { skipped.push({ id, name: id, error: 'Product not found.' }); continue; }
    const before = structuredClone(p), activityCount = s.activity.length;
    try { applyUpdate(req, s, p); updated++; } catch (error) {
      if (!(error instanceof OperationError || error instanceof HttpError)) throw error;
      Object.assign(p, before); s.activity.splice(0, s.activity.length - activityCount); skipped.push({ id, name: p.name, error: error.message });
    }
  }
  if (updated) await commit(s);
  res.json({ ...(await snapshot()), bulk: { updated, skipped } });
});

workspaceRouter.post('/drafts', async (req, res) => {
  const s = await getState();
  const type = text(req.body.type) as Movement;
  must((movements as readonly string[]).includes(type), 'Choose a valid movement.');
  requirePermission(req, `movement.${type}`);
  const p = s.products.find(p => p.id === req.body.productId);
  must(p, 'Choose a matched product.');
  must(!p.closed, 'This product line is closed. Ask Management to reopen it first.');
  const quantity = integer(req.body.quantity, 1);
  must(Number.isSafeInteger(quantity) && quantity > 0 && quantity <= p.quantity, 'Enter a valid quantity within the order quantity.');
  const document = text(req.body.document, 200);
  must(document, 'Document reference is required.');
  const draft: Draft = { id: `DRAFT-${randomUUID().slice(0, 8)}`, productId: p.id, type, quantity, document, carton: text(req.body.carton, 100), shipment: text(req.body.shipment, 100), container: text(req.body.container, 100), notes: text(req.body.notes), confidence: text(req.body.confidence, 60) || 'Operator entry', status: 'Pending', createdAt: new Date().toISOString(), createdBy: actorOf(req, req.body.actor), evidence: text(req.body.evidence, 500) || undefined, requestId: requestKey(req) };
  const photos = Array.isArray(req.body.photos) ? req.body.photos : [];
  must(photos.length <= 8 && photos.every((v: unknown) => typeof v === 'string' && evidencePathPattern.test(v)), 'Attach up to 8 photos uploaded through the app.');
  must(new Set(photos).size === photos.length, 'The same photo was attached twice.');
  if (type === 'Container loading' || type === 'India receiving' || type === 'Customer delivery') must(photos.length >= 1, type === 'Container loading' ? 'Attach at least one photo of the goods loaded in the container.' : type === 'India receiving' ? 'Attach at least one carton photo of the goods received in India.' : 'Attach at least one carton photo of the goods delivered to the customer.');
  if (photos.length) draft.photos = photos;
  must(!duplicate(s, draft), 'This document movement is already in the official log.');
  must(!s.drafts.some(d => d.status === 'Pending' && d.productId === draft.productId && d.type === draft.type && d.document === draft.document), 'This document movement is already awaiting review.');
  s.drafts.unshift(draft); await commit(s); res.status(201).json(await snapshot());
});
// AI audit of an India receiving draft: loading photos from China against the photos taken on arrival. Advice only; the reviewer still decides.
workspaceRouter.post('/drafts/:id/audit', async (req, res) => {
  requirePermission(req, 'ai.use');
  const s = await getState(), d = s.drafts.find(d => d.id === req.params.id), p = d && s.products.find(p => p.id === d.productId);
  must(d && p && d.status === 'Pending' && d.type === 'India receiving', 'Only a pending India receiving draft can be audited.');
  const audit = await auditReceiving(s, d, p);
  // The AI call takes seconds: reload so the save is based on the latest workspace.
  const fresh = await getState(), target = fresh.drafts.find(x => x.id === d.id);
  must(target && target.status === 'Pending', 'This draft was reviewed while the audit was running.');
  target.audit = audit;
  fresh.activity.unshift({ id: randomUUID(), productId: d.productId, action: 'AI receiving audit', quantity: d.quantity, document: d.document, notes: `${audit.status}. ${audit.summary}`, actor: actorOf(req, req.body.actor) || 'AI audit', at: audit.at, source: 'AI audit' });
  await commit(fresh); res.json(await snapshot());
});
workspaceRouter.post('/drafts/:id/review', async (req, res) => {
  requirePermission(req, 'draft.review');
  const s = await getState(), d = s.drafts.find(d => d.id === req.params.id);
  must(d && d.status === 'Pending', 'This draft is missing or already reviewed.');
  const actor = actorOf(req, req.body.actor), decision = text(req.body.decision);
  must(actor, 'Enter the reviewer name.');
  must(decision === 'Approve' || decision === 'Reject', 'Choose Approve or Reject.');
  must(decision !== 'Approve' || d.audit?.status !== 'Mismatch' || req.body.acknowledgeAudit === true, 'The AI audit found a mismatch. Confirm that you checked the photos, or reject the draft and raise an exception.');
  if (decision === 'Approve') applyMovement(s, d, actor);
  d.status = decision === 'Approve' ? 'Approved' : 'Rejected'; d.reviewedBy = actor; d.reviewedAt = new Date().toISOString();
  if (decision === 'Reject') s.activity.unshift({ id: randomUUID(), productId: d.productId, action: 'Draft rejected', quantity: d.quantity, document: d.document, notes: d.notes, actor, at: d.reviewedAt, source: 'Operator review' });
  await commit(s); res.json(await snapshot());
});

// ---- exceptions: identify -> owner + deadline -> correction -> evidence -> close / reopen ----
workspaceRouter.post('/exceptions', async (req, res) => {
  requirePermission(req, 'exception.raise');
  const s = await getState(), actor = actorOf(req, req.body.actor);
  must(actor, 'Your name is required.');
  const deadline = date(text(req.body.deadline));
  raiseException(s, { productId: text(req.body.productId, 100), type: text(req.body.type, 100), description: text(req.body.description, 1000), quantity: req.body.quarantine === true ? integer(req.body.quantity, 0) : 0, quarantine: req.body.quarantine === true, owner: text(req.body.owner, 100), deadline, actor, requestId: requestKey(req) });
  await commit(s); res.status(201).json(await snapshot());
});
workspaceRouter.post('/exceptions/:id/update', async (req, res) => {
  requirePermission(req, 'exception.update');
  const s = await getState(), actor = actorOf(req, req.body.actor); must(actor, 'Your name is required.');
  updateException(s, req.params.id, { owner: text(req.body.owner, 100), deadline: date(text(req.body.deadline)), notes: text(req.body.notes, 1000), actor, requestId: requestKey(req) });
  await commit(s); res.json(await snapshot());
});
workspaceRouter.post('/exceptions/:id/resolve', async (req, res) => {
  requirePermission(req, 'exception.resolve');
  const s = await getState(), actor = actorOf(req, req.body.actor); must(actor, 'Your name is required.');
  resolveException(s, req.params.id, { notes: text(req.body.notes, 1000), disposition: text(req.body.disposition, 60), actor, requestId: requestKey(req) });
  await commit(s); res.json(await snapshot());
});
workspaceRouter.post('/exceptions/:id/reopen', async (req, res) => {
  requirePermission(req, 'exception.reopen');
  const s = await getState(), actor = actorOf(req, req.body.actor); must(actor, 'Your name is required.');
  reopenException(s, req.params.id, { notes: text(req.body.notes, 1000), actor, requestId: requestKey(req) });
  await commit(s); res.json(await snapshot());
});

workspaceRouter.post('/lead-times', async (req, res) => {
  requirePermission(req, 'leadtimes.edit');
  const s = await getState();
  const lead = s.leads.find(l => l.category === req.body.category && l.subcategory === req.body.subcategory);
  must(lead, 'Lead-time category not found.');
  for (const key of ['manufacturing', 'transit', 'chinaBuffer', 'consolidation', 'customs', 'delivery', 'safety'] as const) lead[key] = integer(req.body[key], 0, 730);
  lead.confirmation = integer(req.body.confirmation ?? lead.confirmation ?? 7, 0, 730);
  const actor = actorOf(req, req.body.actor); must(actor, 'Your name is required.');
  s.activity.unshift({ id: randomUUID(), productId: '', action: 'Lead times updated', quantity: 0, document: '', notes: `${lead.category} / ${lead.subcategory}: ${JSON.stringify(lead)}`, actor, at: new Date().toISOString(), source: 'Planning settings', requestId: requestKey(req) });
  await commit(s); res.json(await snapshot());
});
