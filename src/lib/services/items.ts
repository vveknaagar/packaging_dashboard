import { get, insert, now, run, tx } from '../db';
import { AppError, ForbiddenError, NotFoundError } from '../errors';
import { isSuper } from '../permissions';
import type { ItemRow, SessionUser } from '../types';
import { clean } from '../util';
import * as images from './images';

export interface ItemInput {
  name: unknown;
  size: unknown;
  unit: unknown;
}

function validate(input: ItemInput) {
  const name = clean(input.name, 120);
  const size = clean(input.size, 80);
  if (!name) throw new AppError('Name is required.');
  if (!size) throw new AppError('Size is required.');
  return { name, size, unit: clean(input.unit, 30) };
}

async function assertUnique(name: string, size: string, exceptId = 0) {
  const clash = await get('SELECT 1 FROM items WHERE name = ? AND size = ? AND id <> ?', name, size, exceptId);
  if (clash) throw new AppError(`An item named "${name}" with size "${size}" already exists.`);
}

const isUniqueViolation = (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';

/** Only the Super Admin manages the item master. */
function assertManager(user: SessionUser) {
  if (!isSuper(user)) throw new ForbiddenError('Only the Super Admin can manage items.');
}

export async function createItem(user: SessionUser, input: ItemInput, image: Buffer | null): Promise<number> {
  assertManager(user);
  const data = validate(input);
  if (!image || !image.length) throw new AppError('An image is required.');
  await assertUnique(data.name, data.size);
  const processed = await images.processImage(image);
  try {
    // The picture and the item are saved together, or neither is.
    return await tx(async () => {
      const stored = await images.saveProcessed(processed);
      const ts = now();
      return insert(
        'INSERT INTO items (name, size, unit, image, thumb, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        data.name, data.size, data.unit, stored.image, stored.thumb, ts, ts);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(`An item named "${data.name}" with size "${data.size}" already exists.`);
    throw err;
  }
}

/** Update an item. The image is replaced only when a new one is supplied. */
export async function updateItem(user: SessionUser, id: number, input: ItemInput, image: Buffer | null): Promise<void> {
  assertManager(user);
  const item = await get<ItemRow>('SELECT * FROM items WHERE id = ?', id);
  if (!item) throw new NotFoundError('Item not found.');
  const data = validate(input);
  await assertUnique(data.name, data.size, id);
  const processed = image && image.length ? await images.processImage(image) : null;
  try {
    // A new picture replaces the old one in the same step as the item update.
    await tx(async () => {
      const stored = processed ? await images.saveProcessed(processed) : null;
      await run('UPDATE items SET name = ?, size = ?, unit = ?, image = ?, thumb = ?, updated_at = ? WHERE id = ?',
        data.name, data.size, data.unit,
        stored ? stored.image : item.image, stored ? stored.thumb : item.thumb, now(), id);
      if (stored) await images.removeStored(item.image, item.thumb);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(`An item named "${data.name}" with size "${data.size}" already exists.`);
    throw err;
  }
}

/** Items are never deleted; they are switched off and can be switched back on. */
export async function setItemStatus(user: SessionUser, id: number, active: boolean): Promise<void> {
  assertManager(user);
  const info = await run('UPDATE items SET active = ?, updated_at = ? WHERE id = ?', active ? 1 : 0, now(), id);
  if (!info.changes) throw new NotFoundError('Item not found.');
}

export interface PricingInput {
  id: number;
  hsn: unknown;
  /** Rupees as typed, e.g. "12.50". Blank clears the price. */
  price: unknown;
}

/** "12.5" or "₹1,200.00" to paise. Blank is null; anything else that is not a price is an error. */
export function parsePrice(value: unknown): number | null {
  const text = typeof value === 'string' ? value.replace(/[₹,\s]/g, '') : '';
  if (!text) return null;
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new AppError(`"${String(value).trim()}" is not a valid price. Use rupees, for example 12.50.`);
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

/** Set the HSN code and price of several items at once. Only rows that changed are written. */
export async function savePricing(user: SessionUser, rows: PricingInput[]): Promise<number> {
  if (!isSuper(user)) throw new ForbiddenError('Only the Super Admin can set prices and HSN codes.');
  return tx(async () => {
    let changed = 0;
    for (const row of rows) {
      const item = await get<ItemRow>('SELECT * FROM items WHERE id = ?', row.id);
      if (!item) throw new NotFoundError('One of the items no longer exists.');
      const hsn = clean(row.hsn, 20).replace(/\s/g, '');
      if (hsn && !/^\d{4}(\d{2}){0,2}$/.test(hsn)) {
        throw new AppError(`${item.name} (${item.size}): HSN code must be 4, 6 or 8 digits.`);
      }
      let price: number | null;
      try {
        price = parsePrice(row.price);
      } catch (err) {
        throw new AppError(`${item.name} (${item.size}): ${(err as Error).message}`);
      }
      if (hsn === item.hsn && price === item.price_paise) continue;
      await run('UPDATE items SET hsn = ?, price_paise = ?, updated_at = ? WHERE id = ?', hsn, price, now(), row.id);
      changed++;
    }
    return changed;
  });
}
