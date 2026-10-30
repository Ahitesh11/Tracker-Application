// PI tables drawn with cell borders: rows, merged vendor cells, merged photo cells and text that spills over a cell.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/lib/pi-parser.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { parsePiPages } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

const H = 800;
const text = (str, x, cy) => ({ str, x, y: H - cy - 2.4, w: str.length * 4, h: 8 }); // cy: middle of the text, measured from the top of the page
const line = (top, x0 = 50, x1 = 560) => ({ x: x0, y: H - top - 0.2, w: x1 - x0, h: 0.4 });
const columns = { no: [100, 20], model: [120, 50], picture: [170, 50], desc: [220, 60], size: [280, 60], material: [340, 80], colour: [420, 40], unit: [460, 30], qty: [490, 30], remark: [520, 40] };
const headerCells = Object.values(columns).map(([x, w]) => ({ x, y: H - 80, w, h: 20 }));
const header = [['No.', 'no'], ['Model', 'model'], ['pictures', 'picture'], ['Description', 'desc'], ['Size', 'size'], ['material', 'material'], ['Colour', 'colour'], ['Unit', 'unit'], ['Qty', 'qty'], ['Remark', 'remark']].map(([label, key]) => text(label, columns[key][0] + 2, 70));
const row = (cy, cells) => Object.entries(cells).flatMap(([key, value]) => [].concat(value).map(([str, offset = 0]) => text(str, columns[key][0] + 2, cy + offset)));

test('rows, vendor cells, shared photos and spilled text come out right', () => {
  const page = {
    height: H, width: 600,
    cells: [...headerCells, line(80), line(110, 120), line(140), line(190)],
    pictures: [{ x: 175, y: H - 105, w: 40, h: 25 }], // sits in row 1; row 2 has none
    items: [
      text('ACME BUYER', 55, 70), ...header, text('SUPPLIER Co', 55, 125),
      // row 1: the material text has five lines and the last one falls inside row 2
      ...row(95, { model: [['M1']], desc: [['Sofa']], material: [['aa', -11], ['bb', -4], ['cc', 3], ['dd', 10], ['ee', 17]], unit: [['PCS']], qty: [['2']] }),
      // row 2: written after row 1, so its own text stays with it
      ...row(125, { model: [['M2']], desc: [['Chair']], material: [['xx', 0]], unit: [['PCS']], qty: [['1']], remark: [['note']] }),
    ],
  };
  const { rows, customer } = parsePiPages([page]);
  assert.equal(customer, 'ACME BUYER');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => [r.vendor, r.code, r.description, r.material, r.quantity]), [['SUPPLIER Co', 'M1', 'Sofa', 'aa bb cc dd ee', 2], ['SUPPLIER Co', 'M2', 'Chair', 'xx', 1]]);
  assert.ok(rows[0].picture && rows[0].picture.page === 0 && rows[0].picture.box[0] > 0.28 && rows[0].picture.box[2] > 0);
  assert.equal(rows[1].picture, undefined);
  assert.equal(rows[1].remark, 'note');
});

test('a vendor cell that continues on the next page keeps its name; a new vendor does not inherit it', () => {
  const body = (vendorText, cy) => ({ height: H, width: 600, cells: [...headerCells, line(80), line(110, 120), line(140)], pictures: [], items: [text('ACME BUYER', 55, 70), ...header, ...(vendorText ? [text(vendorText, 55, cy)] : []), ...row(95, { desc: [['A']], unit: [['PCS']], qty: [['1']] }), ...row(125, { desc: [['B']], unit: [['PCS']], qty: [['1']] })] });
  // page 2 has no header: the columns carry over from page 1. Its first vendor cell is open at the top, so it continues page 1's last vendor.
  const next = { height: H, width: 600, cells: [line(60), line(90, 120), line(120)], pictures: [], items: [...row(75, { desc: [['C']], unit: [['PCS']], qty: [['1']] }), ...row(105, { desc: [['D']], unit: [['PCS']], qty: [['1']] })] };
  const { rows } = parsePiPages([body('FIRST Ltd', 125), next]);
  assert.deepEqual(rows.map(r => [r.description, r.vendor]), [['A', 'FIRST Ltd'], ['B', 'FIRST Ltd'], ['C', 'FIRST Ltd'], ['D', 'FIRST Ltd']]);
  const other = { ...next, items: [text('SECOND Ltd', 55, 90), ...next.items] };
  const split = parsePiPages([body('FIRST Ltd', 125), other]).rows;
  assert.deepEqual(split.map(r => r.vendor), ['FIRST Ltd', 'FIRST Ltd', 'SECOND Ltd', 'SECOND Ltd']);
});
