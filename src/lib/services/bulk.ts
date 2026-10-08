import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import ExcelJS from 'exceljs';
import yauzl from 'yauzl';
import { config, ensureDataDirs } from '../config';
import { all, get, now, run, tx, warehouseId } from '../db';
import { AppError, ForbiddenError, NotFoundError } from '../errors';
import { isSuper } from '../permissions';
import type { SessionUser } from '../types';
import { clean } from '../util';
import * as images from './images';
import { changeStock } from './stock';

// "Stock" is the quantity on hand: it is added to the warehouse as opening stock when the item is imported.
export const TEMPLATE_HEADERS = ['Name', 'Size', 'Image (filename or URL)', 'Unit', 'Stock'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const STALE_MS = 24 * 60 * 60 * 1000;

export interface PreviewRow {
  rowNo: number;
  name: string;
  size: string;
  imageRef: string;
  unit: string;
  /** Opening quantity to put into the warehouse. */
  stock: number;
  errors: string[];
  /** Index of the processed image waiting in the staging folder, when the image was accepted. */
  staged: number | null;
}

export interface PreviewManifest {
  userId: number;
  createdAt: string;
  sheetName: string;
  zipImages: number | null;
  rows: PreviewRow[];
}

/* ---------- templates ---------- */

export async function templateXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Items');
  ws.addRow(TEMPLATE_HEADERS);
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((col, i) => { col.width = i === 2 ? 34 : 18; });
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const help = wb.addWorksheet('Instructions');
  help.getColumn(1).width = 110;
  [
    'How to fill the Items sheet',
    '',
    'Name, Size and Image are required for every row. Unit and Stock are optional.',
    'Name + Size must be unique. A row that repeats an existing item, or another row in this file, is rejected.',
    'Image: type either a file name (for example kraft-box-small.jpg) or a full web address starting with http:// or https://.',
    'If you use file names, put all the pictures in one ZIP file and upload it together with this sheet. File names are matched without regard to capital letters.',
    'Each image must be a JPG, PNG, WebP or GIF of at most 2 MB.',
    'Stock is the quantity you have now. It is added to the warehouse as opening stock and shows as In stock. It must be a whole number, zero or more. Leave it empty for zero.',
    '',
    'Example rows (do not leave these in the Items sheet):',
    'Kraft Box | Small 6x4x2 in | kraft-box-small.jpg | pcs | 200',
    'Bubble Wrap Roll | 1 m x 50 m | https://example.com/images/bubble-wrap.jpg | roll | 10',
  ].forEach((line) => help.addRow([line]));
  help.getRow(1).font = { bold: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const templateCsv = (): string => `﻿${TEMPLATE_HEADERS.join(',')}\r\n`;

/* ---------- reading the sheet ---------- */

export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const delimiter = firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { value += '"'; i++; } else inQuotes = false;
      } else value += c;
    } else if (c === '"' && value === '') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(value); value = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(value); rows.push(row); row = []; value = '';
    } else value += c;
  }
  if (value !== '' || row.length) { row.push(value); rows.push(row); }
  return rows;
}

function cellText(cell: ExcelJS.Cell): string {
  try {
    const text = cell.text;
    return text === null || text === undefined ? '' : String(text);
  } catch {
    return '';
  }
}

interface SheetRow {
  rowNo: number;
  cells: string[];
}

/** Every non-empty row of the sheet, header included. */
async function readSheet(filePath: string, originalName: string): Promise<SheetRow[]> {
  const ext = path.extname(originalName || '').toLowerCase();
  if (ext === '.csv') {
    return parseCsv(fs.readFileSync(filePath, 'utf8'))
      .map((cells, i) => ({ rowNo: i + 1, cells }))
      .filter((r) => r.cells.some((c) => c.trim() !== ''));
  }
  if (ext === '.xlsx') {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.readFile(filePath);
    } catch {
      throw new AppError('The Excel file could not be read. Save it as .xlsx or .csv and try again.');
    }
    const ws = wb.getWorksheet('Items') || wb.worksheets[0];
    if (!ws) throw new AppError('The Excel file has no sheets.');
    const out: SheetRow[] = [];
    const width = Math.min(ws.columnCount || 0, 30);
    ws.eachRow({ includeEmpty: false }, (row, rowNo) => {
      const cells: string[] = [];
      for (let c = 1; c <= width; c++) cells.push(cellText(row.getCell(c)));
      if (cells.some((c) => c.trim() !== '')) out.push({ rowNo, cells });
    });
    return out;
  }
  throw new AppError('Upload the item sheet as an .xlsx or .csv file.');
}

type HeaderKey = 'name' | 'size' | 'image' | 'unit' | 'stock';

function mapHeaders(cells: string[]): Partial<Record<HeaderKey, number>> {
  const map: Partial<Record<HeaderKey, number>> = {};
  const assign = (key: HeaderKey, index: number) => { if (map[key] === undefined) map[key] = index; };
  cells.forEach((raw, index) => {
    const key = String(raw).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!key) return;
    if (key === 'name' || key === 'itemname') assign('name', index);
    else if (key === 'size') assign('size', index);
    else if (key.startsWith('image')) assign('image', index);
    else if (key === 'unit') assign('unit', index);
    else if (key === 'stock' || key === 'instock' || key === 'openingstock') assign('stock', index);
  });
  const missing = (['name', 'size', 'image'] as HeaderKey[]).filter((k) => map[k] === undefined);
  if (missing.length) {
    throw new AppError(`The first row must contain the column headings from the template. Missing: ${missing.join(', ')}.`);
  }
  return map;
}

/* ---------- images from the ZIP ---------- */

interface ZipIndex {
  size: number;
  find(ref: string): yauzl.Entry | null;
  read(entry: yauzl.Entry): Promise<Buffer>;
  close(): void;
}

function openZip(zipPath: string): Promise<ZipIndex> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zipfile) => {
      if (err || !zipfile) return reject(new AppError('The ZIP file could not be opened.'));
      const byName = new Map<string, yauzl.Entry>();
      const byStem = new Map<string, yauzl.Entry | null>();
      let count = 0;
      zipfile.on('error', () => reject(new AppError('The ZIP file is damaged.')));
      zipfile.on('entry', (entry: yauzl.Entry) => {
        count += 1;
        if (count > 20000) {
          zipfile.close();
          return reject(new AppError('The ZIP file has too many entries.'));
        }
        const name = entry.fileName;
        const base = path.posix.basename(name.replace(/\\/g, '/')).toLowerCase();
        const ext = path.extname(base);
        if (!name.endsWith('/') && !name.startsWith('__MACOSX/') && !base.startsWith('.') && IMAGE_EXTENSIONS.includes(ext)) {
          if (!byName.has(base)) byName.set(base, entry);
          const stem = base.slice(0, -ext.length);
          byStem.set(stem, byStem.has(stem) ? null : entry); // null marks an ambiguous stem
        }
        zipfile.readEntry();
      });
      zipfile.on('end', () => {
        resolve({
          size: byName.size,
          find(ref) {
            const base = path.posix.basename(String(ref).replace(/\\/g, '/')).toLowerCase();
            return byName.get(base) || byStem.get(base) || null;
          },
          read(entry) {
            return new Promise<Buffer>((res, rej) => {
              if (entry.uncompressedSize > config.MAX_IMAGE_BYTES) return rej(new AppError('Image is larger than 2 MB.'));
              zipfile.openReadStream(entry, (e, stream) => {
                if (e || !stream) return rej(new AppError('Image could not be read from the ZIP.'));
                const chunks: Buffer[] = [];
                let total = 0;
                stream.on('data', (chunk: Buffer) => {
                  total += chunk.length;
                  if (total > config.MAX_IMAGE_BYTES) {
                    stream.destroy();
                    return rej(new AppError('Image is larger than 2 MB.'));
                  }
                  chunks.push(chunk);
                });
                stream.on('end', () => res(Buffer.concat(chunks)));
                stream.on('error', () => rej(new AppError('Image could not be read from the ZIP.')));
              });
            });
          },
          close() { try { zipfile.close(); } catch { /* already closed */ } },
        });
      });
      zipfile.readEntry();
    });
  });
}

/* ---------- images from a URL ---------- */

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0);
  }
  const lower = ip.toLowerCase();
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  return lower === '::' || lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') ||
    /^fe[89ab]/.test(lower) || lower.startsWith('::ffff:') || lower.startsWith('64:ff9b:');
}

/**
 * Download an image named in the sheet. The server must not be usable to
 * reach machines on the internal network, so only public http(s) addresses
 * are fetched and every redirect hop is checked again.
 */
async function fetchImageFromUrl(ref: string): Promise<Buffer> {
  let url: URL;
  try { url = new URL(ref); } catch { throw new AppError('Image URL is not valid.'); }
  for (let hop = 0; hop < 4; hop++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new AppError('Image URL must start with http:// or https://.');
    }
    const host = url.hostname.replace(/^\[|\]$/g, '');
    let addresses: { address: string }[];
    try {
      addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
    } catch {
      throw new AppError('Image URL could not be reached.');
    }
    if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
      throw new AppError('Image URL points to a private network address, which is not allowed.');
    }
    let res: Response;
    try {
      res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { accept: 'image/*' }, cache: 'no-store' });
    } catch {
      throw new AppError('Image URL could not be downloaded.');
    }
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      try { url = new URL(location, url); } catch { throw new AppError('Image URL redirects to an invalid address.'); }
      continue;
    }
    if (!res.ok || !res.body) throw new AppError(`Image URL returned an error (${res.status}).`);
    if (Number(res.headers.get('content-length') || 0) > config.MAX_IMAGE_BYTES) throw new AppError('Image is larger than 2 MB.');
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > config.MAX_IMAGE_BYTES) {
          await reader.cancel().catch(() => {});
          throw new AppError('Image is larger than 2 MB.');
        }
        chunks.push(value);
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError('Image URL could not be downloaded.');
    }
    return Buffer.concat(chunks);
  }
  throw new AppError('Image URL redirects too many times.');
}

/* ---------- preview ---------- */

function tokenDir(token: string): string {
  if (!/^[a-f0-9]{32}$/.test(String(token))) throw new NotFoundError('Upload not found.');
  return path.join(config.BULK_DIR, token);
}

/** Remove staged uploads nobody finished within a day. */
export function purgeStale(): void {
  ensureDataDirs();
  let names: string[] = [];
  try { names = fs.readdirSync(config.BULK_DIR); } catch { return; }
  for (const name of names) {
    const dir = path.join(config.BULK_DIR, name);
    try {
      if (Date.now() - fs.statSync(dir).mtimeMs > STALE_MS) fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
}

async function runPool(tasks: (() => Promise<void>)[], limit: number): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const index = next++;
      await tasks[index]();
    }
  });
  await Promise.all(workers);
}

const itemKey = (name: string, size: string) => `${name.toLowerCase()}\u0000${size.toLowerCase()}`;

interface BuildInput {
  user: SessionUser;
  sheetPath: string;
  sheetName: string;
  zipPath: string | null;
}

/**
 * Read the uploaded sheet (and optional ZIP), validate every row, and stage
 * the processed images on disk. Nothing is written to the item list yet.
 * Returns a token the preview and import screens use.
 */
export async function buildPreview({ user, sheetPath, sheetName, zipPath }: BuildInput): Promise<string> {
  if (!isSuper(user)) throw new ForbiddenError();
  purgeStale();
  const raw = await readSheet(sheetPath, sheetName);
  if (!raw.length) throw new AppError('The sheet is empty.');
  const headers = mapHeaders(raw[0].cells);
  const dataRows = raw.slice(1);
  if (!dataRows.length) throw new AppError('The sheet has headings but no item rows.');
  if (dataRows.length > config.MAX_BULK_ROWS) throw new AppError(`A sheet can have at most ${config.MAX_BULK_ROWS} item rows.`);

  const zip = zipPath ? await openZip(zipPath) : null;
  const token = crypto.randomBytes(16).toString('hex');
  const dir = tokenDir(token);
  fs.mkdirSync(dir, { recursive: true });

  try {
    const existing = new Set(all<{ name: string; size: string }>('SELECT name, size FROM items').map((i) => itemKey(i.name, i.size)));
    const seen = new Map<string, number>();
    const cell = (cells: string[], index: number | undefined, max: number) => (index === undefined ? '' : clean(cells[index], max));

    const rows: PreviewRow[] = dataRows.map(({ rowNo, cells }) => {
      const row: PreviewRow = {
        rowNo,
        name: cell(cells, headers.name, 120),
        size: cell(cells, headers.size, 80),
        imageRef: cell(cells, headers.image, 1000),
        unit: cell(cells, headers.unit, 30),
        stock: 0,
        errors: [],
        staged: null,
      };
      const stockText = cell(cells, headers.stock, 20);
      if (stockText !== '') {
        if (/^\d{1,9}(\.0+)?$/.test(stockText)) row.stock = Math.trunc(Number(stockText));
        else row.errors.push('Stock must be a whole number, zero or more.');
      }
      if (!row.name) row.errors.push('Name is missing.');
      if (!row.size) row.errors.push('Size is missing.');
      if (!row.imageRef) row.errors.push('Image is missing.');
      if (row.name && row.size) {
        const key = itemKey(row.name, row.size);
        if (existing.has(key)) row.errors.push('An item with this Name and Size already exists.');
        else if (seen.has(key)) row.errors.push(`Duplicate of row ${seen.get(key)} (same Name and Size).`);
        else seen.set(key, rowNo);
      }
      return row;
    });

    // Each distinct image is fetched and processed once, even if many rows use it.
    const imageJobs = new Map<string, Promise<number>>();
    let stagedCount = 0;
    const resolveImage = (ref: string): Promise<number> => {
      const isUrl = /^https?:\/\//i.test(ref);
      const cacheKey = isUrl ? ref : ref.toLowerCase();
      let job = imageJobs.get(cacheKey);
      if (!job) {
        job = (async () => {
          let buffer: Buffer;
          if (isUrl) {
            buffer = await fetchImageFromUrl(ref);
          } else {
            if (!zip) throw new AppError(`Image "${ref}" needs a ZIP of images, but none was uploaded.`);
            const entry = zip.find(ref);
            if (!entry) throw new AppError(`Image "${ref}" was not found in the ZIP.`);
            buffer = await zip.read(entry);
          }
          const processed = await images.processImage(buffer);
          const id = stagedCount++;
          fs.writeFileSync(path.join(dir, `${id}.webp`), processed.main);
          fs.writeFileSync(path.join(dir, `${id}_t.webp`), processed.thumb);
          return id;
        })();
        imageJobs.set(cacheKey, job);
      }
      return job;
    };

    await runPool(rows.filter((r) => r.imageRef).map((row) => async () => {
      try {
        row.staged = await resolveImage(row.imageRef);
      } catch (err) {
        row.errors.push(err instanceof AppError ? err.message : 'Image could not be processed.');
      }
    }), 6);

    const manifest: PreviewManifest = {
      userId: user.id,
      createdAt: now(),
      sheetName: clean(sheetName, 200),
      zipImages: zip ? zip.size : null,
      rows,
    };
    fs.writeFileSync(path.join(dir, 'rows.json'), JSON.stringify(manifest));
    return token;
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  } finally {
    zip?.close();
  }
}

export function loadPreview(token: string, user: SessionUser): PreviewManifest {
  if (!isSuper(user)) throw new ForbiddenError();
  const dir = tokenDir(token);
  let manifest: PreviewManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(dir, 'rows.json'), 'utf8'));
  } catch {
    throw new NotFoundError('This upload has expired or was already imported. Please upload the sheet again.');
  }
  if (manifest.userId !== user.id) throw new NotFoundError('Upload not found.');
  return manifest;
}

export function stagedThumbPath(token: string, user: SessionUser, index: string): string {
  loadPreview(token, user);
  if (!/^\d{1,6}$/.test(index)) throw new NotFoundError();
  return path.join(tokenDir(token), `${index}_t.webp`);
}

export function discard(token: string, user: SessionUser): void {
  loadPreview(token, user);
  fs.rmSync(tokenDir(token), { recursive: true, force: true });
}

/** Import every row that passed validation. Rows with errors are left out. */
export function importPreview(token: string, user: SessionUser) {
  const manifest = loadPreview(token, user);
  const dir = tokenDir(token);
  const valid = manifest.rows.filter((r) => !r.errors.length && r.staged !== null);
  if (!valid.length) throw new AppError('There are no valid rows to import.');
  const written: string[] = [];
  try {
    const result = tx(() => {
      let imported = 0;
      let skipped = 0;
      let units = 0;
      const warehouse = warehouseId();
      for (const row of valid) {
        // Someone may have added the same item since the preview was built.
        if (get('SELECT 1 FROM items WHERE name = ? COLLATE NOCASE AND size = ? COLLATE NOCASE', row.name, row.size)) {
          skipped += 1;
          continue;
        }
        const stored = images.saveProcessed({
          main: fs.readFileSync(path.join(dir, `${row.staged}.webp`)),
          thumb: fs.readFileSync(path.join(dir, `${row.staged}_t.webp`)),
        });
        written.push(stored.image, stored.thumb);
        const ts = now();
        const info = run(
          `INSERT INTO items (name, size, unit, image, thumb, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          row.name, row.size, row.unit, stored.image, stored.thumb, ts, ts);
        // The Stock column becomes opening stock in the warehouse, with a ledger entry like any other change.
        if (row.stock > 0) {
          changeStock({
            itemId: Number(info.lastInsertRowid),
            locationId: warehouse,
            delta: row.stock,
            type: 'stock_in',
            reason: 'Opening stock from bulk import',
            userId: user.id,
          });
          units += row.stock;
        }
        imported += 1;
      }
      return { imported, skipped, units, rejected: manifest.rows.length - valid.length };
    });
    fs.rmSync(dir, { recursive: true, force: true });
    return result;
  } catch (err) {
    images.removeStored(...written);
    throw err;
  }
}
