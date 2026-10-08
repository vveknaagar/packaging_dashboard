'use server';

import { runAction } from '@/lib/action';
import { config } from '@/lib/config';
import { AppError } from '@/lib/errors';
import * as bulk from '@/lib/services/bulk';
import * as items from '@/lib/services/items';
import type { ActionResult } from '@/lib/types';
import { field, parseId, rawField, requireId } from '@/lib/util';

async function imageFrom(formData: FormData): Promise<Buffer | null> {
  const file = formData.get('image');
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > config.MAX_IMAGE_BYTES) throw new AppError('Image is larger than 2 MB.');
  return Buffer.from(await file.arrayBuffer());
}

/** Add a new item, or update one when the form carries an id. */
export async function saveItemAction(formData: FormData): Promise<ActionResult> {
  return runAction(['super_admin'], async (user) => {
    const input = {
      name: rawField(formData, 'name'),
      size: rawField(formData, 'size'),
      unit: rawField(formData, 'unit'),
    };
    const image = await imageFrom(formData);
    const id = parseId(rawField(formData, 'id'));
    if (id) {
      await items.updateItem(user, id, input, image);
      return { ok: 'Item updated.', redirectTo: '/items' };
    }
    await items.createItem(user, input, image);
    return { ok: 'Item added.', redirectTo: '/items' };
  });
}

export async function setItemStatusAction(formData: FormData): Promise<ActionResult> {
  return runAction(['super_admin'], (user) => {
    const active = field(formData, 'active') === '1';
    items.setItemStatus(user, requireId(rawField(formData, 'id'), 'item'), active);
    return { ok: active ? 'Item activated.' : 'Item deactivated.' };
  });
}

/** Import the valid rows of a previewed bulk upload. */
export async function importBulkAction(formData: FormData): Promise<ActionResult> {
  return runAction(['super_admin'], (user) => {
    const result = bulk.importPreview(field(formData, 'token'), user);
    const parts = [`${result.imported} item(s) imported.`];
    if (result.units) parts.push(`${result.units} unit(s) of opening stock added to the warehouse.`);
    if (result.rejected) parts.push(`${result.rejected} row(s) with errors were left out.`);
    if (result.skipped) parts.push(`${result.skipped} row(s) skipped because the item now exists.`);
    return { ok: parts.join(' '), redirectTo: '/items' };
  });
}

export async function discardBulkAction(formData: FormData): Promise<ActionResult> {
  return runAction(['super_admin'], (user) => {
    bulk.discard(field(formData, 'token'), user);
    return { redirectTo: '/items/bulk' };
  });
}

/** The Price & HSN screen sends hsn_<itemId> and price_<itemId> for every item it shows. */
export async function savePricingAction(formData: FormData): Promise<ActionResult> {
  return runAction(['super_admin'], (user) => {
    const rows = new Map<number, items.PricingInput>();
    for (const [key, value] of formData.entries()) {
      const match = /^(hsn|price)_(\d{1,9})$/.exec(key);
      if (!match) continue;
      const id = Number(match[2]);
      const row = rows.get(id) ?? { id, hsn: '', price: '' };
      row[match[1] as 'hsn' | 'price'] = value;
      rows.set(id, row);
    }
    const changed = items.savePricing(user, [...rows.values()]);
    return { ok: changed ? `Saved ${changed} item(s).` : 'Nothing changed.' };
  });
}
