/** Reads the product rows out of a PI (proforma invoice) PDF. Pure functions: pdf text items in, rows out. */
export interface TextItem { str: string; x: number; y: number; w: number; h: number }
export interface PiPage { height: number; items: TextItem[] }
export interface PiRow { vendor: string; code: string; description: string; size: string; material: string; colour: string; unit: string; quantity: number }
export interface PiResult { rows: PiRow[]; customer: string; pages: number }

type Column = 'model' | 'desc' | 'size' | 'material' | 'colour' | 'unit' | 'qty';
const headerWords: [Column, RegExp][] = [
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
  const left = band.some(h => h.column === 'model') ? modelLeft : Math.min(...header.map(i => i.x));
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

export function parsePiPages(pages: PiPage[]): PiResult {
  const rows: PiRow[] = []; let layout: Layout | undefined, customer = '', carriedVendor = '';
  for (const page of pages) {
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
      rows.push({ vendor: vendorOf(anchor.y), code, description, size: text('size'), material: text('material'), colour: text('colour'), unit: anchor.str.trim().toLowerCase(), quantity: Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 1000000 ? quantity : 1 });
    });
    carriedVendor = rows[rows.length - 1]?.vendor || carriedVendor;
  }
  return { rows, customer, pages: pages.length };
}

/** Opens a PDF in the browser (pdf.js is loaded only when needed) and returns its text items per page. */
export async function readPdf(file: File): Promise<PiPage[]> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise, pages: PiPage[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n), height = page.getViewport({ scale: 1 }).height, content = await page.getTextContent();
    pages.push({ height, items: content.items.flatMap(item => 'str' in item ? [{ str: item.str, x: item.transform[4], y: item.transform[5], w: item.width, h: item.height }] : []) });
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
