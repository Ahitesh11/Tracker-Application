/** Reads the product rows out of a PI (proforma invoice) PDF. Pure functions: pdf text items in, rows out. */
export interface TextItem { str: string; x: number; y: number; w: number; h: number }
/** A picture placed on a PDF page, in PDF points (y counts up from the bottom). */
export interface PagePicture { x: number; y: number; w: number; h: number }
export interface PiPage { height: number; items: TextItem[]; width?: number; pictures?: PagePicture[]; cells?: PagePicture[] }
/** Where a row's product photo sits: 0-based page and [left, top, width, height] as fractions of that page. */
export interface PiPicture { page: number; box: [number, number, number, number] }
export interface PiRow { vendor: string; code: string; description: string; size: string; material: string; colour: string; unit: string; quantity: number; picture?: PiPicture; remark?: string }
export interface PiResult { rows: PiRow[]; customer: string; pages: number }

type Column = 'vendor' | 'model' | 'desc' | 'size' | 'material' | 'colour' | 'unit' | 'qty';
const headerWords: [Column, RegExp][] = [
  ['vendor', /^(vendor|supplier|factory|brand)(\s*name)?$|\u4f9b\u5e94\u5546|\u5382\u5bb6|\u54c1\u724c/i],
  ['model', /product\s*name|型号|^model/i], ['desc', /description|品名/i], ['size', /^size$|尺寸|l\*w\*h/i],
  ['material', /material|材质/i], ['colour', /colou?r|颜色/i], ['unit', /^unit|单位/i], ['qty', /^qty|数量/i],
];
const unitWord = /^(pcs|pc|set|sets|pair|pairs)\.?$/i;
const centre = (i: TextItem) => i.x + i.w / 2;
const clean = (items: TextItem[]) => items.slice().sort((a, b) => a.y - b.y || a.x - b.x).map(i => i.str.trim()).filter(Boolean).join(' ').replace(/-\s+/g, '-').replace(/\s+/g, ' ').trim();
const median = (values: number[]) => { const v = values.slice().sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : 0; };

interface Layout { centres: Partial<Record<Column, number>>; left: number; bottom: number; top: number; customer: string }
/** Finds the table header: the x position of each column and where the table body starts (y grows downwards). */
function findHeader(items: TextItem[]): Layout | undefined {
  const hits = items.flatMap(i => headerWords.filter(([, re]) => re.test(i.str.trim())).map(([column]) => ({ column, item: i })));
  const anchor = hits.find(h => h.column === 'desc') || hits.find(h => h.column === 'qty');
  if (!anchor) return undefined;
  const band = hits.filter(h => Math.abs(h.item.y - anchor.item.y) < Math.max(40, anchor.item.h * 3));
  const centres: Partial<Record<Column, number>> = {};
  for (const column of new Set(band.map(h => h.column))) { const list = band.filter(h => h.column === column).map(h => centre(h.item)); centres[column] = list.reduce((a, b) => a + b, 0) / list.length; }
  if (!centres.desc || !centres.qty || !centres.unit) return undefined;
  const header = band.map(h => h.item), top = Math.min(...header.map(i => i.y - i.h)), bottom = Math.max(...header.map(i => i.y));
  const modelLeft = Math.min(...band.filter(h => h.column === 'model' || h.column === 'desc').map(h => h.item.x));
  const left = band.some(h => h.column === 'vendor') ? Math.min(...header.map(i => i.x)) : band.some(h => h.column === 'model') ? modelLeft : Math.min(...header.map(i => i.x));
  const customer = clean(items.filter(i => i.y >= top && i.y <= bottom + 2 && i.x + i.w <= left + 1 && !/^(no\.?|序号)$/i.test(i.str.trim())));
  return { centres, left, bottom, top, customer };
}

/** Which column an x position belongs to: split halfway between neighbouring header centres. */
function columnOf(x: number, layout: Layout): Column | 'left' {
  if (x < layout.left) return 'left';
  const entries = (Object.entries(layout.centres) as [Column, number][]).sort((a, b) => a[1] - b[1]);
  let found = entries[0][0];
  for (let i = 1; i < entries.length; i++) if (x >= (entries[i - 1][1] + entries[i][1]) / 2) found = entries[i][0];
  return found;
}

// ---- tables drawn with cell borders: the horizontal border lines give exact rows, merged vendor cells and merged photo cells ----
type GridKind = 'no' | 'model' | 'picture' | 'desc' | 'size' | 'material' | 'colour' | 'unit' | 'qty' | 'remark';
const gridWords: [GridKind, RegExp][] = [
  ['picture', /picture|图片/i], ['desc', /description|品名/i], ['size', /^size|尺寸|l\*w\*h/i], ['material', /material|材质/i], ['colour', /colou?r|颜色/i],
  ['unit', /^unit|单\s*位/i], ['qty', /^qty|数量/i], ['remark', /remark|备注/i], ['model', /product\s*name|型号|^model/i], ['no', /^(no\.?|序号)$/i],
];
interface Box { x: number; w: number; top: number; bottom: number }
const near = (a: number, b: number, tolerance = 1.6) => Math.abs(a - b) <= tolerance;
const inside = (box: Box, x: number, y: number) => x >= box.x - 0.5 && x <= box.x + box.w + 0.5 && y >= box.top - 0.5 && y <= box.bottom + 0.5;
interface Spot { str: string; x: number; w: number; cx: number; cy: number }
/** Text of the spots inside a box: lines top to bottom, left to right; neighbours that touch are joined without a space. */
const joinLine = (line: Spot[]) => line.sort((a, b) => a.x - b.x).reduce((text, spot, k) => text + (k && spot.x - (line[k - 1].x + line[k - 1].w) > 1.2 ? ' ' : '') + spot.str, '');
const tidy = (text: string) => text.replace(/-\s+/g, '-').replace(/\s+/g, ' ').trim();
/** Spots grouped into lines, top to bottom. */
function linesOf(hits: Spot[]) {
  const lines: Spot[][] = [];
  for (const spot of hits.sort((a, b) => a.cy - b.cy)) { const line = lines[lines.length - 1]; if (line && Math.abs(line[0].cy - spot.cy) < 3) line.push(spot); else lines.push([spot]); }
  return lines;
}
function textIn(spots: Spot[], box: Box) { return tidy(linesOf(spots.filter(i => inside(box, i.cx, i.cy))).map(joinLine).join(' ')); }
/** Text of every column for every row. The PDF writes one row's cells together, left to right, so a row is a run of text in column order; this keeps text that spills over a cell border with its own row. */
function rowTexts(spots: Spot[], cols: { kind: GridKind; x: number; w: number }[], bands: Box[], bodyTop: number) {
  const data = cols.filter(c => c.kind !== 'no' && c.kind !== 'picture'), mids = bands.map(b => (b.top + b.bottom) / 2), bottom = bands[bands.length - 1].bottom;
  const columnOf = (s: Spot) => data.findIndex(c => s.cx >= c.x - 0.5 && s.cx <= c.x + c.w + 0.5);
  const groups: { spot: Spot; k: number }[][] = []; let previous = Infinity;
  for (const spot of spots) {
    const k = spot.cy < bodyTop || spot.cy > bottom + 20 ? -1 : columnOf(spot);
    if (k < 0) continue;
    if (k < previous) groups.push([]);
    groups[groups.length - 1].push({ spot, k }); previous = k;
  }
  const result = Object.fromEntries(data.map(c => [c.kind, bands.map(() => [] as string[])])) as Record<string, string[][]>;
  for (const group of groups) {
    // the single-line cells (unit, quantity, description, code) are never clipped, so they say which row the group belongs to
    const anchors = ['unit', 'qty', 'desc', 'model'].map(kind => group.filter(g => data[g.k].kind === kind)).find(list => list.length) || group;
    const cy = anchors.reduce((sum, g) => sum + g.spot.cy, 0) / anchors.length;
    const row = bands.findIndex(b => cy >= b.top - 0.5 && cy <= b.bottom + 0.5), index = row >= 0 ? row : mids.reduce((best, m, i) => Math.abs(m - cy) < Math.abs(mids[best] - cy) ? i : best, 0);
    for (const [k, column] of data.entries()) { const items = group.filter(g => g.k === k).map(g => g.spot); if (items.length) result[column.kind][index].push(linesOf(items).map(joinLine).join(' ')); }
  }
  return Object.fromEntries(Object.entries(result).map(([kind, rows]) => [kind, rows.map(parts => tidy(parts.join(' ')))])) as Record<string, string[]>;
}
/** Sorted y positions, with positions closer than 1.5 points counted as one. */
const distinct = (values: number[]) => values.sort((a, b) => a - b).reduce<number[]>((list, y) => (list.length && y - list[list.length - 1] < 1.5 ? list : [...list, y]), []);
function parseGrid(pages: PiPage[]): PiResult | undefined {
  type Block = { group: { text: string }; atTop: boolean; atBottom: boolean; top: number; bottom: number };
  const rows: (PiRow & { block?: Block })[] = [], pageBlocks: Block[][] = []; let cols: { kind: GridKind; x: number; w: number }[] | undefined, vendorCol: { x: number; w: number } | undefined, customer = '';
  for (const [pageIndex, page] of pages.entries()) {
    const rects: Box[] = (page.cells || []).map(c => ({ x: c.x, w: c.w, top: page.height - c.y - c.h, bottom: page.height - c.y }));
    // thin rectangles are the table's border lines
    const lines = rects.filter(r => r.bottom - r.top < 1.2 && r.w > 5).map(r => ({ y: (r.top + r.bottom) / 2, x0: r.x, x1: r.x + r.w }));
    const spots: Spot[] = page.items.filter(i => i.str.trim()).map(i => ({ str: i.str.trim(), x: i.x, w: i.w, cx: i.x + i.w / 2, cy: page.height - i.y - i.h * 0.3 }));
    let bodyTop = 0;
    const head = spots.find(i => /^description$/i.test(i.str));
    if (head) {
      const cell = rects.filter(r => inside(r, head.cx, head.cy) && r.bottom - r.top > 6 && r.bottom - r.top < 80).sort((a, b) => (a.w * (a.bottom - a.top)) - (b.w * (b.bottom - b.top)))[0];
      if (cell) {
        const found = rects.filter(r => near(r.top, cell.top, 2) && near(r.bottom, cell.bottom, 2)).sort((a, b) => a.x - b.x)
          .map(r => { const kind = gridWords.find(([, re]) => re.test(textIn(spots, r)))?.[0]; return kind && { kind, x: r.x, w: r.w }; }).filter((c): c is { kind: GridKind; x: number; w: number } => Boolean(c));
        if (found.some(c => c.kind === 'desc') && found.some(c => c.kind === 'qty')) {
          cols = found; bodyTop = cell.bottom - 1;
          // the first column (vendor name, merged cells) runs from the table's left border to the first labelled column
          const left = Math.min(...lines.filter(l => l.y < cell.bottom + 1).map(l => l.x0), found[0].x), first = found[0];
          vendorCol = first.x - left > 8 ? { x: left, w: first.x - left } : undefined;
          if (vendorCol) customer ||= textIn(spots, { ...vendorCol, top: cell.top, bottom: cell.bottom });
        }
      }
    }
    if (!cols) continue;
    const col = (kind: GridKind) => cols!.find(c => c.kind === kind), desc = col('desc')!, pictureCol = col('picture');
    const across = (c: { x: number; w: number }) => distinct(lines.filter(l => l.x0 <= c.x + c.w / 2 && l.x1 >= c.x + c.w / 2 && l.y >= bodyTop).map(l => l.y));
    // a row border is a line that crosses most of the table; it can have gaps where a cell is drawn on top of it
    const left = vendorCol?.x ?? cols[0].x, right = cols[cols.length - 1].x + cols[cols.length - 1].w;
    const edges = distinct(lines.filter(l => l.y >= bodyTop).map(l => l.y)).filter(y => {
      let covered = 0, end = -Infinity;
      for (const [a, b] of lines.filter(l => Math.abs(l.y - y) < 1.5).map(l => [Math.max(l.x0, left), Math.min(l.x1, right)]).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0])) if (b > end) { covered += b - Math.max(a, end); end = b; }
      return covered >= 0.7 * (right - left);
    }), bands: Box[] = [];
    edges.forEach((y, i) => { if (i < edges.length - 1 && edges[i + 1] - y > 6) bands.push({ x: desc.x, w: desc.w, top: y, bottom: edges[i + 1] }); });
    if (!bands.length) { pageBlocks.push([]); continue; }
    const tableTop = bands[0].top, tableBottom = bands[bands.length - 1].bottom;
    // the cell around a row: from the border above it to the border below it (more than one row when the cell is merged)
    const interval = (edgeList: number[], band: Box) => { const above = edgeList.filter(y => y <= band.top + 1.5), below = edgeList.filter(y => y >= band.bottom - 1.5); return { top: above.length ? Math.max(...above) : band.top, bottom: below.length ? Math.min(...below) : band.bottom }; };
    // a merged vendor cell can stay open at the top or bottom of a page, so the table's own ends count as borders
    const vendorEdges = vendorCol ? distinct([tableTop, ...across(vendorCol).filter(y => y > tableTop + 2 && y < tableBottom - 2), tableBottom]) : [], pictureEdges = pictureCol ? across(pictureCol) : [];
    const blocks: Block[] = vendorEdges.flatMap((y, i) => i < vendorEdges.length - 1 && vendorEdges[i + 1] > tableTop && y < tableBottom ? [{ top: y, bottom: vendorEdges[i + 1], group: { text: textIn(spots, { ...vendorCol!, top: y, bottom: vendorEdges[i + 1] }) }, atTop: y <= tableTop + 2, atBottom: vendorEdges[i + 1] >= tableBottom - 2 }] : []);
    pageBlocks.push(blocks);
    const pictures = (page.pictures || []).map(p => ({ ...p, top: page.height - p.y - p.h })), width = page.width || 0;
    const texts = rowTexts(spots, cols, bands, bodyTop);
    for (const [bandIndex, band] of bands.entries()) {
      const mid = (band.top + band.bottom) / 2, cell = (kind: GridKind) => texts[kind]?.[bandIndex] || '';
      const quantityText = cell('qty'), parts = quantityText.match(/\d+/g) || [], total = /^\d+(\s*\+\s*\d+)+$/.test(quantityText) ? parts.reduce((sum, n) => sum + Number(n), 0) : Number(parts[0] || 0);
      const remark = [cell('remark'), quantityText && !/^\d+$/.test(quantityText) ? `Qty: ${quantityText}` : ''].filter(Boolean).join(' · ');
      // a photo cell can be merged over several rows: every row in it shares the photo
      const holder = interval(pictureEdges, band);
      const image = pictureCol && width ? pictures.filter(p => { const cx = p.x + p.w / 2, cy = p.top + p.h / 2; return p.w > 8 && p.h > 8 && cx >= pictureCol.x - 1 && cx <= pictureCol.x + pictureCol.w + 1 && cy >= holder.top - 1 && cy <= holder.bottom + 1; }).sort((a, b) => b.w * b.h - a.w * a.h)[0] : undefined;
      const code = cell('model');
      const row = {
        vendor: '', code: /^\d{1,2}$/.test(code) ? '' : code, description: cell('desc'), size: cell('size'), material: cell('material'), colour: cell('colour'), unit: cell('unit').toLowerCase() || 'pcs',
        quantity: Number.isSafeInteger(total) && total > 0 && total <= 1000000 ? total : 0, remark: remark || undefined,
        picture: image ? { page: pageIndex, box: [image.x / width, image.top / page.height, image.w / width, image.h / page.height] as [number, number, number, number] } : undefined,
        block: blocks.find(b => b.top - 0.5 <= mid && b.bottom + 0.5 >= mid),
      };
      if ([row.description, row.code, row.size, row.material].some(text => /^total\b/i.test(text))) continue;
      if (row.description || row.code || row.size || row.material || row.colour || row.quantity || row.picture) rows.push(row);
    }
  }
  // A vendor cell that runs over a page break is one vendor: its name sits on whichever page holds the middle of the cell.
  pageBlocks.forEach((blocks, p) => {
    const previous = pageBlocks[p - 1]?.[pageBlocks[p - 1].length - 1], first = blocks[0];
    if (previous?.atBottom && first?.atTop && !(previous.group.text && first.group.text && previous.group.text !== first.group.text)) { previous.group.text ||= first.group.text; first.group = previous.group; }
  });
  if (!rows.length) return undefined;
  return { rows: rows.map(({ block, ...row }) => ({ ...row, vendor: block?.group.text || '' })), customer: customer.replace(/^(no\.?|序号)\s*/i, '').trim(), pages: pages.length };
}

export function parsePiPages(pages: PiPage[]): PiResult {
  if (pages.some(p => p.cells?.length)) { const grid = parseGrid(pages); if (grid) return grid; }
  const rows: PiRow[] = []; let layout: Layout | undefined, customer = '', carriedVendor = '';
  for (const [pageIndex, page] of pages.entries()) {
    const items = page.items.filter(i => i.str.trim()).map(i => ({ ...i, y: page.height - i.y })); // y grows downwards
    const header = findHeader(items);
    layout = header || layout;
    if (!layout) continue;
    customer ||= layout.customer;
    const body = header ? items.filter(i => i.y > header.bottom + 1) : items;
    const anchors = body.filter(i => unitWord.test(i.str.trim()) && columnOf(centre(i), layout!) === 'unit').sort((a, b) => a.y - b.y);
    if (!anchors.length) continue;
    const gaps = anchors.slice(1).map((a, i) => a.y - anchors[i].y), gap = median(gaps) || 40;
    const edges = anchors.map((a, i) => [i ? (anchors[i - 1].y + a.y) / 2 : a.y - gap / 2, i < anchors.length - 1 ? (a.y + anchors[i + 1].y) / 2 : a.y + gap / 2] as const);
    const rowOf = (y: number) => edges.findIndex(([from, to], i) => (y >= from || i === 0) && (y < to || i === edges.length - 1));
    const cells = anchors.map(() => ({} as Record<string, TextItem[]>)), brand: TextItem[] = [];
    for (const item of body) {
      const column = columnOf(centre(item), layout), index = rowOf(item.y);
      if (index < 0 || item.y < edges[0][0] - gap || item.y > edges[edges.length - 1][1] + gap) continue;
      if (column === 'left') { if (!/^\d+$/.test(item.str.trim())) brand.push(item); } else (cells[index][column] ||= []).push(item);
    }
    // The vendor name sits in the middle of a merged cell, so each vendor's block ends as far below its text as it starts above it.
    const groups: { text: string; mid: number; first: number; last: number }[] = [];
    for (const item of brand.sort((a, b) => a.y - b.y)) {
      const last = groups[groups.length - 1];
      if (last && item.y - last.last < Math.max(item.h, 8) * 1.8) { last.text = `${last.text} ${item.str.trim()}`; last.last = item.y; last.mid = (last.first + item.y) / 2; } else groups.push({ text: item.str.trim(), mid: item.y, first: item.y, last: item.y });
    }
    let top = edges[0][0]; const ends: number[] = [];
    for (const group of groups) { const end = 2 * group.mid - top; ends.push(end); top = end; }
    const monotone = ends.every((e, i) => e > (i ? ends[i - 1] : edges[0][0]));
    const vendorOf = (y: number) => {
      if (!groups.length) return carriedVendor;
      if (monotone) { const k = ends.findIndex(e => y < e); return groups[k < 0 ? groups.length - 1 : k].text; }
      return groups.reduce((best, g) => Math.abs(g.mid - y) < Math.abs(best.mid - y) ? g : best).text;
    };
    anchors.forEach((anchor, i) => {
      const text = (column: Column) => clean(cells[i][column] || []), quantity = parseInt(text('qty').match(/\d+/)?.[0] || '', 10);
      const description = text('desc'), code = text('model');
      if (!description && !code) return;
      // The product photo is the picture on this page whose middle falls inside the row.
      const [from, to] = edges[i], width = page.width || 0;
      const inRow = (page.pictures || []).map(p => ({ ...p, top: page.height - p.y - p.h })).filter(p => width && p.w > 20 && p.h > 20 && p.w < width * 0.6 && p.top + p.h / 2 >= from && p.top + p.h / 2 < to).sort((a, b) => b.w * b.h - a.w * a.h)[0];
      const picture = inRow ? { page: pageIndex, box: [inRow.x / width, inRow.top / page.height, inRow.w / width, inRow.h / page.height] as [number, number, number, number] } : undefined;
      rows.push({ picture, vendor: text('vendor') || (layout!.centres.vendor !== undefined ? '' : vendorOf(anchor.y)), code, description, size: text('size'), material: text('material'), colour: text('colour'), unit: anchor.str.trim().toLowerCase(), quantity: Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 1000000 ? quantity : 0 });
    });
    carriedVendor = rows[rows.length - 1]?.vendor || carriedVendor;
  }
  return { rows, customer, pages: pages.length };
}

type Matrix = number[];
const multiply = (m: Matrix, n: Matrix): Matrix => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
/** Where the rectangle x, y, w, h lands on the page once the current transform is applied. */
function placed(ctm: Matrix, x: number, y: number, w: number, h: number): PagePicture {
  const corners = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]], xs = corners.map(([u, v]) => ctm[0] * u + ctm[2] * v + ctm[4]), ys = corners.map(([u, v]) => ctm[1] * u + ctm[3] * v + ctm[5]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
/** Everything drawn on a PDF page that matters for a table: the pictures and the cell rectangles. Follows the page's drawing commands. */
export async function pageGraphics(pdfjs: typeof import('pdfjs-dist'), page: Awaited<ReturnType<Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>['getPage']>>): Promise<{ pictures: PagePicture[]; cells: PagePicture[] }> {
  const { OPS } = pdfjs, list = await page.getOperatorList(), pictures: PagePicture[] = [], cells: PagePicture[] = [], stack: Matrix[] = []; let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  list.fnArray.forEach((fn, i) => {
    const args = list.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === OPS.transform) ctm = multiply(args as Matrix, ctm);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (Array.isArray(args?.[0])) ctm = multiply(args[0] as Matrix, ctm); }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) pictures.push(placed(ctm, 0, 0, 1, 1));
    else if (fn === OPS.constructPath) {
      const [pathOps, coords] = args as [ArrayLike<number>, ArrayLike<number>]; let k = 0;
      for (const op of Array.from(pathOps)) {
        if (op === OPS.rectangle) { cells.push(placed(ctm, coords[k], coords[k + 1], coords[k + 2], coords[k + 3])); k += 4; }
        else if (op === OPS.moveTo || op === OPS.lineTo) k += 2;
        else if (op === OPS.curveTo) k += 6;
        else if (op === OPS.curveTo2 || op === OPS.curveTo3) k += 4;
      }
    }
  });
  return { pictures, cells };
}

/** Opens a PDF in the browser (pdf.js is loaded only when needed) and returns its text items per page. */
export async function readPdf(file: File): Promise<PiPage[]> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise, pages: PiPage[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n), view = page.getViewport({ scale: 1 }), height = view.height, content = await page.getTextContent();
    const graphics = await pageGraphics(pdfjs, page);
    pages.push({ height, width: view.width, pictures: graphics.pictures, cells: graphics.cells, items: content.items.flatMap(item => 'str' in item ? [{ str: item.str, x: item.transform[4], y: item.transform[5], w: item.width, h: item.height }] : []) });
  }
  return pages;
}

/** Shrinks a canvas to a JPEG data URL of at most `limit` characters (the server accepts about 4 MB per request). */
function jpeg(source: CanvasImageSource, width: number, height: number, limit: number) {
  for (const [side, quality] of [[1800, 0.85], [1500, 0.75], [1200, 0.7], [1000, 0.6]] as const) {
    const scale = Math.min(1, side / Math.max(width, height)), canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
    const context = canvas.getContext('2d')!; context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL('image/jpeg', quality); if (url.length <= limit) return url;
  }
  throw new Error('The image is too large. Use a smaller photo.');
}
/** Photos (JPG, PNG, WebP) as small JPEG data URLs for the vision model. */
export async function readImages(files: File[]): Promise<string[]> {
  const limit = Math.floor(3_200_000 / files.length), urls: string[] = [];
  for (const file of files) { const bitmap = await createImageBitmap(file); urls.push(jpeg(bitmap, bitmap.width, bitmap.height, limit)); bitmap.close(); }
  return urls;
}
/** Pages of a scanned PDF drawn as images (up to 5 pages) when the PDF has no text to read. */
export async function renderPdfPages(file: File): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise, count = Math.min(doc.numPages, 5), limit = Math.floor(3_200_000 / count), urls: string[] = [];
  for (let n = 1; n <= count; n++) {
    const page = await doc.getPage(n), viewport = page.getViewport({ scale: 2 }), canvas = document.createElement('canvas');
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
    urls.push(jpeg(canvas, canvas.width, canvas.height, limit));
  }
  return urls;
}

/** Best matching lead-time category for a product description, or the fallback (e.g. night stands and dressers have no category of their own). */
export function guessCategory(description: string, leads: { category: string; subcategory: string }[], fallback: string) {
  const text = description.toLowerCase();
  if (/dressing|dresser|night|bedside|side table|end table/.test(text)) return fallback;
  const words = (value: string) => value.toLowerCase().split(/[^a-z]+/).filter(w => w.length > 2 && w !== 'dining' && w !== 'default').map(w => w.replace(/s$/, ''));
  const scored = leads.filter(l => l.category === 'Furniture').map(l => ({ key: `${l.category}|${l.subcategory}`, score: words(l.subcategory).filter(w => text.includes(w)).length })).filter(l => l.score > 0).sort((a, b) => b.score - a.score);
  return scored[0]?.key || fallback;
}

/** Draws one PDF page as a canvas (2x) so product photos can be cut out of it. */
async function renderPdfPage(file: File, index: number) {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise, page = await doc.getPage(index + 1), viewport = page.getViewport({ scale: 2 }), canvas = document.createElement('canvas');
  canvas.width = viewport.width; canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
  return canvas;
}
/** Cuts each row's product photo out of the PI (a text PDF, or the page images the AI read). Rows without a photo give ''. */
export async function cropPictures(rows: { picture?: PiPicture }[], source: { pdf: File } | { images: string[] }): Promise<string[]> {
  const pages = new Map<number, Promise<CanvasImageSource & { width: number; height: number }>>();
  const page = (n: number) => { if (!pages.has(n)) pages.set(n, 'pdf' in source ? renderPdfPage(source.pdf, n) : fetch(source.images[n]).then(r => r.blob()).then(createImageBitmap)); return pages.get(n)!; };
  const result: string[] = [];
  for (const row of rows) {
    if (!row.picture) { result.push(''); continue; }
    try {
      const image = await page(row.picture.page), [x, y, w, h] = row.picture.box, pad = 0.01;
      const left = Math.max(0, (x - pad) * image.width), top = Math.max(0, (y - pad) * image.height), width = Math.min(image.width - left, (w + 2 * pad) * image.width), height = Math.min(image.height - top, (h + 2 * pad) * image.height);
      if (width < 20 || height < 20) { result.push(''); continue; }
      const canvas = document.createElement('canvas'); canvas.width = Math.round(width); canvas.height = Math.round(height);
      canvas.getContext('2d')!.drawImage(image, left, top, width, height, 0, 0, canvas.width, canvas.height);
      result.push(jpeg(canvas, canvas.width, canvas.height, 1_400_000));
    } catch { result.push(''); }
  }
  return result;
}
