'use server';

import { runAction } from '@/lib/action';
import { audit, itemLabel } from '@/lib/audit';
import { all, get } from '@/lib/db';
import { config } from '@/lib/config';
import { AppError } from '@/lib/errors';
import * as stock from '@/lib/services/stock';
import * as transfers from '@/lib/services/transfers';
import type { ActionResult } from '@/lib/types';
import { field, fmtNum, parseId, rawField, requireId } from '@/lib/util';

// Every role can reach these; the services decide which location each one may act for.
const STOCK_ROLES = ['super_admin', 'warehouse_admin', 'store_admin'] as const;

/** "TR-0012" and "Warehouse → Varachha Store · Kraft Box (Small) × 300, ..." for the audit log. */
async function transferInfo(id: number, received = false) {
  const t = await get<{ number: string; source: string; dest: string; partner: string | null }>(
    `SELECT t.number, s.name AS source, d.name AS dest, lp.name AS partner FROM transfers t
     JOIN locations s ON s.id = t.source_id JOIN locations d ON d.id = t.dest_id
     LEFT JOIN logistics_partners lp ON lp.id = t.logistics_partner_id WHERE t.id = ?`, id);
  const lines = await all<{ name: string; size: string; qty_sent: number; qty_received: number | null }>(
    `SELECT i.name, i.size, ti.qty_sent, ti.qty_received FROM transfer_items ti JOIN items i ON i.id = ti.item_id
     WHERE ti.transfer_id = ? ORDER BY i.name, i.size`, id);
  const list = lines.map((l) => `${l.name} (${l.size}) × ${fmtNum(l.qty_sent)}${received && l.qty_received !== l.qty_sent ? ` (received ${fmtNum(l.qty_received)})` : ''}`).join(', ');
  return { number: t?.number ?? `Transfer #${id}`, route: t ? `${t.source} → ${t.dest}${t.partner ? ` via ${t.partner}` : ''}` : '', list };
}

/** Stock In, Stock Out or Adjustment at the user's own location (any location for the Super Admin). */
export async function adjustStockAction(formData: FormData): Promise<ActionResult> {
  return runAction([...STOCK_ROLES], async (user) => {
    const mode = field(formData, 'mode');
    const itemId = requireId(rawField(formData, 'item_id'), 'item');
    const locationId = requireId(rawField(formData, 'location_id'), 'location');
    const result = await stock.adjust({
      user,
      itemId,
      locationId,
      mode,
      qty: rawField(formData, 'qty'),
      reason: rawField(formData, 'reason'),
    });
    const location = await get<{ name: string }>('SELECT name FROM locations WHERE id = ?', locationId);
    await audit(user, mode === 'in' ? 'stock_in' : mode === 'out' ? 'stock_out' : 'stock_set', await itemLabel(itemId),
      `${location?.name ?? ''}: ${fmtNum(result.before)} → ${fmtNum(result.after)}. Reason: ${field(formData, 'reason') || '(none)'}`);
    return { ok: `Stock updated: ${result.before} to ${result.after}.` };
  });
}

/** A store marks items sold: lines arrive as qty_<itemId> = quantity sold. */
export async function recordSaleAction(formData: FormData): Promise<ActionResult> {
  return runAction([...STOCK_ROLES], async (user) => {
    const locationId = requireId(rawField(formData, 'location_id'), 'store');
    const sold = await stock.recordSale({
      user,
      locationId,
      lines: linesFrom(formData),
      billNo: rawField(formData, 'bill_no'),
      customerName: rawField(formData, 'customer_name'),
      customerPhone: rawField(formData, 'customer_phone'),
      note: rawField(formData, 'note'),
    });
    const location = await get<{ name: string }>('SELECT name FROM locations WHERE id = ?', locationId);
    const list = (await Promise.all(sold.map(async (s) => `${await itemLabel(s.itemId)} × ${fmtNum(s.qty)}`))).join(', ');
    const note = field(formData, 'note');
    const phone = field(formData, 'customer_phone');
    const customer = `${field(formData, 'customer_name')}${phone ? ` (${phone})` : ''}`;
    await audit(user, 'items_sold', `${location?.name ?? ''} · Bill ${field(formData, 'bill_no')}`, `Customer: ${customer}. ${list}${note ? `. Note: ${note}` : ''}`);
    const units = sold.reduce((sum, s) => sum + s.qty, 0);
    return { ok: `Marked ${fmtNum(units)} unit(s) of ${sold.length} item(s) as sold.`, redirectTo: `/stock?location=${locationId}` };
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

/** The photo of the packed parcel, sent with a dispatch. The browser has already shrunk it. */
async function parcelPhotoFrom(formData: FormData): Promise<Buffer | null> {
  const file = formData.get('parcel_photo');
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > config.MAX_IMAGE_BYTES) throw new AppError('The parcel photo is larger than 2 MB.');
  return Buffer.from(await file.arrayBuffer());
}

/**
 * Create a transfer or update a draft. The button pressed decides whether it is also
 * dispatched (from the warehouse) or sent for the warehouse's approval (from a store).
 */
export async function saveTransferAction(formData: FormData): Promise<ActionResult> {
  return runAction([...STOCK_ROLES], async (user) => {
    const intent = field(formData, 'intent');
    const dispatchNow = intent === 'dispatch';
    const submitForApproval = intent === 'approval';
    const input = {
      user,
      sourceId: parseId(rawField(formData, 'source_id')),
      destId: parseId(rawField(formData, 'dest_id')) ?? 0,
      rawLines: linesFrom(formData),
      note: rawField(formData, 'note'),
      transportMode: rawField(formData, 'transport_mode'),
      transportRef: rawField(formData, 'transport_ref'),
      partnerId: rawField(formData, 'logistics_partner_id'),
      dispatchNow,
      submitForApproval,
      parcelPhoto: dispatchNow ? await parcelPhotoFrom(formData) : null,
    };
    const existingId = parseId(rawField(formData, 'id'));
    const id = existingId ? await transfers.updateDraft({ ...input, id: existingId }) : await transfers.create(input);
    const info = await transferInfo(id);
    await audit(user, dispatchNow ? 'transfer_dispatched' : submitForApproval ? 'transfer_submitted' : 'transfer_draft',
      info.number, `${info.route} · ${info.list}`);
    return {
      ok: dispatchNow ? 'Transfer dispatched. Stock is now in transit.'
        : submitForApproval ? 'Sent to the warehouse for approval. Nothing has left your stock yet.' : 'Draft saved.',
      redirectTo: `/transfers/${id}`,
    };
  });
}

/** A store sends a saved draft to the warehouse for approval. */
export async function sendForApprovalAction(formData: FormData): Promise<ActionResult> {
  return runAction([...STOCK_ROLES], async (user) => {
    const id = requireId(rawField(formData, 'id'), 'transfer');
    await transfers.sendForApproval({ user, id });
    const info = await transferInfo(id);
    await audit(user, 'transfer_submitted', info.number, `${info.route} · ${info.list}`);
    return { ok: 'Sent to the warehouse for approval. Nothing has left your stock yet.' };
  });
}

export async function approveTransferAction(formData: FormData): Promise<ActionResult> {
  return runAction(['super_admin', 'warehouse_admin'], async (user) => {
    const id = requireId(rawField(formData, 'id'), 'transfer');
    await transfers.approve({ user, id });
    const info = await transferInfo(id);
    await audit(user, 'transfer_approved', info.number, `${info.route} · ${info.list}`);
    return { ok: 'Transfer approved. The store can now dispatch it.' };
  });
}

export async function declineTransferAction(formData: FormData): Promise<ActionResult> {
  return runAction(['super_admin', 'warehouse_admin'], async (user) => {
    const id = requireId(rawField(formData, 'id'), 'transfer');
    await transfers.decline({ user, id, reason: rawField(formData, 'reason') });
    const info = await transferInfo(id);
    await audit(user, 'transfer_declined', info.number, `${info.route}. Reason: ${field(formData, 'reason')}`);
    return { ok: 'Transfer declined. The store has been told why.' };
  });
}

export async function dispatchTransferAction(formData: FormData): Promise<ActionResult> {
  return runAction([...STOCK_ROLES], async (user) => {
    const id = requireId(rawField(formData, 'id'), 'transfer');
    await transfers.dispatch({ user, id, parcelPhoto: await parcelPhotoFrom(formData) });
    const info = await transferInfo(id);
    await audit(user, 'transfer_dispatched', info.number, `${info.route} · ${info.list}`);
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
    const id = requireId(rawField(formData, 'id'), 'transfer');
    const status = await transfers.receive({
      user,
      id,
      received,
      remark: rawField(formData, 'remark'),
    });
    const info = await transferInfo(id, true);
    const remark = field(formData, 'remark');
    await audit(user, status === 'discrepancy' ? 'transfer_discrepancy' : 'transfer_received', info.number,
      `${info.route} · ${info.list}${remark ? `. Remark: ${remark}` : ''}`);
    return {
      ok: status === 'discrepancy'
        ? 'Received with discrepancy. Only the received quantities were added and the Warehouse Admin has been notified.'
        : 'Transfer received. Stock has been added.',
    };
  });
}

export async function rejectTransferAction(formData: FormData): Promise<ActionResult> {
  return runAction([...STOCK_ROLES], async (user) => {
    const id = requireId(rawField(formData, 'id'), 'transfer');
    await transfers.reject({ user, id, reason: rawField(formData, 'reason') });
    const info = await transferInfo(id);
    await audit(user, 'transfer_rejected', info.number, `${info.route}. Reason: ${field(formData, 'reason')}`);
    return { ok: 'Transfer rejected. Stock has been returned to the source.' };
  });
}

export async function cancelTransferAction(formData: FormData): Promise<ActionResult> {
  return runAction([...STOCK_ROLES], async (user) => {
    const id = requireId(rawField(formData, 'id'), 'transfer');
    await transfers.cancel({ user, id, reason: rawField(formData, 'reason') });
    const info = await transferInfo(id);
    await audit(user, 'transfer_cancelled', info.number, `${info.route}${field(formData, 'reason') ? `. Reason: ${field(formData, 'reason')}` : ''}`);
    return { ok: 'Transfer cancelled.' };
  });
}
