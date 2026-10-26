import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {WorkspaceDatabase} from '../dist/database.js';

test('SQLite migration, rollback, audit protection and multi-connection conflict handling',()=>{
  const directory=mkdtempSync(join(tmpdir(),'forma-sqlite-')),legacy=join(directory,'legacy.json'),filename=join(directory,'workspace.sqlite');
  const product={id:'P1',pi:'PI1',order:'O1',customer:'Customer',vendor:'Vendor',quantity:5,china:2,loaded:1,india:0,delivered:0,notes:'Opening'};
  const seed={version:1,source:'Legacy workspace',importedAt:'2026-10-24',products:[product],leads:[{category:'Other',subcategory:'Default',manufacturing:40,transit:40,chinaBuffer:5,consolidation:5,customs:7,delivery:5,safety:10}],drafts:[],activity:[{id:'A1',productId:'P1',action:'Imported',document:'DOC1',at:'2026-10-24',quantity:0,notes:'Original audit',actor:'Operator',source:'Workbook'}],shipments:[],exceptions:[]};
  writeFileSync(legacy,JSON.stringify(seed));const original=readFileSync(legacy,'utf8');let one,two;
  try{
    one=new WorkspaceDatabase(filename,legacy,()=>{throw new Error('Legacy file must take precedence');});
    assert.equal(one.health().engine,'sqlite');assert.equal(one.read().products[0].notes,'Opening');
    two=new WorkspaceDatabase(filename,legacy,()=>seed);
    const stale=two.read(),next=one.read();next.products[0].notes='Saved by first connection';one.save(next);
    assert.throws(()=>two.save(stale),e=>e.status===409);
    assert.equal(two.read().products[0].notes,'Saved by first connection');
    const before=one.read(),invalid=structuredClone(before);invalid.products[0].loaded=4;
    assert.throws(()=>one.save(invalid),/CHECK constraint/);
    assert.deepEqual(one.read(),before,'Constraint failure must roll back every row and revision');
    const tampered=one.read();tampered.activity[0].actor='Changed';assert.throws(()=>one.save(tampered),e=>e.status===409);
    const removed=one.read();removed.products=[];assert.throws(()=>one.save(removed),e=>e.status===409);
    assert.equal(readFileSync(legacy,'utf8'),original,'Legacy JSON must remain unchanged');
    const db=new DatabaseSync(filename,{readOnly:true});assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(db.prepare('PRAGMA user_version').get().user_version,1);db.close();
  }finally{one?.close();two?.close();for(const name of readdirSync(directory))unlinkSync(join(directory,name));rmdirSync(directory);}
});
