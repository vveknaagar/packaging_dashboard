import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { config } from '../config';
import { all, get, insert, now, run, tx, warehouseId } from '../db';
import { AppError, ForbiddenError, NotFoundError } from '../errors';
import { isSuper } from '../permissions';
import type { SessionUser } from '../types';
import { clean } from '../util';
import { changeStock } from './stock';

// "Stock" is the quantity on hand: it is added to the warehouse as opening stock when the item is imported.
// There is no image column: imported items start without a picture, added later with Edit item.
export const TEMPLATE_HEADERS = ['Name', 'Size', 'Unit', 'Stock'];
const STALE_MS = 24 * 60 * 60 * 1000;

export interface PreviewRow {
  rowNo: number;
  name: string;
  size: string;
  unit: string;
  /** Opening quantity to put into the warehouse. */
  stock: number;
  errors: string[];
}

export interface PreviewManifest {
  userId: number;
  createdAt: string;
  sheetName: string;
  rows: PreviewRow[];
}

/* ---------- templates ---------- */

export async function templateXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Items');
  ws.addRow(TEMPLATE_HEADERS);
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((col) => { col.width = 22; });
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const help = wb.addWorksheet('Instructions');
  help.getColumn(1).width = 110;
  [
    'How to fill the Items sheet',
    '',
    'Name and Size are required for every row. Unit and Stock are optional.',
    'Name + Size must be unique. A row that repeats an existing item, or another row in this file, is rejected.',
    'Pictures are not part of the sheet. Add a picture to each item afterwards with Edit item.',
    'Stock is the quantity you have now. It is added to the warehouse as opening stock and shows as In stock. It must be a whole number, zero or more. Leave it empty for zero.',
    '',
    'Example rows (do not leave these in the Items sheet):',
    'Kraft Box | Small 6x4x2 in | pcs | 200',
    'Bubble Wrap Roll | 1 m x 50 m | roll | 10',
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

type HeaderKey = 'name' | 'size' | 'unit' | 'stock';

function mapHeaders(cells: string[]): Partial<Record<HeaderKey, number>> {
  const map: Partial<Record<HeaderKey, number>> = {};
  const assign = (key: HeaderKey, index: number) => { if (map[key] === undefined) map[key] = index; };
  cells.forEach((raw, index) => {
    const key = String(raw).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!key) return;
    if (key === 'name' || key === 'itemname') assign('name', index);
    else if (key === 'size') assign('size', index);
    else if (key === 'unit') assign('unit', index);
    else if (key === 'stock' || key === 'instock' || key === 'openingstock') assign('stock', index);
  });
  const missing = (['name', 'size'] as HeaderKey[]).filter((k) => map[k] === undefined);
  if (missing.length) {
    throw new AppError(`The first row must contain the column headings from the template. Missing: ${missing.join(', ')}.`);
  }
  return map;
}

/* ---------- preview ---------- */

function checkToken(token: string): string {
  if (!/^[a-f0-9]{32}$/.test(String(token))) throw new NotFoundError('Upload not found.');
  return token;
}

async function deletePreview(token: string): Promise<void> {
  await run('DELETE FROM bulk_previews WHERE token = ?', token);
}

/** Remove previews nobody finished within a day. */
export async function purgeStale(): Promise<void> {
  const cutoff = Date.now() - STALE_MS;
  await run('DELETE FROM bulk_previews WHERE created_at < ?', cutoff);
}

const itemKey = (name: string, size: string) => `${name.toLowerCase()}\u0000${size.toLowerCase()}`;

interface BuildInput {
  user: SessionUser;
  sheetPath: string;
  sheetName: string;
}

/**
 * Read the uploaded sheet and validate every row. Nothing is written to the
 * item list yet.
 * Returns a token the preview and import screens use.
 */
export async function buildPreview({ user, sheetPath, sheetName }: BuildInput): Promise<string> {
  if (!isSuper(user)) throw new ForbiddenError();
  await purgeStale();
  const raw = await readSheet(sheetPath, sheetName);
  if (!raw.length) throw new AppError('The sheet is empty.');
  const headers = mapHeaders(raw[0].cells);
  const dataRows = raw.slice(1);
  if (!dataRows.length) throw new AppError('The sheet has headings but no item rows.');
  if (dataRows.length > config.MAX_BULK_ROWS) throw new AppError(`A sheet can have at most ${config.MAX_BULK_ROWS} item rows.`);

  const existing = new Set((await all<{ name: string; size: string }>('SELECT name, size FROM items')).map((i) => itemKey(i.name, i.size)));
  const seen = new Map<string, number>();
  const cell = (cells: string[], index: number | undefined, max: number) => (index === undefined ? '' : clean(cells[index], max));

  const rows: PreviewRow[] = dataRows.map(({ rowNo, cells }) => {
    const row: PreviewRow = {
      rowNo,
      name: cell(cells, headers.name, 120),
      size: cell(cells, headers.size, 80),
      unit: cell(cells, headers.unit, 30),
      stock: 0,
      errors: [],
    };
    const stockText = cell(cells, headers.stock, 20);
    if (stockText !== '') {
      if (/^\d{1,9}(\.0+)?$/.test(stockText)) row.stock = Math.trunc(Number(stockText));
      else row.errors.push('Stock must be a whole number, zero or more.');
    }
    if (!row.name) row.errors.push('Name is missing.');
    if (!row.size) row.errors.push('Size is missing.');
    if (row.name && row.size) {
      const key = itemKey(row.name, row.size);
      if (existing.has(key)) row.errors.push('An item with this Name and Size already exists.');
      else if (seen.has(key)) row.errors.push(`Duplicate of row ${seen.get(key)} (same Name and Size).`);
      else seen.set(key, rowNo);
    }
    return row;
  });

  const token = crypto.randomBytes(16).toString('hex');
  const manifest: PreviewManifest = { userId: user.id, createdAt: now(), sheetName: clean(sheetName, 200), rows };
  await run('INSERT INTO bulk_previews (token, user_id, manifest, created_at) VALUES (?, ?, ?, ?)',
    token, user.id, JSON.stringify(manifest), Date.now());
  return token;
}

export async function loadPreview(token: string, user: SessionUser): Promise<PreviewManifest> {
  if (!isSuper(user)) throw new ForbiddenError();
  const row = await get<{ user_id: number; manifest: string }>(
    'SELECT user_id, manifest FROM bulk_previews WHERE token = ?', checkToken(token));
  if (!row) throw new NotFoundError('This upload has expired or was already imported. Please upload the sheet again.');
  if (row.user_id !== user.id) throw new NotFoundError('Upload not found.');
  return JSON.parse(row.manifest) as PreviewManifest;
}

export async function discard(token: string, user: SessionUser): Promise<void> {
  await loadPreview(token, user);
  await deletePreview(token);
}

/** Import every row that passed validation. Rows with errors are left out. */
export async function importPreview(token: string, user: SessionUser) {
  const manifest = await loadPreview(token, user);
  const valid = manifest.rows.filter((r) => !r.errors.length);
  if (!valid.length) throw new AppError('There are no valid rows to import.');
  // Items, opening stock and removing the preview all happen together, or not at all.
  return tx(async () => {
    let imported = 0;
    let skipped = 0;
    let units = 0;
    const warehouse = await warehouseId();
    for (const row of valid) {
      // Someone may have added the same item since the preview was built.
      if (await get('SELECT 1 FROM items WHERE name = ? AND size = ?', row.name, row.size)) {
        skipped += 1;
        continue;
      }
      const ts = now();
      // No picture yet: the item shows a placeholder until one is added with Edit item.
      const itemId = await insert(
        `INSERT INTO items (name, size, unit, image, thumb, created_at, updated_at)
         VALUES (?, ?, ?, '', '', ?, ?)`,
        row.name, row.size, row.unit, ts, ts);
      // The Stock column becomes opening stock in the warehouse, with a ledger entry like any other change.
      if (row.stock > 0) {
        await changeStock({
          itemId,
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
    await deletePreview(token);
    return { imported, skipped, units, rejected: manifest.rows.length - valid.length };
  });
}
