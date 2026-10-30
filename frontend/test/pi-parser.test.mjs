import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/lib/pi-parser.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { parsePiPages } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const item = (str, x, y) => ({ str, x, y: 800-y, w: 30, h: 10 });
test('explicit supplier columns stay mapped to their own product rows', () => {
  const items = [item('Supplier',0,50),item('Model',100,50),item('Description',200,50),item('Unit',300,50),item('Qty',400,50),
    item('Factory A',0,90),item('A1',100,90),item('Chair',200,90),item('pcs',300,90),item('12',400,90),
    item('Factory B',0,130),item('B1',100,130),item('Table',200,130),item('pcs',300,130),item('bad',400,130)];
  const { rows } = parsePiPages([{height:800,items}]);
  assert.deepEqual(rows.map(r=>r.vendor), ['Factory A','Factory B']);
  assert.deepEqual(rows.map(r=>r.quantity), [12,0]);
});
