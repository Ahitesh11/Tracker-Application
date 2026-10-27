import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getStage, plan, alerts, applyMovement, OperationError } from '../dist/operations.js';
import { defaultLeads } from '../dist/default-leads.js';
import { SupabaseStorage, ConflictError } from '../dist/storage.js';

const product = (extra = {}) => ({
  id: 'P1', pi: 'PI-1', order: 'O-1', customer: 'Customer', vendor: 'Vendor', name: 'Sofa', specs: '', dimensions: '', category: defaultLeads[0].category, subcategory: defaultLeads[0].subcategory,
  quantity: 10, unit: 'pcs', authorization: 'Approved for Production', production: 'Production Completed', required: '2027-06-01', originalRequired: '2027-06-01', expectedCompletion: '', instructionDate: '2026-01-01', ackDate: '2026-01-02',
  startDate: '2026-01-03', completionDate: '2026-02-01', china: 0, loaded: 0, india: 0, delivered: 0, calledOut: 0, owner: 'China Controller', nextAction: '', deadline: '2027-01-01', shipment: '', container: '', notes: '', issues: [], ...extra,
});
const store = (products) => ({ version: 1, revision: 1, source: 'test', importedAt: '2026-01-01', products, leads: defaultLeads, drafts: [], activity: [], shipments: [], exceptions: [] });
const draft = (type, quantity, extra = {}) => ({ id: 'D', productId: 'P1', type, quantity, document: 'DOC-' + type + quantity, carton: '', shipment: '', container: '', notes: '', confidence: '', status: 'Pending', createdAt: '', ...extra });

test('stage follows the physical quantities', () => {
  assert.equal(getStage(product()), 'Ready at vendor');
  assert.equal(getStage(product({ china: 4 })), 'China warehouse');
  assert.equal(getStage(product({ china: 4, loaded: 4 })), 'In transit');
  assert.equal(getStage(product({ china: 4, loaded: 4, india: 2 })), 'India warehouse');
  assert.equal(getStage(product({ china: 10, loaded: 10, india: 10, delivered: 10 })), 'Delivered');
  assert.equal(getStage(product({ authorization: 'Not Reviewed', production: 'Not Started' })), 'Awaiting authorization');
});

test('backward planning subtracts logistics and manufacturing from the required date', () => {
  const s = store([product()]); const p = plan(s.products[0], s, '2026-10-26');
  const lead = defaultLeads[0], logistics = lead.transit + lead.chinaBuffer + lead.consolidation + lead.customs + lead.delivery + lead.safety;
  assert.equal(p.logistics, logistics); assert.equal(p.manufacturing, lead.manufacturing);
  const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
  assert.equal(days(p.latestComplete, '2027-06-01'), logistics); assert.equal(days(p.latestStart, p.latestComplete), lead.manufacturing);
});

test('partial movements post once and cannot exceed the previous stage', () => {
  const s = store([product()]);
  applyMovement(s, draft('China receiving', 6), 'Reviewer'); assert.equal(s.products[0].china, 6);
  assert.throws(() => applyMovement(s, draft('China receiving', 6, { document: 'DOC-2' }), 'Reviewer'), /exceeds remaining/);
  assert.throws(() => applyMovement(s, draft('India receiving', 1), 'Reviewer'), /exceeds loaded/);
  applyMovement(s, draft('Container loading', 4, { shipment: 'SHP', container: 'CNT' }), 'Reviewer'); assert.equal(s.products[0].loaded, 4);
  applyMovement(s, draft('India receiving', 4), 'Reviewer'); applyMovement(s, draft('Customer delivery', 3), 'Reviewer');
  assert.deepEqual([s.products[0].china, s.products[0].loaded, s.products[0].india, s.products[0].delivered], [6, 4, 4, 3]);
  assert.throws(() => applyMovement(s, draft('China receiving', 6), 'Reviewer'), OperationError); // same document twice
  assert.equal(s.activity.length, 4); assert.ok(s.activity.every(a => a.actor === 'Reviewer'));
});

test('alerts flag missing acknowledgment, loading and delivery work', () => {
  const s = store([product({ china: 5, loaded: 2, india: 2, delivered: 0 }), product({ id: 'P2', production: 'Instruction Sent', completionDate: '', instructionDate: '2026-01-01', ackDate: '' })]);
  const titles = alerts(s, '2026-10-26').map(a => a.title);
  for (const expected of ['Warehouse goods not loaded', 'Customer delivery pending', 'Vendor acknowledgment overdue']) assert.ok(titles.includes(expected), expected);
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
