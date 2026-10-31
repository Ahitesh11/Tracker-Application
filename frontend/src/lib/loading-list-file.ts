import { strFromU8, unzipSync } from 'fflate';
import { readPdf, readImages, renderPdfPages } from '@/lib/pi-parser';

/** What the server needs to read a loading list: a table of cells, or photos when the file has no text. */
export type ListInput = { table: string[][] } | { images: string[] };

const columnIndex = (ref: string) => [...ref.replace(/[^A-Z]/gi, '').toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const xml = (text: string) => new DOMParser().parseFromString(text, 'application/xml');

/** First sheet of an .xlsx file as rows of text. */
export async function readXlsx(file: File): Promise<string[][]> {
  const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const sheetName = Object.keys(zip).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.replace(/\D/g, '')) - parseInt(b.replace(/\D/g, '')))[0];
  if (!sheetName) throw new Error('This Excel file has no readable sheet.');
  const shared = zip['xl/sharedStrings.xml'] ? [...xml(strFromU8(zip['xl/sharedStrings.xml'])).getElementsByTagName('si')].map(si => [...si.getElementsByTagName('t')].map(t => t.textContent || '').join('')) : [];
  const rows: string[][] = [];
  for (const row of xml(strFromU8(zip[sheetName])).getElementsByTagName('row')) {
    const cells: string[] = [];
    for (const c of row.getElementsByTagName('c')) {
      const type = c.getAttribute('t'), raw = c.getElementsByTagName('v')[0]?.textContent ?? '';
      cells[columnIndex(c.getAttribute('r') || '')] = type === 's' ? shared[Number(raw)] ?? '' : type === 'inlineStr' ? [...c.getElementsByTagName('t')].map(t => t.textContent || '').join('') : raw;
    }
    rows.push(Array.from(cells, v => v ?? ''));
  }
  return rows;
}
/** CSV with commas, semicolons or tabs, quotes allowed. */
export function readCsv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0], delimiter = [',', ';', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
/** Text of a PDF as table rows: items on the same line are one row, items far apart are separate cells. */
async function pdfTable(file: File): Promise<string[][]> {
  const rows: string[][] = [];
  for (const page of await readPdf(file)) {
    const lines: { y: number; items: typeof page.items }[] = [];
    for (const item of [...page.items].filter(i => i.str.trim()).sort((a, b) => b.y - a.y)) {
      const line = lines.find(l => Math.abs(l.y - item.y) < 3);
      if (line) line.items.push(item); else lines.push({ y: item.y, items: [item] });
    }
    for (const line of lines) {
      const cells: string[] = []; let end = -Infinity;
      for (const item of line.items.sort((a, b) => a.x - b.x)) { if (cells.length && item.x - end < 6) cells[cells.length - 1] += (item.x - end > 1 ? ' ' : '') + item.str; else cells.push(item.str); end = item.x + item.w; }
      rows.push(cells.map(c => c.trim()));
    }
  }
  return rows;
}
/** Excel, CSV and text PDFs become a table; photos and scanned PDFs are sent as images for the AI. */
export async function readLoadingList(files: File[]): Promise<ListInput> {
  const [file] = files, name = file.name.toLowerCase();
  if (files.length > 1 || file.type.startsWith('image/')) { if (files.some(f => !f.type.startsWith('image/'))) throw new Error('Choose one Excel, CSV or PDF file, or up to 6 photos.'); if (files.length > 6) throw new Error('Send 1 to 6 images (JPG, PNG or WebP).'); return { images: await readImages(files) }; }
  if (/\.xlsx$/.test(name) || file.type.includes('spreadsheetml')) return { table: await readXlsx(file) };
  if (/\.xls$/.test(name)) throw new Error('Old .xls files are not supported. Save the sheet as .xlsx or .csv and upload it again.');
  if (/\.(csv|txt|tsv)$/.test(name) || file.type.startsWith('text/')) return { table: readCsv(await file.text()) };
  if (/\.pdf$/.test(name) || file.type === 'application/pdf') { const table = await pdfTable(file); return table.length > 2 ? { table } : { images: await renderPdfPages(file) }; }
  throw new Error('Upload an Excel (.xlsx), CSV, PDF or image loading list.');
}
