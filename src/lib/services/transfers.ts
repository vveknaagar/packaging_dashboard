import { all, get, insert, now, run, tx } from '../db';
import { AppError, ForbiddenError, NotFoundError } from '../errors';
import { canCreateTransfer, isDestUser, isSourceUser, isStore, isSuper, onBehalfNote } from '../permissions';
import type { LocationRow, SessionUser, TransferDetail, TransferEvent, TransferLine, TransferRow, TransferStatus } from '../types';
import { TRANSPORT_MODES } from '../transport';
import { clean, parseQty } from '../util';
import { processImage, saveProcessed, type ProcessedImage } from './images';
import { partnerForTransfer } from './logistics';
import * as stock from './stock';

export const STATUS_LABELS: Record<TransferStatus, string> = {
  draft: 'Draft',
  dispatched: 'Pending approval',
  completed: 'Completed',
  discrepancy: 'Received with Discrepancy',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export const EVENT_LABELS: Record<string, string> = {
  created: 'Transfer created',
  updated: 'Draft updated',
  dispatched: 'Dispatched, waiting for approval',
  received: 'Approved, received in full',
  discrepancy: 'Approved with discrepancy',
  rejected: 'Rejected by destination',
  cancelled: 'Cancelled by source',
};

/** "2627" for the Indian financial year April 2026 to March 2027, using the date in India. */
export function financialYearCode(date = new Date()): string {
  const [year, month] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' })
    .format(date).split('-').map(Number);
  const start = month >= 4 ? year : year - 1;
  return `${String(start % 100).padStart(2, '0')}${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * The next number in the sending location's series for this financial year:
 * its code, the year and a running count, e.g. SU2627-01. Each location and
 * each year has its own series, starting at 01.
 */
async function nextNumber(source: LocationRow): Promise<string> {
  const prefix = `${source.code.toUpperCase()}${financialYearCode()}`;
  const last = (await get<{ n: number | null }>(
    `SELECT MAX(CAST(substr(number, ?::integer) AS INTEGER)) AS n FROM transfers
     WHERE source_id = ? AND number LIKE ?::text || '-%'`, prefix.length + 2, source.id, prefix))!.n ?? 0;
  return `${prefix}-${String(last + 1).padStart(2, '0')}`;
}

function cleanTransport(mode: unknown, ref: unknown) {
  const transportMode = typeof mode === 'string' ? mode : '';
  if (!(transportMode in TRANSPORT_MODES)) throw new AppError('Choose the mode of transport.');
  return { transportMode, transportRef: clean(ref, 60) };
}

export interface RawLine {
  itemId: number;
  qty: unknown;
}

export function getTransfer(id: number): Promise<TransferDetail | undefined> {
  return get<TransferDetail>(
    `SELECT t.*, s.name AS source_name, s.code AS source_code,
            s.address AS source_address, s.gstin AS source_gstin,
            (SELECT u.name FROM users u WHERE u.location_id = s.id AND u.active = 1 ORDER BY u.id LIMIT 1) AS source_contact,
            (SELECT u.phone FROM users u WHERE u.location_id = s.id AND u.active = 1 ORDER BY u.id LIMIT 1) AS source_phone,
            d.name AS dest_name, d.code AS dest_code,
            d.address AS dest_address, d.gstin AS dest_gstin,
            d.city AS dest_city, d.state AS dest_state, d.pincode AS dest_pincode,
            (SELECT u.name FROM users u WHERE u.location_id = d.id AND u.active = 1 ORDER BY u.id LIMIT 1) AS dest_contact,
            (SELECT u.phone FROM users u WHERE u.location_id = d.id AND u.active = 1 ORDER BY u.id LIMIT 1) AS dest_phone,
            cu.name AS created_by_name, du.name AS dispatched_by_name,
            ru.name AS received_by_name, xu.name AS closed_by_name,
            lp.name AS partner_name, lp.phone AS partner_phone
     FROM transfers t
     JOIN locations s ON s.id = t.source_id
     JOIN locations d ON d.id = t.dest_id
     JOIN users cu ON cu.id = t.created_by
     LEFT JOIN users du ON du.id = t.dispatched_by
     LEFT JOIN users ru ON ru.id = t.received_by
     LEFT JOIN users xu ON xu.id = t.closed_by
     LEFT JOIN logistics_partners lp ON lp.id = t.logistics_partner_id
     WHERE t.id = ?`, id);
}

export function getLines(transferId: number): Promise<TransferLine[]> {
  return all<TransferLine>(
    `SELECT ti.id, ti.item_id, ti.qty_sent, ti.qty_received, ti.hsn, ti.rate_paise,
            i.name, i.size, i.unit, i.thumb, i.image
     FROM transfer_items ti JOIN items i ON i.id = ti.item_id
     WHERE ti.transfer_id = ?
     ORDER BY i.name, i.size`, transferId);
}

export interface ItemTransfer {
  id: number;
  number: string;
  status: TransferStatus;
  dispatched_at: string;
  source_name: string;
  dest_name: string;
  qty_sent: number;
  qty_received: number | null;
}

/**
 * The dispatched transfers that carried one item, newest first. A Store Admin
 * only gets the ones that left or reached their own store.
 */
export function itemTransfers(user: SessionUser, itemId: number, limit = 10): Promise<ItemTransfer[]> {
  const own = isStore(user) ? [user.location_id!, user.location_id!] : [];
  return all<ItemTransfer>(
    `SELECT t.id, t.number, t.status, t.dispatched_at, s.name AS source_name, d.name AS dest_name,
            ti.qty_sent, ti.qty_received
     FROM transfer_items ti
     JOIN transfers t ON t.id = ti.transfer_id
     JOIN locations s ON s.id = t.source_id
     JOIN locations d ON d.id = t.dest_id
     WHERE ti.item_id = ? AND t.dispatched_at IS NOT NULL
       ${own.length ? 'AND (t.source_id = ? OR t.dest_id = ?)' : ''}
     ORDER BY t.dispatched_at DESC, t.id DESC LIMIT ?`,
    itemId, ...own, limit);
}

export interface PendingApproval {
  id: number;
  number: string;
  dispatched_at: string;
  source_name: string;
  line_count: number;
  units: number;
}

/**
 * Dispatched transfers waiting for this user's location to check and approve,
 * oldest first. Only a location's own admins approve; the Super Admin has no
 * location, so this is empty for them unless they switch to a store user.
 */
export async function pendingApprovals(user: SessionUser): Promise<PendingApproval[]> {
  if (!user.location_id) return [];
  return all<PendingApproval>(
    `SELECT t.id, t.number, t.dispatched_at, s.name AS source_name,
            (SELECT COUNT(*) FROM transfer_items ti WHERE ti.transfer_id = t.id) AS line_count,
            (SELECT COALESCE(SUM(qty_sent), 0) FROM transfer_items ti WHERE ti.transfer_id = t.id) AS units
     FROM transfers t JOIN locations s ON s.id = t.source_id
     WHERE t.dest_id = ? AND t.status = 'dispatched'
     ORDER BY t.dispatched_at, t.id`, user.location_id);
}

export function getEvents(transferId: number): Promise<TransferEvent[]> {
  return all<TransferEvent>(
    `SELECT e.*, u.name AS user_name
     FROM transfer_events e JOIN users u ON u.id = e.user_id
     WHERE e.transfer_id = ? ORDER BY e.id`, transferId);
}

async function addEvent(transferId: number, user: SessionUser, event: string, detail = '') {
  await run('INSERT INTO transfer_events (transfer_id, user_id, ts, event, detail) VALUES (?, ?, ?, ?, ?)',
    transferId, user.id, now(), event, `${detail} ${onBehalfNote(user)}`.trim());
}

async function notify(userIds: number[], message: string, transferId: number, exceptUserId: number) {
  const ts = now();
  for (const userId of new Set(userIds)) {
    if (userId !== exceptUserId) {
      await run('INSERT INTO notifications (user_id, ts, message, transfer_id) VALUES (?, ?, ?, ?)', userId, ts, message, transferId);
    }
  }
}

const usersAt = async (locationId: number) =>
  (await all<{ id: number }>('SELECT id FROM users WHERE active = 1 AND location_id = ?', locationId)).map((u) => u.id);
const warehouseAdmins = async () =>
  (await all<{ id: number }>("SELECT id FROM users WHERE active = 1 AND role = 'warehouse_admin'")).map((u) => u.id);
const locationName = async (id: number) => (await get<{ name: string }>('SELECT name FROM locations WHERE id = ?', id))!.name;

/** Turn submitted form lines into validated [{ itemId, qty }]. */
async function normaliseLines(sourceId: number, rawLines: RawLine[]) {
  const lines: { itemId: number; qty: number }[] = [];
  const seen = new Set<number>();
  for (const raw of rawLines) {
    const itemId = Number(raw.itemId);
    const qty = parseQty(raw.qty);
    if (qty === null) throw new AppError('Quantities must be whole numbers.');
    if (qty === 0) continue;
    if (seen.has(itemId)) throw new AppError('The same item was added twice.');
    seen.add(itemId);
    const item = await get<{ id: number; name: string; size: string; active: number }>(
      'SELECT id, name, size, active FROM items WHERE id = ?', itemId);
    if (!item) throw new AppError('One of the selected items no longer exists.');
    if (!item.active) throw new AppError(`${item.name} (${item.size}) is deactivated and cannot be transferred.`);
    const available = await stock.getQty(itemId, sourceId);
    if (qty > available) {
      throw new AppError(`${item.name} (${item.size}): only ${available} available, cannot send ${qty}.`);
    }
    lines.push({ itemId, qty });
  }
  if (!lines.length) throw new AppError('Add at least one item with a quantity greater than zero.');
  return lines;
}

async function checkRoute(user: SessionUser, sourceId: number | null, destId: number) {
  if (!canCreateTransfer(user)) throw new ForbiddenError('You are not allowed to create transfers.');
  const source = sourceId ? await get<LocationRow>('SELECT * FROM locations WHERE id = ?', sourceId) : undefined;
  if (!source) throw new AppError('Choose the location to send from.');
  if (!source.active) throw new AppError(`${source.name} is inactive and cannot send transfers.`);
  const dest = await get<LocationRow>('SELECT * FROM locations WHERE id = ?', destId);
  if (!dest || dest.type !== 'store') throw new AppError('Choose a destination store.');
  if (!dest.active) throw new AppError(`${dest.name} is inactive and cannot receive transfers.`);
  if (dest.id === source.id) throw new AppError('Source and destination must be different.');
  return { source, dest };
}

async function loadForAction(id: number): Promise<TransferRow> {
  const transfer = await get<TransferRow>('SELECT * FROM transfers WHERE id = ?', id);
  if (!transfer) throw new NotFoundError('Transfer not found.');
  return transfer;
}

/**
 * The sender must photograph the packed parcel to dispatch it. Checked and
 * resized before the transaction starts, so the database is not held up.
 */
async function parcelPhotoFor(photo: Buffer | null | undefined): Promise<ProcessedImage> {
  if (!photo?.length) throw new AppError('Upload a photo of the packed parcel to dispatch it.');
  return processImage(photo);
}

async function dispatchInTx(transfer: TransferRow, user: SessionUser, photo: ProcessedImage) {
  const dest =(await get<LocationRow>('SELECT * FROM locations WHERE id = ?', transfer.dest_id))!;
  if (!dest.active) throw new AppError(`${dest.name} is inactive and cannot receive transfers.`);
  const lines = await getLines(transfer.id);
  if (!lines.length) throw new AppError('This transfer has no items.');
  let units = 0;
  for (const line of lines) {
    // Throws (and rolls the whole dispatch back) if any line exceeds available stock.
    await stock.changeStock({
      itemId: line.item_id,
      locationId: transfer.source_id,
      delta: -line.qty_sent,
      type: 'transfer_out',
      reason: `Dispatched on ${transfer.number} to ${dest.name}`,
      userId: user.id,
      transferId: transfer.id,
    });
    units += line.qty_sent;
  }
  // Freeze each item's HSN code and price on the line, so later price changes do not alter this delivery challan.
  await run(`UPDATE transfer_items SET
         hsn = (SELECT hsn FROM items WHERE items.id = transfer_items.item_id),
         rate_paise = (SELECT price_paise FROM items WHERE items.id = transfer_items.item_id)
       WHERE transfer_id = ?`, transfer.id);
  const parcel = await saveProcessed(photo, 'parcels');
  await run(`UPDATE transfers SET status = 'dispatched', dispatched_by = ?, dispatched_at = ?, parcel_image = ?, parcel_thumb = ?
             WHERE id = ?`, user.id, now(), parcel.image, parcel.thumb, transfer.id);
  await addEvent(transfer.id, user, 'dispatched', `${lines.length} item(s), ${units} unit(s) deducted from source and now in transit`);
  await notify(await usersAt(transfer.dest_id),
    `Incoming transfer ${transfer.number} from ${await locationName(transfer.source_id)} is waiting for your approval. Check the items, then approve or reject it.`,
    transfer.id, user.id);
}

interface SaveInput {
  user: SessionUser;
  /** Only the Super Admin chooses this. Everyone else always sends from their own location. */
  sourceId?: number | null;
  destId: number;
  rawLines: RawLine[];
  note: unknown;
  /** A key of TRANSPORT_MODES. */
  transportMode: unknown;
  /** Vehicle, LR or docket number. Optional. */
  transportRef: unknown;
  /** Id of the logistic partner from the Super Admin's list. Optional. */
  partnerId?: unknown;
  dispatchNow: boolean;
  /** The uploaded photo of the packed parcel. Required when dispatching. */
  parcelPhoto?: Buffer | null;
}

/** Create a transfer from the user's own location (the Super Admin names one). Optionally dispatch it straight away. */
export async function create({ user, sourceId, destId, rawLines, note, transportMode, transportRef, partnerId, dispatchNow, parcelPhoto }: SaveInput): Promise<number> {
  const photo = dispatchNow ? await parcelPhotoFor(parcelPhoto) : null;
  return tx(async () => {
    const { source, dest } = await checkRoute(user, isSuper(user) ? sourceId ?? null : user.location_id, destId);
    const lines = await normaliseLines(source.id, rawLines);
    const transport = cleanTransport(transportMode, transportRef);
    const partner = await partnerForTransfer(partnerId);
    const id = await insert(
      `INSERT INTO transfers (number, source_id, dest_id, status, note, transport_mode, transport_ref, logistics_partner_id, created_by, created_at)
       VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`,
      await nextNumber(source), source.id, dest.id, clean(note, 500), transport.transportMode, transport.transportRef, partner, user.id, now());
    for (const line of lines) {
      await run('INSERT INTO transfer_items (transfer_id, item_id, qty_sent) VALUES (?, ?, ?)', id, line.itemId, line.qty);
    }
    await addEvent(id, user, 'created', `${source.name} to ${dest.name}`);
    if (photo) await dispatchInTx(await loadForAction(id), user, photo);
    return id;
  });
}

/** Replace the destination, note and lines of a draft. */
export async function updateDraft({ user, id, destId, rawLines, note, transportMode, transportRef, partnerId, dispatchNow, parcelPhoto }: SaveInput & { id: number }): Promise<number> {
  const photo = dispatchNow ? await parcelPhotoFor(parcelPhoto) : null;
  return tx(async () => {
    const transfer = await loadForAction(id);
    if (!isSourceUser(user, transfer)) throw new ForbiddenError('Only the source location can edit this transfer.');
    if (transfer.status !== 'draft') throw new AppError('Only a draft can be edited.');
    const { dest } = await checkRoute(user, transfer.source_id, destId);
    const lines = await normaliseLines(transfer.source_id, rawLines);
    const transport = cleanTransport(transportMode, transportRef);
    const partner = await partnerForTransfer(partnerId);
    await run('UPDATE transfers SET dest_id = ?, note = ?, transport_mode = ?, transport_ref = ?, logistics_partner_id = ? WHERE id = ?',
      dest.id, clean(note, 500), transport.transportMode, transport.transportRef, partner, id);
    await run('DELETE FROM transfer_items WHERE transfer_id = ?', id);
    for (const line of lines) {
      await run('INSERT INTO transfer_items (transfer_id, item_id, qty_sent) VALUES (?, ?, ?)', id, line.itemId, line.qty);
    }
    await addEvent(id, user, 'updated');
    if (photo) await dispatchInTx(await loadForAction(id), user, photo);
    return id;
  });
}

export async function dispatch({ user, id, parcelPhoto }: { user: SessionUser; id: number; parcelPhoto?: Buffer | null }): Promise<void> {
  const photo = await parcelPhotoFor(parcelPhoto);
  await tx(async () => {
    const transfer = await loadForAction(id);
    if (!isSourceUser(user, transfer)) throw new ForbiddenError('Only the source location can dispatch this transfer.');
    if (transfer.status !== 'draft') throw new AppError('This transfer has already been dispatched or closed.');
    await dispatchInTx(transfer, user, photo);
  });
}

interface ReceiveInput {
  user: SessionUser;
  id: number;
  /** Quantity typed by the receiver for each transfer line id. */
  received: Record<number, unknown>;
  remark: unknown;
}

/**
 * Destination confirms what physically arrived. Stock is added to the
 * destination only here, and only for the received quantity.
 */
export function receive({ user, id, received, remark }: ReceiveInput): Promise<TransferStatus> {
  return tx(async () => {
    const transfer = await loadForAction(id);
    if (!isDestUser(user, transfer)) throw new ForbiddenError('Only the destination location can receive this transfer.');
    if (transfer.status !== 'dispatched') throw new AppError('This transfer is not waiting to be received.');
    const note = clean(remark, 500);
    const lines = await getLines(id);
    const sourceName = await locationName(transfer.source_id);
    const destName = await locationName(transfer.dest_id);
    const differences: string[] = [];

    for (const line of lines) {
      const qty = parseQty(received[line.id]);
      if (qty === null) throw new AppError(`Enter the received quantity for ${line.name} (${line.size}).`);
      await run('UPDATE transfer_items SET qty_received = ? WHERE id = ?', qty, line.id);
      await stock.changeStock({
        itemId: line.item_id,
        locationId: transfer.dest_id,
        delta: qty,
        type: 'transfer_in',
        reason: `Received on ${transfer.number} from ${sourceName}`,
        userId: user.id,
        transferId: id,
      });
      if (qty !== line.qty_sent) differences.push(`${line.name} (${line.size}): sent ${line.qty_sent}, received ${qty}`);
    }

    const hasDiscrepancy = differences.length > 0;
    if (hasDiscrepancy && !note) {
      throw new AppError('Received quantities differ from what was sent. A remark explaining the difference is required.');
    }
    const status: TransferStatus = hasDiscrepancy ? 'discrepancy' : 'completed';
    await run('UPDATE transfers SET status = ?, received_by = ?, received_at = ?, receive_remark = ? WHERE id = ?',
      status, user.id, now(), note, id);

    if (hasDiscrepancy) {
      await addEvent(id, user, 'discrepancy', `${differences.join('; ')}. Remark: ${note}`);
      await notify([...await warehouseAdmins(), ...await usersAt(transfer.source_id)],
        `Discrepancy on ${transfer.number} (${sourceName} to ${destName}): ${differences.length} item(s) differ. Remark: ${note}`,
        id, user.id);
    } else {
      await addEvent(id, user, 'received', note);
      await notify(await usersAt(transfer.source_id), `${transfer.number} was received in full by ${destName}.`, id, user.id);
    }
    return status;
  });
}

/** Put every dispatched line back into the source location. */
async function returnToSource(transfer: TransferRow, user: SessionUser, why: string) {
  for (const line of await getLines(transfer.id)) {
    await stock.changeStock({
      itemId: line.item_id,
      locationId: transfer.source_id,
      delta: line.qty_sent,
      type: 'transfer_return',
      reason: `${why} (${transfer.number})`,
      userId: user.id,
      transferId: transfer.id,
    });
  }
}

export async function reject({ user, id, reason }: { user: SessionUser; id: number; reason: unknown }): Promise<void> {
  await tx(async () => {
    const transfer = await loadForAction(id);
    if (!isDestUser(user, transfer)) throw new ForbiddenError('Only the destination location can reject this transfer.');
    if (transfer.status !== 'dispatched') throw new AppError('This transfer is not waiting to be received.');
    const why = clean(reason, 500);
    if (!why) throw new AppError('A reason is required to reject a transfer.');
    await returnToSource(transfer, user, 'Transfer rejected by destination');
    await run("UPDATE transfers SET status = 'rejected', closed_by = ?, closed_at = ?, closed_reason = ? WHERE id = ?",
      user.id, now(), why, id);
    await addEvent(id, user, 'rejected', `Stock returned to source. Reason: ${why}`);
    await notify([...await usersAt(transfer.source_id), ...await warehouseAdmins()],
      `${transfer.number} was rejected by ${await locationName(transfer.dest_id)} and the stock has been returned. Reason: ${why}`,
      id, user.id);
  });
}

export async function cancel({ user, id, reason }: { user: SessionUser; id: number; reason: unknown }): Promise<void> {
  await tx(async () => {
    const transfer = await loadForAction(id);
    if (!isSourceUser(user, transfer)) throw new ForbiddenError('Only the source location can cancel this transfer.');
    if (transfer.status !== 'draft' && transfer.status !== 'dispatched') {
      throw new AppError('This transfer can no longer be cancelled.');
    }
    const why = clean(reason, 500);
    const wasDispatched = transfer.status === 'dispatched';
    if (wasDispatched) {
      if (!why) throw new AppError('A reason is required to cancel a dispatched transfer.');
      await returnToSource(transfer, user, 'Transfer cancelled by source');
    }
    await run("UPDATE transfers SET status = 'cancelled', closed_by = ?, closed_at = ?, closed_reason = ? WHERE id = ?",
      user.id, now(), why, id);
    await addEvent(id, user, 'cancelled',
      [wasDispatched ? 'Stock returned to source.' : '', why ? `Reason: ${why}` : ''].filter(Boolean).join(' '));
    if (wasDispatched) {
      await notify(await usersAt(transfer.dest_id),
        `${transfer.number} from ${await locationName(transfer.source_id)} was cancelled before receipt.`, id, user.id);
    }
  });
}
