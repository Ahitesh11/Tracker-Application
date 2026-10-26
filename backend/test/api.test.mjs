import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
test('HTTP validation, API queries, concurrency revisions and manual shipment updates',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'forma-api-'));process.env.FMS_DB_FILE=join(directory,'api.sqlite');process.env.FMS_STATE_FILE=join(directory,'absent.json');process.env.FMS_SEED_FILE=fileURLToPath(new URL('./fixtures/sample-workbook.json',import.meta.url));
  const {app}=await import('../dist/app.js');const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  async function get(path,status=200){const response=await fetch(base+path);assert.equal(response.status,status);return response.json();}
  try{
    assert.equal((await get('/api/health')).storage,'sqlite');assert.equal((await get('/api/ready')).ready,true);
    let response=await fetch(base+'/api/workspace/products',{method:'POST',headers:{'Content-Type':'application/json'},body:'{bad'});assert.equal(response.status,400);assert.ok((await response.json()).requestId);
    response=await fetch(base+'/api/workspace/products',{method:'POST',headers:{'Content-Type':'application/json'},body:'null'});assert.equal(response.status,400);
    response=await fetch(base+'/api/workspace/products',{method:'POST',body:'plain'});assert.equal(response.status,415);
    response=await fetch(base+'/api/workspace/products',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({notes:'x'.repeat(105000)})});assert.equal(response.status,413);
    const list=await get('/api/products?page=2&limit=4');assert.equal(list.items.length,4);assert.equal(list.total,15);assert.equal(list.page,2);
    await get('/api/products?page=zero',400);await get('/api/products?limit=1000',400);await get('/api/products?q=a&q=b',400);await get('/api/products/unknown',404);
    const filtered=await get('/api/products?pi=PI-2026-003');assert.equal(filtered.items.length,1);assert.equal(filtered.items[0].customer,'Customer B');
    const detail=await get('/api/products/'+filtered.items[0].id);assert.ok(detail.planning);assert.ok(Array.isArray(detail.activity));
    assert.equal((await get('/api/customers')).items.length,3);assert.equal((await get('/api/pis')).items.length,3);assert.ok((await get('/api/vendors')).items.length>0);
    const report=await get('/api/reports/summary'),inventory=await get('/api/inventory');assert.equal(inventory.items.reduce((n,p)=>n+p.ordered,0),report.ordered);assert.equal(report.remaining,report.ordered-report.delivered);
    assert.ok((await get('/api/approvals?status=Pending')).items.every(d=>d.status==='Pending'));assert.ok((await get('/api/alerts?severity=Critical')).items.every(a=>a.severity==='Critical'));
    const workspace=await get('/api/workspace');
    const shipment={id:'SHP-API-TEST',carrier:'Recorded carrier',tracking:'REF-123',status:'In Transit',actualDispatch:workspace.today,expectedArrival:'2027-01-01',actor:'Tester',notes:'Carrier document checked',revision:workspace.revision};
    response=await fetch(base+'/api/workspace/shipments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(shipment)});assert.equal(response.status,201);const saved=await response.json();assert.equal(saved.revision,workspace.revision+1);
    response=await fetch(base+'/api/workspace/shipments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(shipment)});assert.equal(response.status,409,'Old screen revision must not overwrite newer data');
    const shipmentList=await get('/api/shipments');assert.ok(shipmentList.items.some(s=>s.Shipment_ID==='SHP-API-TEST'));assert.ok((await get('/api/activity?q=Shipment')).items.some(a=>a.shipment==='SHP-API-TEST'));
    const spec=await get('/api/openapi.json');assert.equal(spec.openapi,'3.1.0');assert.ok(spec.paths['/api/workspace/drafts/{id}/review']);assert.equal((await fetch(base+'/api/docs')).status,200);
    response=await fetch(base+'/api/workspace',{headers:{Origin:'http://localhost:5173'}});assert.equal(response.headers.get('access-control-allow-origin'),'http://localhost:5173');assert.ok(response.headers.get('x-request-id'));
    assert.equal((await fetch(base+'/api/workspace',{headers:{Origin:'https://untrusted.example'}})).status,403);
  }finally{await new Promise(resolve=>server.close(resolve));const {closeDatabase}=await import('../dist/operations.js');closeDatabase();for(const name of readdirSync(directory))unlinkSync(join(directory,name));rmdirSync(directory);}
});
