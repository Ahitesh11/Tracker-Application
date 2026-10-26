import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';

test('workbook → production → partial approved logistics → persistent delivery', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'forma-test-'));
  process.env.FMS_STATE_FILE = join(directory, 'workspace.json');
  process.env.FMS_DB_FILE = join(directory, 'workspace.sqlite');
  process.env.FMS_SEED_FILE = fileURLToPath(new URL('./fixtures/sample-workbook.json', import.meta.url));
  delete process.env.AI_GATEWAY_API_KEY; delete process.env.VERCEL_OIDC_TOKEN;
  const mock = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if(req.url === '/api/tags') res.end(JSON.stringify({models:[{name:'test-model'}]}));
    else if(req.url === '/api/chat') { let body='';req.on('data',c=>body+=c);req.on('end',()=>{const data=JSON.parse(body);assert.equal(data.stream,false);assert.ok(data.messages[0].content.includes('Workspace data'));res.end(JSON.stringify({message:{content:'Verified Ollama adapter response'}}));}); }
    else {res.statusCode=404;res.end('{}');}
  });
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
  process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${mock.address().port}`;
  const {app} = await import('../dist/app.js');
  const server = app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api`;
  async function api(path,body,status=200,headers={}) {
    const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
    const result=await response.json();assert.equal(response.status,status,JSON.stringify(result));return result;
  }
  try {
    let s=await api('/workspace');
    assert.equal(s.products.length,15);assert.equal(new Set(s.products.map(p=>p.pi)).size,3);
    assert.equal(s.products.find(p=>p.id==='PRD-ORD20260087-02').china,3);
    assert.ok(s.alerts.some(a=>a.severity==='Review'));
    assert.equal(s.products[0].planning.logistics,72);
    assert.equal(s.products[0].planning.latestStart,'2026-10-05');
    const duplicate=s.drafts.find(d=>d.status==='Pending'&&d.duplicate);assert.ok(duplicate);
    await api(`/workspace/drafts/${duplicate.id}/review`,{actor:'Tester',decision:'Approve'},400);
    assert.equal((await api('/workspace')).products[0].china,s.products[0].china);
    await api(`/workspace/products/${s.products[0].id}/update`,{action:'Reconcile imported balances',actor:'Tester',notes:'Invalid correction',china:0,loaded:1,india:0,delivered:0},400);
    const reviewed=s.products[0];
    s=await api(`/workspace/products/${reviewed.id}/update`,{action:'Reconcile imported balances',actor:'Tester',notes:'Matched original warehouse receipt',document:'TEST-EVIDENCE',china:reviewed.china,loaded:reviewed.loaded,india:reviewed.india,delivered:reviewed.delivered});
    assert.ok(s.activity[0].notes.includes('Before:'));
    await api('/workspace',undefined,403,{Origin:'https://untrusted.example'});
    await api('/workspace/products',{name:'Incomplete'},400);
    s=await api('/workspace/products',{pi:'PI-TEST',order:'ORD-TEST',customer:'Test customer',vendor:'Test factory',name:'Test chairs',specs:'Integration test',dimensions:'40x50x90cm',category:'Furniture',subcategory:'Dining Chairs',quantity:6,required:'2027-06-30',actor:'Tester'},201);
    const p=s.products.find(p=>p.pi==='PI-TEST'),id=p.id;
    await api(`/workspace/products/${id}/update`,{action:'Start production',actor:'Tester',notes:'Must fail'},400);
    for(const action of ['Authorize production','Record instruction','Record acknowledgment','Start production','Complete production']) {
      s=await api(`/workspace/products/${id}/update`,{action,actor:'Tester',notes:action,date:s.today});
    }
    assert.equal(s.products.find(p=>p.id===id).production,'Production Completed');
    const before=s.products.find(p=>p.id===id).china;
    s=await api('/workspace/drafts',{productId:id,type:'China receiving',quantity:3,document:'TEST-CN-01',notes:'Partial receipt'},201);
    assert.equal(s.products.find(p=>p.id===id).china,before,'Draft must not change stock');
    const partial=s.drafts[0];
    s=await api(`/workspace/drafts/${partial.id}/review`,{actor:'Tester',decision:'Approve'});
    assert.equal(s.products.find(p=>p.id===id).china,3);
    await api(`/workspace/drafts/${partial.id}/review`,{actor:'Tester',decision:'Approve'},400);
    await api('/workspace/drafts',{productId:id,type:'China receiving',quantity:3,document:'TEST-CN-01'},400);
    await api('/workspace/drafts',{productId:id,type:'China receiving',quantity:2,document:'TEST-CN-01'},400);
    s=await api('/workspace/drafts',{productId:id,type:'Container loading',quantity:4,document:'TEST-OVER',shipment:'SHP-TEST',container:'TEST-CONT'},201);
    await api(`/workspace/drafts/${s.drafts[0].id}/review`,{actor:'Tester',decision:'Approve'},400);
    await api(`/workspace/drafts/${s.drafts[0].id}/review`,{actor:'Tester',decision:'Reject'});
    for(const [type,quantity,document] of [['China receiving',3,'TEST-CN-02'],['Container loading',6,'TEST-LOAD'],['India receiving',4,'TEST-IN-01'],['Customer delivery',2,'TEST-DEL-01'],['India receiving',2,'TEST-IN-02'],['Customer delivery',4,'TEST-DEL-02']]) {
      s=await api('/workspace/drafts',{productId:id,type,quantity,document,shipment:'SHP-TEST',container:'TEST-CONT',carton:'TEST-CTN',notes:'Verified evidence'},201);
      s=await api(`/workspace/drafts/${s.drafts[0].id}/review`,{actor:'Tester',decision:'Approve'});
    }
    const final=s.products.find(p=>p.id===id);assert.equal(final.delivered,6);assert.equal(final.planning.stage,'Delivered');assert.equal(final.planning.risk,'Completed');
    await api('/workspace/products',{pi:'PI-INVALID',order:'ORD-X',customer:'X',vendor:'X',name:'X',category:'Furniture',subcategory:'Sofa',quantity:1,required:'2027-02-30',actor:'Tester'},400);
    const lead=s.leads[0];s=await api('/workspace/lead-times',{...lead,manufacturing:lead.manufacturing+1,actor:'Tester'});assert.equal(s.leads[0].manufacturing,lead.manufacturing+1);
    const backup=await api('/workspace/backup');assert.equal(backup.products.length,16);assert.ok(backup.activity.some(a=>a.action==='Customer delivery'&&a.productId===id));
    const local=await api('/assistant/chat',{prompt:`Draft a vendor follow-up for ${id}`,provider:'local'});assert.match(local.text,/Follow-up draft \(not sent\)/);assert.ok(local.text.includes('Test factory'));
    const status=await api('/assistant/status');assert.equal(status.ollama,true);assert.deepEqual(status.models,['test-model']);
    const ollama=await api('/assistant/chat',{prompt:'Show pending work',provider:'ollama',model:'test-model'});assert.equal(ollama.text,'Verified Ollama adapter response');
    await api('/assistant/chat',{prompt:'Test',provider:'gateway'},400);
    const {getState}=await import('../dist/operations.js');assert.equal(getState().products.find(p=>p.id===id).delivered,6);
    const restart=spawnSync(process.execPath,['--input-type=module','-e',`const {getState}=await import('./backend/dist/operations.js'); console.log(getState().products.find(p=>p.id==='${id}').delivered);`],{cwd:new URL('../../',import.meta.url),env:process.env,encoding:'utf8'});
    assert.equal(restart.status,0,restart.stderr);assert.equal(restart.stdout.trim(),'6');
  } finally {
    await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>mock.close(resolve));
    const {closeDatabase}=await import('../dist/operations.js');closeDatabase();
    for(const filename of readdirSync(directory))unlinkSync(join(directory,filename));rmdirSync(directory);
  }
});
