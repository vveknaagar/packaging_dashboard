'use server';

import { runAction } from '@/lib/action';
import * as stock from '@/lib/services/stock';
import * as transfers from '@/lib/services/transfers';
import type { ActionResult } from '@/lib/types';
import { field, parseId, rawField, requireId } from '@/lib/util';

// Every role can reach these; the services decide which location each one may act for.
const STOCK_ROLES = ['super_admin', 'warehouse_admin', 'store_admin'] as const;

/** Stock In, Stock Out or Adjustment at the user's own location (any location for the Super Admin). */
export async function adjustStockAction(formData: FormData): Promise<ActionResult> {
  return runAction([...STOCK_ROLES], async (user) => {
    const mode = field(formData, 'mode');
    const result = await stock.adjust({
      user,
      itemId: requireId(rawField(formData, 'item_id'), 'item'),
      locationId: requireId(rawField(formData, 'location_id'), 'location'),
      mode,
      qty: rawField(formData, 'qty'),
      reason: rawField(formData, 'reason'),
    });
    return { ok: `Stock updated: ${result.before} to ${result.after}.` };
  });
}

/** Lines arrive as one field per item: qty_<itemId> = quantity. */
function linesFrom(formData: FormData): transfers.RawLine[] {
  const lines: transfers.RawLine[] = [];
  for (const [key, value] of formData.entries()) {
    const match = /^qty_(\d{1,9})$/.exec(key);
    if (!match || typeof value !== 'string' || value.trim() === '') continue;
    lines.push({ itemId: Number(match[1]), qty: value });
  }
  return lines;
}

/** Create a transfer or update a draft. The button pressed decides whether it is dispatched too. */
export async function saveTransferAction(formData: FormData): Promise<ActionResult> {
  return runAction([...STOCK_ROLES], async (user) => {
    const dispatchNow = field(formData, 'intent') === 'dispatch';
    const input = {
      user,
      sourceId: parseId(rawField(formData, 'source_id')),
      destId: parseId(rawField(formData, 'dest_id')) ?? 0,
      rawLines: linesFrom(formData),
      note: rawField(formData, 'note'),
      transportMode: rawField(formData, 'transport_mode'),
      transportRef: rawField(formData, 'transport_ref'),
      dispatchNow,
    };
    const existingId = parseId(rawField(formData, 'id'));
    const id = existingId ? await transfers.updateDraft({ ...input, id: existingId }) : await transfers.create(input);
    return {
      ok: dispatchNow ? 'Transfer dispatched. Stock is now in transit.' : 'Draft saved.',
      redirectTo: `/transfers/${id}`,
    };
  });
}

export async function dispatchTransferAction(formData: FormData): Promise<ActionResult> {
  return runAction([...STOCK_ROLES], async (user) => {
    await transfers.dispatch({ user, id: requireId(rawField(formData, 'id'), 'transfer') });
    return { ok: 'Transfer dispatched. Stock is now in transit.' };
  });
}

/** Received quantities arrive as recv_<lineId> = quantity. */
export async function receiveTransferAction(formData: FormData): Promise<ActionResult> {
  return runAction([...STOCK_ROLES], async (user) => {
    const received: Record<number, unknown> = {};
    for (const [key, value] of formData.entries()) {
      const match = /^recv_(\d{1,9})$/.exec(key);
      if (match) received[Number(match[1])] = value;
    }
    const status = await transfers.receive({
      user,
      id: requireId(rawField(formData, 'id'), 'transfer'),
      received,
      remark: rawField(formData, 'remark'),
    });
    return {
      ok: status === 'discrepancy'
        ? 'Received with discrepancy. Only the received quantities were added and the Warehouse Admin has been notified.'
        : 'Transfer received. Stock has been added.',
    };
  });
}

export async function rejectTransferAction(formData: FormData): Promise<ActionResult> {
  return runAction([...STOCK_ROLES], async (user) => {
    await transfers.reject({ user, id: requireId(rawField(formData, 'id'), 'transfer'), reason: rawField(formData, 'reason') });
    return { ok: 'Transfer rejected. Stock has been returned to the source.' };
  });
}

export async function cancelTransferAction(formData: FormData): Promise<ActionResult> {
  return runAction([...STOCK_ROLES], async (user) => {
    await transfers.cancel({ user, id: requireId(rawField(formData, 'id'), 'transfer'), reason: rawField(formData, 'reason') });
    return { ok: 'Transfer cancelled.' };
  });
}
