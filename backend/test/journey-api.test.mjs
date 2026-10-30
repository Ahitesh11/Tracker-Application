// The nine-stage journey rules, exercised through the real HTTP API with an in-memory stand-in for Supabase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultLeads } from '../dist/default-leads.js';

process.env.SUPABASE_URL = 'https://fake.supabase.co'; process.env.SUPABASE_ANON_KEY = 'k'; process.env.SUPABASE_RPC_SECRET = 's';
delete process.env.AUTH_PROVIDER; delete process.env.AUTH_USERS; // open mode: the actor comes from the request body
let state = null, revision = 0;
const realFetch = globalThis.fetch; // the test client; the app's Supabase calls go to the stand-in
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
const photo = 'product/abc-123.jpg';
const lead = defaultLeads[0];

test('the nine-stage journey rules', async (t) => {
  const created = await call('/products', { pi: 'PI-9', order: 'O-9', customer: 'C', vendor: 'V', name: 'Sofa', category: lead.category, subcategory: lead.subcategory, quantity: 5, required: '2027-12-01' });
  assert.equal(created.status, 201);
  const p = () => state.products[0], id = () => p().id;
  const update = (action, extra = {}) => call(`/products/${id()}/update`, { action, notes: 'note', ...extra });

  assert.equal(p().measurementDate, ''); assert.equal(p().nextAction, 'Finalise measurement');
  const early = await update('Authorize production');
  assert.equal(early.status, 400); assert.match(early.body.error || early.body.message, /Finalise the measurement/);
  assert.equal((await update('Finalise measurement')).status, 200); assert.ok(p().measurementDate);
  assert.match((await update('Finalise measurement')).body.error || '', /already finalised/);
  assert.equal((await update('Authorize production')).status, 200); assert.equal(p().authorization, 'Approved for Production');
  await update('Record instruction'); await update('Record acknowledgment');

  const noProof = await update('Start production');
  assert.equal(noProof.status, 400); assert.match(noProof.body.error, /photo proving production has started/);
  assert.equal(p().startDate, '');
  assert.equal((await update('Start production', { photos: ['not a path'] })).status, 400);
  assert.equal((await update('Start production', { photos: [photo] })).status, 200); assert.ok(p().startDate);
  const noDone = await update('Complete production');
  assert.equal(noDone.status, 400); assert.match(noDone.body.error, /photo proving production is complete/);
  assert.equal((await update('Complete production', { photos: [photo] })).status, 200); assert.equal(p().production, 'Production Completed');
  assert.deepEqual(state.activity.find(a => a.action === 'Start production').photos, [photo]);

  await update('Record vendor call-out', { quantity: 5 });
  const draft = (type, extra = {}) => call('/drafts', { productId: id(), type, quantity: 1, document: `DOC-${type}`, ...extra });
  assert.match((await draft('Customer delivery')).body.error, /carton photo/);
  assert.match((await draft('India receiving')).body.error, /carton photo/);
  assert.equal((await draft('Customer delivery', { photos: [photo] })).status, 201);
});

test.after(() => server.close());
