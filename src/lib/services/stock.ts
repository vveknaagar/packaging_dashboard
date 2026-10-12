import { all, get, inTransaction, now, run, tx } from '../db';
import { AppError, ForbiddenError, NotFoundError } from '../errors';
import { canEditStock, onBehalfNote } from '../permissions';
import type { LedgerType, SessionUser } from '../types';
import { clean, parseQty } from '../util';

export const LEDGER_LABELS: Record<LedgerType, string> = {
  stock_in: 'Stock In',
  stock_out: 'Stock Out',
  sale: 'Sold',
  adjustment: 'Adjustment',
  transfer_out: 'Transfer Out',
  transfer_in: 'Transfer In',
  transfer_return: 'Transfer Return',
};

export async function getQty(itemId: number, locationId: number): Promise<number> {
  const row = await get<{ qty: number }>('SELECT qty FROM stock WHERE item_id = ? AND location_id = ?', itemId, locationId);
  return row ? row.qty : 0;
}

interface StockChange {
  itemId: number;
  locationId: number;
  delta: number;
  type: LedgerType;
  reason: string;
  userId: number;
  transferId?: number | null;
}

/**
 * The only place stock quantities are ever changed. Updates the quantity and
 * writes the matching ledger entry together. Always call inside tx().
 */
export async function changeStock({ itemId, locationId, delta, type, reason, userId, transferId = null }: StockChange) {
  if (!inTransaction()) throw new Error('changeStock must run inside a transaction');
  if (!Number.isInteger(delta)) throw new AppError('Quantity must be a whole number.');
  const before = await getQty(itemId, locationId);
  if (delta === 0) return { before, after: before };
  const after = before + delta;
  if (after < 0) {
    const item = await get<{ name: string; size: string }>('SELECT name, size FROM items WHERE id = ?', itemId);
    const label = item ? `${item.name} (${item.size})` : 'this item';
    throw new AppError(`Not enough stock of ${label}: ${before} available, ${-delta} needed.`);
  }
  await run(
    `INSERT INTO stock (item_id, location_id, qty) VALUES (?, ?, ?)
     ON CONFLICT (item_id, location_id) DO UPDATE SET qty = excluded.qty`,
    itemId, locationId, after);
  await run(
    `INSERT INTO stock_ledger (ts, item_id, location_id, user_id, type, qty_change, qty_before, qty_after, reason, transfer_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    now(), itemId, locationId, userId, type, delta, before, after, reason, transferId);
  return { before, after };
}

export type AdjustMode = 'in' | 'out' | 'set';

interface AdjustInput {
  user: SessionUser;
  itemId: number;
  locationId: number;
  mode: string;
  qty: unknown;
  reason: unknown;
}

/**
 * Manual stock change by the admin of a location.
 * mode "in" adds qty, "out" removes qty, "set" corrects the quantity to a counted figure.
 */
export async function adjust({ user, itemId, locationId, mode, qty, reason }: AdjustInput) {
  if (!canEditStock(user, locationId)) throw new ForbiddenError('You can only change stock at your own location.');
  const amount = parseQty(qty);
  const why = clean(reason, 300);
  if (mode !== 'in' && mode !== 'out' && mode !== 'set') throw new AppError('Choose Stock In, Stock Out or Adjustment.');
  if (amount === null) throw new AppError('Quantity must be a whole number, zero or more.');
  if (mode !== 'set' && amount === 0) throw new AppError('Quantity must be greater than zero.');
  if (!why) throw new AppError('A reason is required for every stock change.');

  return tx(async () => {
    const item = await get<{ id: number; active: number }>('SELECT id, active FROM items WHERE id = ?', itemId);
    if (!item) throw new NotFoundError('Item not found.');
    const location = await get<{ id: number; active: number }>('SELECT id, active FROM locations WHERE id = ?', locationId);
    if (!location) throw new NotFoundError('Location not found.');
    if (!location.active) throw new AppError('This location is inactive.');
    if (mode === 'in' && !item.active) throw new AppError('This item is deactivated, so stock cannot be added.');

    const before = await getQty(itemId, locationId);
    let delta: number;
    let type: LedgerType;
    if (mode === 'in') { delta = amount; type = 'stock_in'; }
    else if (mode === 'out') { delta = -amount; type = 'stock_out'; }
    else {
      delta = amount - before;
      type = 'adjustment';
      if (delta === 0) throw new AppError(`Stock is already ${before}. Nothing to adjust.`);
    }
    return changeStock({ itemId, locationId, delta, type, reason: `${why} ${onBehalfNote(user)}`.trim(), userId: user.id });
  });
}

export interface SaleLine {
  itemId: number;
  qty: unknown;
}

interface SaleInput {
  user: SessionUser;
  locationId: number;
  lines: SaleLine[];
  /** The number on the store's sale invoice. Required. */
  billNo: unknown;
  /** Who bought: name required, phone optional. */
  customerName: unknown;
  customerPhone?: unknown;
  note: unknown;
}

/**
 * A store marks items as sold: each line takes its quantity off the store's stock,
 * all together or not at all. Returns the item ids and quantities taken off.
 */
export async function recordSale({ user, locationId, lines, billNo, customerName, customerPhone, note }: SaleInput) {
  if (!canEditStock(user, locationId)) throw new ForbiddenError('You can only mark items sold at your own store.');
  const bill = clean(billNo, 60);
  if (!bill) throw new AppError('Enter the bill / invoice number of the sale.');
  const customer = clean(customerName, 120);
  if (!customer) throw new AppError("Enter the customer's name.");
  const phone = clean(customerPhone, 20);
  if (phone && !/^[0-9+ -]{6,20}$/.test(phone)) throw new AppError('The customer phone can only have digits, spaces, + or -.');
  const sold: { itemId: number; qty: number }[] = [];
  for (const line of lines) {
    const qty = parseQty(line.qty);
    if (qty === null || qty === 0) throw new AppError('Each quantity sold must be a whole number greater than zero.');
    if (sold.some((s) => s.itemId === line.itemId)) throw new AppError('An item is listed twice.');
    sold.push({ itemId: line.itemId, qty });
  }
  if (sold.length === 0) throw new AppError('Choose at least one item and the quantity sold.');
  const extra = clean(note, 300);
  const reason = `Sold, bill no. ${bill}, to ${customer}${phone ? ` (${phone})` : ''}${extra ? `. ${extra}` : ''} ${onBehalfNote(user)}`.trim();

  return tx(async () => {
    const location = await get<{ type: string; active: number }>('SELECT type, active FROM locations WHERE id = ?', locationId);
    if (!location) throw new NotFoundError('Location not found.');
    if (location.type !== 'store') throw new AppError('Only stores mark items sold. Use Stock Out at the warehouse.');
    if (!location.active) throw new AppError('This store is inactive.');
    for (const s of sold) {
      if (!await get('SELECT 1 FROM items WHERE id = ?', s.itemId)) throw new NotFoundError('Item not found.');
      await changeStock({ itemId: s.itemId, locationId, delta: -s.qty, type: 'sale', reason, userId: user.id });
    }
    return sold;
  });
}

/** Quantities on dispatched transfers that have not been received yet, keyed by item id. */
export async function inTransit(locationId: number, direction: 'incoming' | 'outgoing'): Promise<Map<number, number>> {
  const column = direction === 'incoming' ? 'dest_id' : 'source_id';
  const rows = await all<{ item_id: number; qty: number }>(
    `SELECT ti.item_id, SUM(ti.qty_sent) AS qty
     FROM transfer_items ti JOIN transfers t ON t.id = ti.transfer_id
     WHERE t.status = 'dispatched' AND t.${column} = ?
     GROUP BY ti.item_id`, locationId);
  return new Map(rows.map((r) => [r.item_id, r.qty]));
}

