import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getStage, plan, alerts, applyMovement, recordCallOut, raiseException, resolveException, reopenException, updateException, closeProduct, reopenProduct, seenRequest, normalize, today, OperationError } from '../dist/operations.js';
import { defaultLeads } from '../dist/default-leads.js';
import { SupabaseStorage, ConflictError } from '../dist/storage.js';
import { parseUsers, can, signSession, verifySession, permissionsFor } from '../dist/auth.js';

const product = (extra = {}) => ({
  id: 'P1', pi: 'PI-1', order: 'O-1', customer: 'Customer', vendor: 'Vendor', name: 'Sofa', specs: '', dimensions: '', category: defaultLeads[0].category, subcategory: defaultLeads[0].subcategory,
  quantity: 10, unit: 'pcs', authorization: 'Approved for Production', production: 'Production Completed', required: '2027-06-01', originalRequired: '2027-06-01', expectedCompletion: '', instructionDate: '2026-01-01', ackDate: '2026-01-02',
  startDate: '2026-01-03', completionDate: '2026-02-01', china: 0, loaded: 0, india: 0, delivered: 0, calledOut: 10, owner: 'China Controller', nextAction: '', deadline: '2027-01-01', shipment: '', container: '', notes: '', issues: [],
  calloutDate: '2026-02-02', vendorCommitDate: '', quarantined: 0, closed: '', closedBy: '', closedReason: '', ...extra,
});
const store = (products) => ({ version: 1, revision: 1, source: 'test', importedAt: '2026-01-01', products, leads: defaultLeads.map(l => ({ ...l })), drafts: [], activity: [], shipments: [], exceptions: [] });
const draft = (type, quantity, extra = {}) => ({ id: 'D', productId: 'P1', type, quantity, document: 'DOC-' + type + quantity, carton: '', shipment: '', container: '', notes: '', confidence: '', status: 'Pending', createdAt: '', ...extra });
const future = () => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 30); return d.toISOString().slice(0, 10); };

test('stage follows the physical quantities', () => {
  assert.equal(getStage(product()), 'Ready at vendor');
  assert.equal(getStage(product({ china: 4 })), 'China warehouse');
  assert.equal(getStage(product({ china: 4, loaded: 4 })), 'In transit');
  assert.equal(getStage(product({ china: 4, loaded: 4, india: 2 })), 'India warehouse');
  assert.equal(getStage(product({ china: 10, loaded: 10, india: 10, delivered: 10 })), 'Delivered');
  assert.equal(getStage(product({ china: 10, loaded: 10, india: 10, delivered: 10, closed: '2026-10-01' })), 'Closed');
  assert.equal(getStage(product({ authorization: 'Not Reviewed', production: 'Not Started' })), 'Awaiting measurement');
  assert.equal(getStage(product({ authorization: 'Not Reviewed', production: 'Not Started', measurementDate: '2026-01-01' })), 'Awaiting authorization');
});

test('backward planning: customer date minus logistics, manufacturing and the 7-day confirmation buffer', () => {
  const s = store([product()]); const p = plan(s.products[0], s, '2026-10-26');
  const lead = defaultLeads[0], logistics = lead.transit + lead.chinaBuffer + lead.consolidation + lead.customs + lead.delivery + lead.safety;
  const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
  assert.equal(p.logistics, logistics); assert.equal(p.manufacturing, lead.manufacturing);
  assert.equal(days(p.latestComplete, '2027-06-01'), logistics); assert.equal(days(p.latestStart, p.latestComplete), lead.manufacturing);
  assert.equal(p.confirmation, 7); assert.equal(days(p.latestInstruction, p.latestStart), 7);
  assert.equal(`${lead.manufacturing} + ${logistics}`, '45 + 72'); // the blueprint's sofa example: 117 days
});

test('partial movements post once and cannot exceed the previous stage', () => {
  const s = store([product()]);
  applyMovement(s, draft('China receiving', 6), 'Reviewer'); assert.equal(s.products[0].china, 6);
  assert.throws(() => applyMovement(s, draft('China receiving', 6, { document: 'DOC-2' }), 'Reviewer'), /exceeds the called-out/);
  assert.throws(() => applyMovement(s, draft('India receiving', 1), 'Reviewer'), /exceeds loaded/);
  applyMovement(s, draft('Container loading', 4, { shipment: 'SHP', container: 'CNT' }), 'Reviewer'); assert.equal(s.products[0].loaded, 4);
  applyMovement(s, draft('India receiving', 4), 'Reviewer'); applyMovement(s, draft('Customer delivery', 3), 'Reviewer');
  assert.deepEqual([s.products[0].china, s.products[0].loaded, s.products[0].india, s.products[0].delivered], [6, 4, 4, 3]);
  assert.throws(() => applyMovement(s, draft('China receiving', 6), 'Reviewer'), OperationError); // same document twice
  assert.equal(s.activity.length, 4); assert.ok(s.activity.every(a => a.actor === 'Reviewer'));
});

test('vendor call-out must come before China receiving and cannot exceed the order', () => {
  const s = store([product({ calledOut: 0, calloutDate: '' })]); const p = s.products[0];
  assert.throws(() => applyMovement(s, draft('China receiving', 2), 'R'), /called-out quantity/);
  recordCallOut(p, 4, '2026-10-01', '2026-10-10'); assert.equal(p.calledOut, 4); assert.equal(p.vendorCommitDate, '2026-10-10');
  applyMovement(s, draft('China receiving', 3, { document: 'A' }), 'R');
  assert.throws(() => applyMovement(s, draft('China receiving', 2, { document: 'B' }), 'R'), /called-out quantity/); // 3 received + 2 > 4 called out
  assert.throws(() => recordCallOut(p, 7, '2026-10-02', ''), /exceeds the order/);
  assert.throws(() => recordCallOut(p, 1, '2026-10-05', '2026-10-01'), /commitment/);
  assert.throws(() => recordCallOut(product({ production: 'In Production' }), 1, '2026-10-01', ''), /Complete production/);
  const titles = alerts(s, '2026-10-26').map(a => a.title);
  assert.ok(titles.includes('Called-out goods not received')); assert.ok(titles.includes('Vendor call-out pending'));
});

test('damage quarantines stock, blocks loading, and is released or removed when resolved', () => {
  const s = store([product({ china: 6 })]); const p = s.products[0];
  assert.throws(() => raiseException(s, { productId: 'P1', type: 'Damage', description: 'x', quantity: 7, quarantine: true, owner: 'Li', deadline: future(), actor: 'A' }), /Only 6 units/);
  const id = raiseException(s, { productId: 'P1', type: 'Damage', description: 'Scratched legs', quantity: 2, quarantine: true, owner: 'Li', deadline: future(), actor: 'A', requestId: 'req-damage-1' });
  assert.equal(p.quarantined, 2); assert.equal(s.exceptions[0].Status, 'Open'); assert.ok(seenRequest(s, 'req-damage-1'));
  assert.throws(() => applyMovement(s, draft('Container loading', 5, { shipment: 'S', container: 'C' }), 'R'), /available China warehouse quantity \(4 available, 2 in quarantine\)/);
  applyMovement(s, draft('Container loading', 4, { shipment: 'S', container: 'C', document: 'L' }), 'R');
  assert.throws(() => resolveException(s, id, { notes: 'fixed', disposition: '', actor: 'A' }), /release to stock or remove/);
  assert.ok(alerts(s, today()).some(a => a.title.startsWith('Damage')));
  resolveException(s, id, { notes: 'Supplier will replace; photos checked', disposition: 'Remove from stock', actor: 'A' });
  assert.equal(p.quarantined, 0); assert.equal(p.china, 4); assert.equal(p.calledOut, 8); assert.equal(s.exceptions[0].Status, 'Resolved');
  reopenException(s, id, { notes: 'Replacement also damaged', actor: 'M' }); assert.equal(s.exceptions[0].Status, 'Open');
  resolveException(s, id, { notes: 'Second fix confirmed', disposition: '', actor: 'A' }); assert.equal(p.china, 4, 'a reopened exception must not remove stock twice'); reopenException(s, id, { notes: 'x', actor: 'M' });
  updateException(s, id, { owner: 'Wang', deadline: future(), notes: 'Reassigned', actor: 'M' }); assert.equal(s.exceptions[0].Responsible_Person, 'Wang');
  assert.throws(() => raiseException(s, { productId: 'P1', type: 'Late vendor', description: 'x', quantity: 1, quarantine: true, owner: 'Li', deadline: future(), actor: 'A' }), /Only Damage or Shortage/);
  assert.throws(() => raiseException(s, { productId: 'P1', type: 'Other', description: 'x', quantity: 0, quarantine: false, owner: 'Li', deadline: '2020-01-01', actor: 'A' }), /today or later/);
});

test('customer return reduces delivered quantity and cannot exceed what was delivered', () => {
  const s = store([product({ china: 10, loaded: 10, india: 10, delivered: 3 })]);
  assert.throws(() => applyMovement(s, draft('Customer return', 4), 'R'), /exceeds delivered/);
  applyMovement(s, draft('Customer return', 2), 'R'); assert.equal(s.products[0].delivered, 1); assert.equal(s.products[0].india, 10);
  assert.match(s.products[0].nextAction, /returned units/);
});

test('closing a product line needs a clean balance; short-close needs confirmation; Management can reopen', () => {
  const s = store([product({ china: 6, loaded: 6, india: 6, delivered: 6 })]); const p = s.products[0];
  assert.throws(() => closeProduct(s, p, { shortClose: false, notes: 'n', actor: 'A', at: '2026-10-20' }), /never delivered/);
  s.exceptions.push({ Exception_ID: 'E', Product_ID: 'P1', Status: 'Open' });
  assert.throws(() => closeProduct(s, p, { shortClose: true, notes: 'n', actor: 'A', at: '2026-10-20' }), /open exceptions/);
  s.exceptions[0].Status = 'Resolved'; s.drafts.push(draft('Customer delivery', 1));
  assert.throws(() => closeProduct(s, p, { shortClose: true, notes: 'n', actor: 'A', at: '2026-10-20' }), /pending movement drafts/);
  s.drafts.length = 0; p.india = 7;
  assert.throws(() => closeProduct(s, p, { shortClose: true, notes: 'n', actor: 'A', at: '2026-10-20' }), /still in a warehouse/);
  p.india = 6;
  closeProduct(s, p, { shortClose: true, notes: 'Customer cancelled the rest', actor: 'A', at: '2026-10-20' });
  assert.equal(getStage(p), 'Closed'); assert.match(p.closedReason, /Short-closed with 4 pcs/);
  assert.throws(() => applyMovement(s, draft('Customer delivery', 1), 'R'), /closed/);
  assert.equal(alerts(s, '2026-10-26').length, 0);
  reopenProduct(p); assert.equal(p.closed, ''); assert.notEqual(getStage(p), 'Closed');
});

test('alerts flag missing acknowledgment, late instruction, loading and delivery work', () => {
  const s = store([product({ china: 5, loaded: 2, india: 2, delivered: 0 }), product({ id: 'P2', production: 'Not Started', completionDate: '', instructionDate: '', ackDate: '', required: '2026-11-01' })]);
  const titles = alerts(s, '2026-10-26').map(a => a.title);
  for (const expected of ['Warehouse goods not loaded', 'Customer delivery pending', 'Production instruction pending']) assert.ok(titles.includes(expected), expected);
  assert.equal(alerts(s, '2026-10-26').find(a => a.title === 'Production instruction pending').severity, 'Critical');
});

test('older saved products get safe defaults', () => {
  const s = normalize({ ...store([]), products: [{ id: 'X', quantity: 1 }], leads: [{ category: 'A', subcategory: 'B' }] });
  assert.deepEqual([s.products[0].calledOut, s.products[0].quarantined, s.products[0].closed, s.leads[0].confirmation], [0, 0, '', 7]);
});

test('login: users and roles, signed sessions, and what each role may do', () => {
  const users = parseUsers('ravi:india:pass:word, li:china:p2\nwh:warehouse:p3;boss:management:p4');
  assert.deepEqual(users.map(u => [u.name, u.role, u.password]), [['ravi', 'india', 'pass:word'], ['li', 'china', 'p2'], ['wh', 'warehouse', 'p3'], ['boss', 'management', 'p4']]);
  assert.throws(() => parseUsers('bad:nobody:x'), /unknown role/); assert.throws(() => parseUsers('onlyname'), /name:role:password/);
  assert.ok(can('india', 'production.authorize') && !can('china', 'production.authorize'));
  assert.ok(can('china', 'callout') && !can('warehouse', 'callout'));
  assert.ok(can('warehouse', 'movement.China receiving') && !can('warehouse', 'draft.review'));
  assert.ok(can('management', 'exception.reopen') && !can('india', 'exception.reopen'));
  assert.ok(permissionsFor('management').length > permissionsFor('warehouse').length);
  process.env.APP_USERS = 'ravi:india:x'; process.env.SESSION_SECRET = 'unit-test-secret';
  try {
    const token = signSession({ name: 'ravi', role: 'india' });
    assert.deepEqual(verifySession(token), { name: 'ravi', role: 'india' });
    assert.equal(verifySession(token.slice(0, -2) + 'xx'), null);                                    // tampered signature
    assert.equal(verifySession(signSession({ name: 'ravi', role: 'india' }, Date.now() - 13 * 3600e3)), null); // expired
    assert.equal(verifySession(signSession({ name: 'ghost', role: 'india' })), null);                // user not in APP_USERS
    assert.equal(verifySession(undefined), null);
  } finally { delete process.env.APP_USERS; delete process.env.SESSION_SECRET; }
});

test('Supabase client maps conflicts, bad secrets and a missing schema to clear errors', async () => {
  const original = globalThis.fetch;
  const reply = (status, body) => async () => ({ ok: status < 400, status, json: async () => body });
  const storage = new SupabaseStorage({ url: 'https://x.supabase.co', key: 'k', secret: 's' }, () => store([]));
  try {
    globalThis.fetch = reply(400, { message: 'CONFLICT: Workspace changed since you loaded it. Refresh and try again.' });
    await assert.rejects(storage.save(store([])), error => error instanceof ConflictError && error.status === 409);
    globalThis.fetch = reply(400, { message: 'UNAUTHORIZED: invalid backend secret' });
    await assert.rejects(storage.read(), /SUPABASE_RPC_SECRET/);
    globalThis.fetch = reply(404, { message: 'Could not find the function public.tracker_read(p_secret) in the schema cache' });
    await assert.rejects(storage.read(), /schema\.sql/);
    let sent; globalThis.fetch = async (url, init) => { sent = { url, body: JSON.parse(init.body), headers: init.headers }; return { ok: true, status: 200, json: async () => ({ revision: 2, newActivityIds: ['a1'] }) }; };
    assert.deepEqual(await storage.save({ ...store([]), revision: 1 }), ['a1']);
    assert.equal(sent.url, 'https://x.supabase.co/rest/v1/rpc/tracker_save'); assert.equal(sent.body.p_secret, 's'); assert.equal(sent.body.p_expected_revision, 1); assert.equal(sent.headers.apikey, 'k');
  } finally { globalThis.fetch = original; }
});

test('Supabase privileges come from an active database profile, not user metadata', async () => {
  const { supabaseUser } = await import('../dist/auth.js');
  const originalFetch = globalThis.fetch;
  const oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL = 'https://example.supabase.co'; process.env.SUPABASE_ANON_KEY = 'test-key';
  let active = true;
  globalThis.fetch = async url => new Response(JSON.stringify(String(url).includes('/auth/v1/user')
    ? { id: 'user-id', email: 'user@example.com', user_metadata: { role: 'management' } }
    : [{ display_name: 'China Operator', role: 'china', active }]));
  try {
    assert.deepEqual(await supabaseUser('token'), { name: 'China Operator', role: 'china' });
    active = false; assert.equal(await supabaseUser('token'), null);
    assert.equal(can('warehouse', 'product.edit'), false);
    assert.equal(can('china', 'product.edit'), true);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = oldKey;
  }
});

test('normal usernames map to internal Auth identities without personal email', async () => {
  const { usernameIdentity } = await import('../dist/auth.js');
  assert.equal(usernameIdentity(' Ravi '), 'ravi@users.tracker.internal');
  assert.throws(() => usernameIdentity('ravi@gmail.com'));
  assert.throws(() => usernameIdentity('ab'));
});

test('page restrictions limit operations in addition to role privileges', async () => {
  const { userCan } = await import('../dist/auth.js');
  const user = { name: 'Delivery Operator', role: 'india', pages: ['/delivery'] };
  assert.equal(userCan(user, 'movement.Customer delivery'), true);
  assert.equal(userCan(user, 'product.create'), false);
  assert.equal(userCan(user, 'users.manage'), false);
  assert.equal(userCan({ name: 'Admin', role: 'management' }, 'users.manage'), true);
});

test('measurement comes first: stage, alert and legacy defaults', () => {
  const raw = product({ authorization: 'Not Reviewed', production: 'Not Started', completionDate: '', calledOut: 0 }); delete raw.measurementDate;
  const s = normalize(store([raw])); assert.equal(s.products[0].measurementDate, ''); // older records get a safe default
  assert.equal(getStage(s.products[0]), 'Awaiting measurement');
  let titles = alerts(s, '2026-10-26').map(a => a.title);
  assert.ok(titles.includes('Measurement not finalised')); assert.ok(!titles.includes('Authorization required'));
  s.products[0].measurementDate = '2026-10-20';
  assert.equal(getStage(s.products[0]), 'Awaiting authorization');
  titles = alerts(s, '2026-10-26').map(a => a.title);
  assert.ok(titles.includes('Authorization required')); assert.ok(!titles.includes('Measurement not finalised'));
});
