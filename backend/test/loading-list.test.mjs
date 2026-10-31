// Loading list: read -> match -> pending -> controller "OK to All" -> Container loading, through the real HTTP API with an in-memory Supabase stand-in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultLeads } from '../dist/default-leads.js';

process.env.SUPABASE_URL = 'https://fake.supabase.co'; process.env.SUPABASE_ANON_KEY = 'k'; process.env.SUPABASE_RPC_SECRET = 's';
delete process.env.AUTH_PROVIDER; delete process.env.AUTH_USERS; delete process.env.OPENAI_API_KEY;
let state = null, revision = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const name = String(url).split('/rpc/')[1], args = JSON.parse(init.body), reply = (body) => new Response(JSON.stringify(body), { status: 200 });
  if (name === 'tracker_read') return reply(state && { ...state, revision });
  if (name === 'tracker_save') { revision += 1; state = structuredClone(args.p_state); return reply({ revision, newActivityIds: [] }); }
  return reply({ initialized: Boolean(state) });
};
const { app } = await import('../dist/app.js');
const server = app.listen(0); await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}/api/workspace`;
const call = async (path, body) => { const r = await realFetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actor: 'Tester', ...body }) }); return { status: r.status, body: await r.json() }; };
const lead = defaultLeads[0];
const product = (pi, name) => call('/products', { pi, order: 'O-1', customer: 'Cust', vendor: 'V', name, category: lead.category, subcategory: lead.subcategory, quantity: 10, required: '2027-12-01' });

test('loading list: nothing moves before the controller approves', async () => {
  await product('PI-1', 'Sofa SF-100'); await product('PI-1', 'Bed BD-200'); await product('PI-2', 'Sofa SF-100');
  state.products.forEach(p => { p.china = 10; p.calledOut = 10; p.authorization = 'Approved for Production'; p.production = 'Production Completed'; });
  const [sofa1, bed1, sofa2] = state.products.map(p => p.id);
  assert.equal((await call('/shipments', { id: 'SHP-1', carrier: 'Line', status: 'Planned', notes: 'booked' })).status, 201);

  const table = [['Model', 'Description', 'PI', 'Qty'], ['SF-100', 'Sofa', 'PI-1', '4'], ['BD-200', 'Bed', 'PI-1', '12'], ['SF-100', 'Sofa', '', '3'], ['ZZ-9', 'Unknown thing', '', '2'], ['SF-100', 'Sofa', 'PI-1', '1']];
  const read = await call('/loading-lists/interpret', { table });
  assert.equal(read.status, 200); assert.equal(read.body.source, 'table');
  assert.deepEqual(read.body.lines.map(l => l.status), ['Matched', 'Quantity issue', 'Ambiguous', 'Unmatched', 'Duplicate']);
  assert.equal(read.body.lines[0].productId, sofa1); assert.equal(read.body.lines[0].pi, 'PI-1');

  // the reviewer fixes the list: bed quantity, the ambiguous sofa goes to PI-2, the unknown and duplicate rows are removed
  const lines = [read.body.lines[0], { ...read.body.lines[1], quantity: 6 }, { ...read.body.lines[2], productId: sofa2 }];
  const bad = await call('/loading-lists', { shipment: 'SHP-X', container: 'C1', lines, source: 'table' });
  assert.equal(bad.status, 400);
  const saved = await call('/loading-lists', { shipment: 'SHP-1', container: 'MSKU123', fileName: 'list.xlsx', source: 'table', removed: 2, lines });
  assert.equal(saved.status, 201);
  const list = saved.body.loadingLists[0];
  assert.equal(list.status, 'Pending approval'); assert.deepEqual(list.lines.map(l => l.status), ['Matched', 'Matched', 'Matched']);
  assert.deepEqual(list.trail.map(t => t.event), ['AI interpretation', 'Manual corrections', 'Submitted for controller approval']);
  assert.ok(state.products.every(p => p.loaded === 0), 'no product moves before approval');

  const refused = await call(`/loading-lists/${list.id}/approve`, {});
  assert.equal(refused.status, 400); assert.match(refused.body.error, /OK to All/);
  assert.ok(state.products.every(p => p.loaded === 0));
  const approved = await call(`/loading-lists/${list.id}/approve`, { okToAll: true });
  assert.equal(approved.status, 200);
  assert.deepEqual([sofa1, bed1, sofa2].map(id => state.products.find(p => p.id === id).loaded), [4, 6, 3]);
  const moved = state.products.find(p => p.id === sofa1);
  assert.equal(moved.shipment, 'SHP-1'); assert.equal(moved.container, 'MSKU123');
  assert.equal(approved.body.products.find(p => p.id === sofa1).planning.stage, 'Container loading');
  assert.equal(state.activity.filter(a => a.action === 'Container loading' && a.document === list.id).length, 3);
  assert.equal(approved.body.loadingLists[0].status, 'Approved'); assert.equal(approved.body.loadingLists[0].trail.at(-1).event, 'Controller approval (OK to All)');
  assert.equal((await call(`/loading-lists/${list.id}/approve`, { okToAll: true })).status, 400, 'cannot be approved twice');
});

test('a list with flagged lines cannot be approved, and a failing line leaves everything untouched', async () => {
  state.products.forEach(p => { p.loaded = 0; p.shipment = ''; p.container = ''; });
  const [a, b] = state.products.map(p => p.id);
  const saved = await call('/loading-lists', { shipment: 'SHP-1', container: 'C2', source: 'ai', model: 'm', lines: [{ productId: a, suggested: a, quantity: 2, aiQuantity: 2, code: 'A' }, { productId: '', suggested: '', quantity: 1, aiQuantity: 1, code: 'ZZ' }] });
  const list = saved.body.loadingLists.find(l => l.container === 'C2');
  assert.equal(list.lines[1].status, 'Unmatched');
  const blocked = await call(`/loading-lists/${list.id}/approve`, { okToAll: true });
  assert.equal(blocked.status, 400); assert.match(blocked.body.error, /still need review/);
  // the China stock disappears after submission: approval re-checks and moves nothing
  const fix = await call(`/loading-lists/${list.id}/correct`, { lines: [{ id: list.lines[1].id, productId: b }] });
  assert.equal(fix.status, 200);
  state.products.find(p => p.id === b).china = 0;
  const failed = await call(`/loading-lists/${list.id}/approve`, { okToAll: true });
  assert.equal(failed.status, 400);
  assert.ok(state.products.every(p => p.loaded === 0), 'all or nothing');
  const rejected = await call(`/loading-lists/${list.id}/reject`, { notes: 'wrong container' });
  assert.equal(rejected.status, 200); assert.equal(rejected.body.loadingLists.find(l => l.id === list.id).status, 'Rejected');
});

test.after(() => server.close());

test('PI import: each row can carry its own required delivery date', async () => {
  const row = (name, required) => ({ vendor: 'V', name, quantity: 1, category: lead.category, subcategory: lead.subcategory, ...(required ? { required } : {}) });
  const head = { pi: 'PI-D', order: 'O-D', customer: 'Cust' };
  const noDate = await call('/products/bulk', { ...head, rows: [row('A', '2027-01-10'), row('B')] });
  assert.equal(noDate.status, 400); assert.match(noDate.body.error, /required delivery date/);
  const ok = await call('/products/bulk', { ...head, required: '2027-03-01', rows: [row('A', '2027-01-10'), row('B')] });
  assert.equal(ok.status, 201);
  assert.deepEqual(state.products.filter(p => p.pi === 'PI-D').map(p => p.required), ['2027-01-10', '2027-03-01']);
});

test('a bilingual packing list: header rows, merged marks, English and Chinese names, container number', async () => {
  await product('PI-W', 'Window'); await product('PI-W', 'Wooden door');
  state.products.filter(p => p.pi === 'PI-W').forEach(p => { p.china = 50; });
  const table = [['PACKING LIST'], ['', '', '', '', '', '', '', 'DATE:2026-9-18'], ['', '柜号：WHSU8216203 粤BFZ101'], [], ['CONTAISKHNER NO.柜号:WHSU8216203封号:WHA4029556'],
    ['Ctns Marks 唛头', 'MODEL型号', 'MADE OF 材质', 'PHOTO图片', 'Description of Goods 中文品名', 'Description of Goods 英文品名', 'Total Qty 总数', 'Total Ctns 件数', 'CBM立方', 'WT 重量'],
    ['ALOK-19', '', 'Aluminum alloy', '', '窗户', 'WINDOW', '23', '48', '10.24', '2850'],
    ['ASIF-14', '', 'Solid wood', '', '木门', 'Wooden door', '12', '12', '2.6', '1190'],
    ['', '', '', '', '', 'TOTAL', '35', '60', '', '']];
  const read = await call('/loading-lists/interpret', { table });
  assert.equal(read.status, 200); assert.equal(read.body.container, 'WHSU8216203');
  assert.deepEqual(read.body.lines.map(l => [l.code, l.quantity]), [['ALOK-19', 23], ['ASIF-14', 12]]);
  assert.deepEqual(read.body.lines.map(l => l.status), ['Matched', 'Matched']);
  assert.deepEqual(read.body.lines.map(l => l.pi), ['PI-W', 'PI-W']);
});

test('a carton mark such as SKY-5 is matched to the customer / PI "SKY", and edited text is matched again', async () => {
  const sky = await call('/products', { pi: 'SKY', order: 'O-S', customer: 'Sky Homes', vendor: 'V', name: 'Gate', category: lead.category, subcategory: lead.subcategory, quantity: 10, required: '2027-12-01' });
  assert.equal(sky.status, 201);
  await call('/products', { pi: 'OTHER', order: 'O-O', customer: 'Other', vendor: 'V', name: 'Gate', category: lead.category, subcategory: lead.subcategory, quantity: 10, required: '2027-12-01' });
  state.products.filter(p => p.name === 'Gate').forEach(p => { p.china = 10; });
  const skyId = state.products.find(p => p.pi === 'SKY').id;
  const table = [['Ctns Marks', 'MODEL', 'Description of Goods', 'Total Qty'], ['SKY-5', '', 'Gate', '3'], ['ZZ', '', 'Gate', '2']];
  const read = await call('/loading-lists/interpret', { table });
  assert.equal(read.body.lines[0].productId, skyId); assert.equal(read.body.lines[0].status, 'Matched');
  assert.equal(read.body.lines[1].status, 'Ambiguous'); // no mark hint: both Gate products fit
  const again = await call('/loading-lists/rematch', { code: 'sky-1', description: 'Gate' });
  assert.equal(again.body.productId, skyId);
});

test('Vendor call-out page: hold needs a reason, moves go to the China warehouse or to shipments', async () => {
  await call('/products', { pi: 'PI-CO', order: 'O-C', customer: 'Cust', vendor: 'V', name: 'Cabinet', category: lead.category, subcategory: lead.subcategory, quantity: 10, required: '2027-12-01' });
  const id = state.products.find(p => p.pi === 'PI-CO').id, p = () => state.products.find(x => x.id === id);
  const act = (action, extra = {}) => call('/products/callout-action', { ids: [id], action, ...extra });
  const early = await act('China warehouse'); assert.equal(early.body.bulk.updated, 0); assert.match(early.body.bulk.skipped[0].error, /Complete production/);
  Object.assign(p(), { authorization: 'Approved for Production', production: 'Production Completed' });
  const noReason = await act('Hold'); assert.equal(noReason.body.bulk.updated, 0); assert.match(noReason.body.bulk.skipped[0].error, /reason/);
  assert.equal((await act('Hold', { reason: 'Vendor quality check pending' })).body.bulk.updated, 1);
  assert.equal(p().hold, 'Vendor quality check pending'); assert.equal(p().china, 0);
  assert.ok(state.activity.some(a => a.action === 'Put on hold' && a.productId === id));
  assert.equal((await act('China warehouse', { quantity: 11 })).body.bulk.updated, 0, 'more than the order');
  assert.equal((await act('China warehouse', { quantity: 4 })).body.bulk.updated, 1);
  assert.deepEqual([p().china, p().calledOut, p().hold, p().destination], [4, 4, '', 'China warehouse']);
  assert.equal((await act('Shipments')).body.bulk.updated, 1);
  assert.deepEqual([p().china, p().calledOut, p().destination], [10, 10, 'Shipments']);
  assert.equal((await act('Shipments')).body.bulk.updated, 0, 'nothing left to move');
  assert.ok(state.activity.some(a => a.action === 'Moved to shipments'));
});
