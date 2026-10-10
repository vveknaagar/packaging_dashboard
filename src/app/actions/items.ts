'use server';

import { runAction } from '@/lib/action';
import { audit, changes, itemLabel, money } from '@/lib/audit';
import { all, get } from '@/lib/db';
import { config } from '@/lib/config';
import { AppError } from '@/lib/errors';
import * as bulk from '@/lib/services/bulk';
import * as items from '@/lib/services/items';
import type { ActionResult, ItemRow } from '@/lib/types';
import { field, parseId, rawField, requireId } from '@/lib/util';

async function imageFrom(formData: FormData): Promise<Buffer | null> {
  const file = formData.get('image');
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > config.MAX_IMAGE_BYTES) throw new AppError('Image is larger than 2 MB.');
  return Buffer.from(await file.arrayBuffer());
}

const ITEM_FIELDS = { name: 'Name', size: 'Size', unit: 'Unit' };
const itemRow = (id: number) => get<ItemRow>('SELECT * FROM items WHERE id = ?', id);

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
      const before = await itemRow(id);
      await items.updateItem(user, id, input, image);
      const detail = [before && changes(before, (await itemRow(id))!, ITEM_FIELDS), image && 'New picture'].filter(Boolean).join('; ');
      await audit(user, 'item_updated', await itemLabel(id), detail || 'No changes');
      return { ok: 'Item updated.', redirectTo: '/items' };
    }
    const newId = await items.createItem(user, input, image);
    const created = (await itemRow(newId))!;
    await audit(user, 'item_created', await itemLabel(newId), [created.unit && `Unit: ${created.unit}`, image ? 'With picture' : 'No picture'].filter(Boolean).join(' · '));
    return { ok: 'Item added.', redirectTo: '/items' };
  });
}

export async function setItemStatusAction(formData: FormData): Promise<ActionResult> {
  return runAction(['super_admin'], async (user) => {
    const active = field(formData, 'active') === '1';
    const id = requireId(rawField(formData, 'id'), 'item');
    await items.setItemStatus(user, id, active);
    await audit(user, active ? 'item_activated' : 'item_deactivated', await itemLabel(id));
    return { ok: active ? 'Item activated.' : 'Item deactivated.' };
  });
}

/** Import the valid rows of a previewed bulk upload. */
export async function importBulkAction(formData: FormData): Promise<ActionResult> {
  return runAction(['super_admin'], async (user) => {
    const token = field(formData, 'token');
    const preview = await bulk.loadPreview(token, user);
    const result = await bulk.importPreview(token, user);
    await audit(user, 'bulk_imported', preview.sheetName,
      `${result.imported} item(s) imported, ${result.units} unit(s) of opening stock, ${result.rejected} row(s) with errors, ${result.skipped} skipped`);
    const parts = [`${result.imported} item(s) imported.`];
    if (result.units) parts.push(`${result.units} unit(s) of opening stock added to the warehouse.`);
    if (result.rejected) parts.push(`${result.rejected} row(s) with errors were left out.`);
    if (result.skipped) parts.push(`${result.skipped} row(s) skipped because the item now exists.`);
    return { ok: parts.join(' '), redirectTo: '/items' };
  });
}

export async function discardBulkAction(formData: FormData): Promise<ActionResult> {
  return runAction(['super_admin'], async (user) => {
    const token = field(formData, 'token');
    const preview = await bulk.loadPreview(token, user);
    await bulk.discard(token, user);
    await audit(user, 'bulk_discarded', preview.sheetName, `${preview.rows.length} row(s) not imported`);
    return { redirectTo: '/items/bulk' };
  });
}

/** The Price & HSN screen sends hsn_<itemId> and price_<itemId> for every item it shows. */
export async function savePricingAction(formData: FormData): Promise<ActionResult> {
  return runAction(['super_admin'], async (user) => {
    const rows = new Map<number, items.PricingInput>();
    for (const [key, value] of formData.entries()) {
      const match = /^(hsn|price)_(\d{1,9})$/.exec(key);
      if (!match) continue;
      const id = Number(match[2]);
      const row = rows.get(id) ?? { id, hsn: '', price: '' };
      row[match[1] as 'hsn' | 'price'] = value;
      rows.set(id, row);
    }
    const ids = [...rows.keys()];
    type Price = Pick<ItemRow, 'id' | 'name' | 'size' | 'hsn' | 'price_paise'>;
    const snapshot = async () => new Map((await all<Price>(`SELECT id, name, size, hsn, price_paise FROM items WHERE id IN (${ids.map(() => '?').join(', ')})`, ...ids)).map((r) => [r.id, r]));
    const before = ids.length ? await snapshot() : new Map<number, Price>();
    const changed = await items.savePricing(user, [...rows.values()]);
    if (changed) {
      const after = await snapshot();
      const lines = [...after.values()].flatMap((a) => {
        const b = before.get(a.id);
        if (!b) return [];
        const diff = changes({ hsn: b.hsn, price: money(b.price_paise) }, { hsn: a.hsn, price: money(a.price_paise) }, { hsn: 'HSN', price: 'Price' });
        return diff ? [`${a.name} (${a.size}): ${diff}`] : [];
      });
      await audit(user, 'pricing_changed', `${changed} item(s)`, lines.join('\n'));
    }
    return { ok: changed ? `Saved ${changed} item(s).` : 'Nothing changed.' };
  });
}
