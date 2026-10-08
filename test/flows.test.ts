/**
 * Tests for the rules that protect stock: permissions, the ledger, and the
 * transfer flow. They run against a throwaway database in a temp folder.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import zlib from 'node:zlib';

/** Build a small uncompressed ZIP in memory, so the import can be tested with image files. */
function storedZip(files: Record<string, Buffer>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt32LE(offset, 42);
    parts.push(local, nameBytes, data);
    central.push(header, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'packaging-test-'));
process.env.DATA_DIR = dataDir;

type Db = typeof import('../src/lib/db');
type Stock = typeof import('../src/lib/services/stock');
type Transfers = typeof import('../src/lib/services/transfers');
type Items = typeof import('../src/lib/services/items');
type Locations = typeof import('../src/lib/services/locations');
type Users = typeof import('../src/lib/services/users');
type Bulk = typeof import('../src/lib/services/bulk');
type Perms = typeof import('../src/lib/permissions');
type SessionUser = import('../src/lib/types').SessionUser;

let db: Db;
let stock: Stock;
let transfers: Transfers;
let items: Items;
let locations: Locations;
let users: Users;
let bulk: Bulk;
let perms: Perms;

let superAdmin: SessionUser;
let whAdmin: SessionUser;
let storeA: SessionUser;
let storeB: SessionUser;
let boxId: number;
let tapeId: number;
let pngBuffer: Buffer;

function loadUser(id: number): SessionUser {
  return db.get<SessionUser>(
    `SELECT u.id, u.name, u.username, u.role, u.location_id, l.name AS location_name, l.type AS location_type
     FROM users u LEFT JOIN locations l ON l.id = u.location_id WHERE u.id = ?`, id)!;
}

const qty = (itemId: number, user: SessionUser) => stock.getQty(itemId, user.location_id!);
const isAppError = (pattern: RegExp) => (err: unknown) => {
  assert.ok(err instanceof Error && err.name.endsWith('Error') && 'status' in err, `expected an AppError, got ${err}`);
  assert.match((err as Error).message, pattern);
  return true;
};

before(async () => {
  db = await import('../src/lib/db');
  stock = await import('../src/lib/services/stock');
  transfers = await import('../src/lib/services/transfers');
  items = await import('../src/lib/services/items');
  locations = await import('../src/lib/services/locations');
  users = await import('../src/lib/services/users');
  bulk = await import('../src/lib/services/bulk');
  perms = await import('../src/lib/permissions');
  const sharp = (await import('sharp')).default;
  pngBuffer = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#c9a26b' } }).png().toBuffer();

  // A fake hash keeps the tests fast; password hashing is covered separately.
  superAdmin = loadUser(users.insertUser('Root', 'root', 'x', 'super_admin', null));
  whAdmin = loadUser(users.insertUser('Wanda', 'wanda', 'x', 'warehouse_admin', db.warehouseId()));
  const storeAId = await locations.createStore(superAdmin, { name: 'Store A', code: 'STA', address: 'Ring Road', gstin: '24ABCDE1234F1Z5' }, null);
  const storeBId = await locations.createStore(superAdmin, { name: 'Store B', code: 'STB', address: 'Ring Road', gstin: '24ABCDE1234F1Z5' }, null);
  storeA = loadUser(users.insertUser('Asha', 'asha', 'x', 'store_admin', storeAId));
  storeB = loadUser(users.insertUser('Bela', 'bela', 'x', 'store_admin', storeBId));

  boxId = await items.createItem(superAdmin, { name: 'Kraft Box', size: 'Small', unit: 'pcs' }, pngBuffer);
  tapeId = await items.createItem(superAdmin, { name: 'Tape', size: '48mm', unit: 'roll' }, pngBuffer);
  stock.adjust({ user: whAdmin, itemId: boxId, locationId: whAdmin.location_id!, mode: 'in', qty: '500', reason: 'Opening stock' });
  stock.adjust({ user: whAdmin, itemId: tapeId, locationId: whAdmin.location_id!, mode: 'in', qty: '40', reason: 'Opening stock' });
});

after(() => {
  db.db().close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('locations', () => {
  test('there is exactly one warehouse and a second cannot be created', () => {
    assert.equal(db.all("SELECT id FROM locations WHERE type = 'warehouse'").length, 1);
    assert.throws(() => db.run("INSERT INTO locations (type, name, code, created_at) VALUES ('warehouse', 'W2', 'W2', 'now')"));
  });

  test('only the Super Admin can add stores, and codes are unique', async () => {
    await assert.rejects(locations.createStore(whAdmin, { name: 'X', code: 'X1', address: 'Ring Road', gstin: '24ABCDE1234F1Z5' }, null), isAppError(/Only the Super Admin/));
    await assert.rejects(locations.createStore(superAdmin, { name: 'Dup', code: 'sta', address: 'Ring Road', gstin: '24ABCDE1234F1Z5' }, null), isAppError(/already used/));
  });

  test('a store needs an address and a valid GSTIN', async () => {
    await assert.rejects(locations.createStore(superAdmin, { name: 'X', code: 'X1', address: '', gstin: '24ABCDE1234F1Z5' }, null), isAppError(/Address is required/));
    await assert.rejects(locations.createStore(superAdmin, { name: 'X', code: 'X1', address: 'Ring Road', gstin: '' }, null), isAppError(/GSTIN is required/));
    await assert.rejects(locations.createStore(superAdmin, { name: 'X', code: 'X1', address: 'Ring Road', gstin: 'NOT-A-GSTIN' }, null), isAppError(/15 characters/));
    // Lower case and spaces are tidied up.
    const id = await locations.createStore(superAdmin, { name: 'Surat', code: 'su', address: 'Ring Road', gstin: '24abcde1234f1z5 ' }, null);
    assert.deepEqual(db.get('SELECT code, gstin FROM locations WHERE id = ?', id), { code: 'SU', gstin: '24ABCDE1234F1Z5' });
  });

  test('the financial year code runs April to March', () => {
    assert.equal(transfers.financialYearCode(new Date('2026-10-08T12:00:00Z')), '2627');
    assert.equal(transfers.financialYearCode(new Date('2027-03-31T12:00:00Z')), '2627');
    // 1 April 2027 00:30 in India is still 31 March in UTC.
    assert.equal(transfers.financialYearCode(new Date('2027-03-31T19:00:00Z')), '2728');
  });
});

describe('location contact', () => {
  test('a location has no contact fields of its own: its contact is its admin', async () => {
    const id = await locations.createStore(superAdmin, { name: 'Store C', code: 'STC', address: 'Ring Road', gstin: '24ABCDE1234F1Z5' },
      { name: 'chetan', username: 'chetan', phone: '98765 43210', password: 'pw' });
    assert.deepEqual(locations.allContacts().get(id), [{ name: 'Chetan', phone: '98765 43210' }]);
    // A second admin is listed too, and editing a user's phone changes the location's contact.
    const second = await users.createUser(superAdmin, { name: 'Dev', username: 'dev', phone: '', role: 'store_admin', locationId: id, password: 'pw' });
    await users.updateUser(superAdmin, second, { name: 'Dev', phone: '+91 261 400 500', role: 'store_admin', locationId: id, active: true, password: '' });
    assert.deepEqual(locations.allContacts().get(id), [{ name: 'Chetan', phone: '98765 43210' }, { name: 'Dev', phone: '+91 261 400 500' }]);
    // A deactivated admin is no longer a contact.
    await users.updateUser(superAdmin, second, { name: 'Dev', phone: '+91 261 400 500', role: 'store_admin', locationId: id, active: false, password: '' });
    assert.equal(locations.allContacts().get(id)!.length, 1);
    assert.equal(locations.allContacts().get(storeA.location_id!)![0].name, 'Asha');
    await assert.rejects(users.createUser(superAdmin, { name: 'Bad', username: 'badphone', phone: 'call me', role: 'store_admin', locationId: id, password: 'pw' }), isAppError(/Phone number/));
  });
});

describe('item master', () => {
  test('image, name and size are required', async () => {
    const base = { unit: '' };
    await assert.rejects(items.createItem(superAdmin, { ...base, name: 'No image', size: 'S' }, null), isAppError(/image is required/i));
    await assert.rejects(items.createItem(superAdmin, { ...base, name: '', size: 'S' }, pngBuffer), isAppError(/Name is required/));
    await assert.rejects(items.createItem(superAdmin, { ...base, name: 'N', size: ' ' }, pngBuffer), isAppError(/Size is required/));
    await assert.rejects(items.createItem(superAdmin, { ...base, name: 'Bad', size: 'S' }, Buffer.from('not an image')), isAppError(/not a valid image/));
  });

  test('name + size is unique regardless of capitals and spacing', async () => {
    const dup = { name: '  kraft   BOX ', size: 'small', unit: '' };
    await assert.rejects(items.createItem(superAdmin, dup, pngBuffer), isAppError(/already exists/));
  });

  test('a thumbnail is generated and stored with the image', () => {
    const item = db.get<{ image: string; thumb: string }>('SELECT image, thumb FROM items WHERE id = ?', boxId)!;
    assert.ok(fs.existsSync(path.join(dataDir, 'uploads', item.image)));
    assert.ok(fs.existsSync(path.join(dataDir, 'uploads', item.thumb)));
  });

  test('only the Super Admin can manage items', async () => {
    const input = { name: 'Sneaky', size: 'S', unit: '' };
    await assert.rejects(items.createItem(whAdmin, input, pngBuffer), isAppError(/Only the Super Admin/));
    assert.throws(() => items.setItemStatus(storeA, boxId, false), isAppError(/Only the Super Admin/));
  });

  test('items can be deactivated but never deleted', () => {
    items.setItemStatus(superAdmin, tapeId, false);
    assert.equal(db.get<{ active: number }>('SELECT active FROM items WHERE id = ?', tapeId)!.active, 0);
    items.setItemStatus(superAdmin, tapeId, true);
    assert.throws(() => db.run('DELETE FROM items WHERE id = ?', tapeId), /cannot be deleted/);
  });
});

describe('stock', () => {
  test('a Warehouse or Store Admin can edit only their own location', () => {
    const args = { itemId: boxId, mode: 'in', qty: '5', reason: 'test' };
    assert.throws(() => stock.adjust({ ...args, user: storeA, locationId: whAdmin.location_id! }), isAppError(/own location/));
    assert.throws(() => stock.adjust({ ...args, user: storeA, locationId: storeB.location_id! }), isAppError(/own location/));
    assert.throws(() => stock.adjust({ ...args, user: whAdmin, locationId: storeA.location_id! }), isAppError(/own location/));
  });

  test('a reason is mandatory and stock never goes below zero', () => {
    const base = { user: whAdmin, itemId: boxId, locationId: whAdmin.location_id! };
    assert.throws(() => stock.adjust({ ...base, mode: 'out', qty: '10', reason: '   ' }), isAppError(/reason is required/));
    assert.throws(() => stock.adjust({ ...base, mode: 'out', qty: '501', reason: 'too many' }), isAppError(/Not enough stock/));
    assert.throws(() => stock.adjust({ ...base, mode: 'out', qty: '-5', reason: 'negative' }), isAppError(/whole number/));
    assert.throws(() => stock.adjust({ ...base, mode: 'in', qty: '1.5', reason: 'fraction' }), isAppError(/whole number/));
    assert.equal(qty(boxId, whAdmin), 500);
    assert.throws(() => db.run('UPDATE stock SET qty = -1 WHERE item_id = ?', boxId), /CHECK constraint/);
  });

  test('every change writes a ledger entry with before and after', () => {
    stock.adjust({ user: whAdmin, itemId: boxId, locationId: whAdmin.location_id!, mode: 'out', qty: '20', reason: 'Damaged' });
    stock.adjust({ user: whAdmin, itemId: boxId, locationId: whAdmin.location_id!, mode: 'set', qty: '500', reason: 'Recount' });
    const rows = db.all<{ type: string; qty_change: number; qty_before: number; qty_after: number; reason: string; user_id: number }>(
      'SELECT * FROM stock_ledger WHERE item_id = ? ORDER BY id DESC LIMIT 2', boxId);
    assert.deepEqual(rows.map((r) => [r.type, r.qty_change, r.qty_before, r.qty_after, r.reason]),
      [['adjustment', 20, 480, 500, 'Recount'], ['stock_out', -20, 500, 480, 'Damaged']]);
    assert.equal(rows[0].user_id, whAdmin.id);
  });

  test('ledger entries cannot be changed or deleted', () => {
    assert.throws(() => db.run("UPDATE stock_ledger SET reason = 'edited'"), /permanent/);
    assert.throws(() => db.run('DELETE FROM stock_ledger'), /permanent/);
  });

  test('visibility: a Store Admin sees only their own store', () => {
    assert.equal(perms.canViewLocation(storeA, storeA.location_id!), true);
    assert.equal(perms.canViewLocation(storeA, storeB.location_id!), false);
    assert.equal(perms.canViewLocation(storeA, whAdmin.location_id!), false);
    assert.equal(perms.canViewLocation(whAdmin, storeB.location_id!), true);
    assert.equal(perms.canEditStock(whAdmin, storeB.location_id!), false);
  });
});

describe('transfers', () => {
  const lines = (n: number) => [{ itemId: boxId, qty: String(n) }];

  test('a draft moves no stock and is hidden from the destination', () => {
    const id = transfers.create({ user: whAdmin, destId: storeA.location_id!, rawLines: lines(100), note: '', transportMode: 'courier', transportRef: '', dispatchNow: false });
    const t = transfers.getTransfer(id)!;
    assert.equal(t.status, 'draft');
    // Numbered in the sending location's own series: code, financial year, running count.
    assert.equal(t.number, `WH${transfers.financialYearCode()}-01`);
    assert.equal(qty(boxId, whAdmin), 500);
    assert.equal(perms.canViewTransfer(storeA, t), false);
    assert.equal(perms.canViewTransfer(storeB, t), false);
    transfers.cancel({ user: whAdmin, id, reason: '' });
    assert.equal(transfers.getTransfer(id)!.status, 'cancelled');
    assert.equal(qty(boxId, whAdmin), 500);
  });

  test('quantity cannot exceed available stock', () => {
    assert.throws(() => transfers.create({ user: whAdmin, destId: storeA.location_id!, rawLines: lines(501), note: '', transportMode: 'courier', transportRef: '', dispatchNow: true }),
      isAppError(/only 500 available/));
  });

  test('only the Super Admin sets price and HSN, and dispatch freezes them on the slip', () => {
    assert.throws(() => items.savePricing(whAdmin, [{ id: boxId, hsn: '4819', price: '10' }]), isAppError(/Only the Super Admin/));
    assert.throws(() => items.savePricing(superAdmin, [{ id: boxId, hsn: '48', price: '10' }]), isAppError(/4, 6 or 8 digits/));
    assert.throws(() => items.savePricing(superAdmin, [{ id: boxId, hsn: '4819', price: '1.234' }]), isAppError(/not a valid price/));
    assert.equal(items.parsePrice('₹1,250.5'), 125050);
    assert.equal(items.parsePrice(''), null);

    assert.equal(items.savePricing(superAdmin, [{ id: boxId, hsn: '48191010', price: '12.50' }]), 1);
    assert.equal(items.savePricing(superAdmin, [{ id: boxId, hsn: '48191010', price: '12.5' }]), 0, 'unchanged rows are skipped');

    const draft = transfers.create({ user: whAdmin, destId: storeA.location_id!, rawLines: lines(2), note: '', transportMode: 'hand', transportRef: '', dispatchNow: false });
    assert.equal(transfers.getLines(draft)[0].rate_paise, null, 'a draft has no price yet');
    transfers.dispatch({ user: whAdmin, id: draft });
    // A later price change does not touch what was dispatched.
    items.savePricing(superAdmin, [{ id: boxId, hsn: '4819', price: '99' }]);
    const [line] = transfers.getLines(draft);
    assert.equal(line.hsn, '48191010');
    assert.equal(line.rate_paise, 1250);
    transfers.cancel({ user: whAdmin, id: draft, reason: 'test' });
  });

  test('a transfer needs a mode of transport', () => {
    assert.throws(() => transfers.create({ user: whAdmin, destId: storeA.location_id!, rawLines: lines(1), note: '', transportMode: '', transportRef: '', dispatchNow: false }),
      isAppError(/mode of transport/));
    assert.throws(() => transfers.create({ user: whAdmin, destId: storeA.location_id!, rawLines: lines(1), note: '', transportMode: 'teleport', transportRef: '', dispatchNow: false }),
      isAppError(/mode of transport/));
  });

  test('each sending location numbers its transfers in its own series', () => {
    const fy = transfers.financialYearCode();
    const before = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM transfers WHERE number LIKE 'WH%'")!.n;
    const a = transfers.create({ user: whAdmin, destId: storeA.location_id!, rawLines: lines(1), note: '', transportMode: 'hand', transportRef: 'GJ05AB1234', dispatchNow: false });
    const b = transfers.create({ user: whAdmin, destId: storeB.location_id!, rawLines: lines(1), note: '', transportMode: 'hand', transportRef: '', dispatchNow: false });
    assert.equal(transfers.getTransfer(a)!.number, `WH${fy}-${String(before + 1).padStart(2, '0')}`);
    assert.equal(transfers.getTransfer(b)!.number, `WH${fy}-${String(before + 2).padStart(2, '0')}`);
    assert.equal(transfers.getTransfer(a)!.transport_ref, 'GJ05AB1234');
    for (const id of [a, b]) transfers.cancel({ user: whAdmin, id, reason: '' });
  });

  test('dispatch deducts from source; receipt in full adds to destination', () => {
    const id = transfers.create({ user: whAdmin, destId: storeA.location_id!, rawLines: lines(100), note: 'Van 2', transportMode: 'courier', transportRef: '', dispatchNow: true });
    const t = transfers.getTransfer(id)!;
    assert.equal(t.status, 'dispatched');
    assert.equal(qty(boxId, whAdmin), 400);
    assert.equal(qty(boxId, storeA), 0, 'nothing reaches the store before it confirms receipt');
    assert.equal(stock.inTransit(whAdmin.location_id!, 'outgoing').get(boxId), 100);
    assert.equal(stock.inTransit(storeA.location_id!, 'incoming').get(boxId), 100);
    assert.equal(perms.canViewTransfer(storeA, t), true);
    assert.equal(perms.canViewTransfer(storeB, t), false, 'an uninvolved store cannot see it');
    // It shows as pending approval for the destination only, until approved.
    assert.deepEqual(transfers.pendingApprovals(storeA).map((p) => p.id), [id]);
    assert.equal(transfers.pendingApprovals(storeB).length, 0);

    const [line] = transfers.getLines(id);
    // Only the destination may receive.
    assert.throws(() => transfers.receive({ user: storeB, id, received: { [line.id]: '100' }, remark: '' }), isAppError(/Only the destination/));
    assert.throws(() => transfers.receive({ user: whAdmin, id, received: { [line.id]: '100' }, remark: '' }), isAppError(/Only the destination/));

    assert.equal(transfers.receive({ user: storeA, id, received: { [line.id]: '100' }, remark: '' }), 'completed');
    assert.equal(qty(boxId, storeA), 100);
    assert.equal(transfers.pendingApprovals(storeA).length, 0, 'no longer pending once approved');
    assert.equal(stock.inTransit(whAdmin.location_id!, 'outgoing').get(boxId), undefined);
    // Cannot be received twice or cancelled afterwards.
    assert.throws(() => transfers.receive({ user: storeA, id, received: { [line.id]: '100' }, remark: '' }), isAppError(/not waiting/));
    assert.throws(() => transfers.cancel({ user: whAdmin, id, reason: 'late' }), isAppError(/no longer be cancelled/));
    const ledger = db.all<{ type: string; transfer_id: number }>('SELECT type, transfer_id FROM stock_ledger WHERE transfer_id = ? ORDER BY id', id);
    assert.deepEqual(ledger.map((l) => l.type), ['transfer_out', 'transfer_in']);
  });

  test('a discrepancy needs a remark, adds only what was received and notifies the Warehouse Admin', () => {
    const id = transfers.create({ user: storeA, destId: storeB.location_id!, rawLines: lines(40), note: '', transportMode: 'courier', transportRef: '', dispatchNow: true });
    assert.equal(qty(boxId, storeA), 60);
    const [line] = transfers.getLines(id);
    assert.throws(() => transfers.receive({ user: storeB, id, received: { [line.id]: '35' }, remark: '' }), isAppError(/remark/));
    assert.equal(transfers.getTransfer(id)!.status, 'dispatched', 'a refused receipt leaves everything untouched');
    assert.equal(qty(boxId, storeB), 0);

    assert.equal(transfers.receive({ user: storeB, id, received: { [line.id]: '35' }, remark: '5 crushed in transit' }), 'discrepancy');
    assert.equal(qty(boxId, storeB), 35);
    assert.equal(qty(boxId, storeA), 60);
    const note = db.get<{ message: string }>('SELECT message FROM notifications WHERE user_id = ? AND transfer_id = ?', whAdmin.id, id);
    assert.match(note!.message, /Discrepancy/);
    // The Warehouse Admin can view this store-to-store transfer.
    assert.equal(perms.canViewTransfer(whAdmin, transfers.getTransfer(id)!), true);
  });

  test('reject returns the stock to the source and needs a reason', () => {
    const id = transfers.create({ user: whAdmin, destId: storeB.location_id!, rawLines: lines(50), note: '', transportMode: 'courier', transportRef: '', dispatchNow: true });
    assert.equal(qty(boxId, whAdmin), 350);
    assert.throws(() => transfers.reject({ user: storeB, id, reason: '' }), isAppError(/reason is required/));
    assert.throws(() => transfers.reject({ user: storeA, id, reason: 'not mine' }), isAppError(/Only the destination/));
    transfers.reject({ user: storeB, id, reason: 'Wrong items' });
    assert.equal(transfers.getTransfer(id)!.status, 'rejected');
    assert.equal(qty(boxId, whAdmin), 400);
    assert.equal(qty(boxId, storeB), 35);
  });

  test('the source can cancel before receipt and the stock comes back', () => {
    const id = transfers.create({ user: whAdmin, destId: storeA.location_id!, rawLines: lines(30), note: '', transportMode: 'courier', transportRef: '', dispatchNow: true });
    assert.equal(qty(boxId, whAdmin), 370);
    assert.throws(() => transfers.cancel({ user: storeA, id, reason: 'x' }), isAppError(/Only the source/));
    assert.throws(() => transfers.cancel({ user: whAdmin, id, reason: '' }), isAppError(/reason is required/));
    transfers.cancel({ user: whAdmin, id, reason: 'Sent by mistake' });
    assert.equal(transfers.getTransfer(id)!.status, 'cancelled');
    assert.equal(qty(boxId, whAdmin), 400);
  });

  test('dispatch is all-or-nothing when one line cannot be fulfilled', () => {
    const id = transfers.create({
      user: whAdmin, destId: storeA.location_id!, note: '', transportMode: 'courier', transportRef: '', dispatchNow: false,
      rawLines: [{ itemId: boxId, qty: '10' }, { itemId: tapeId, qty: '40' }],
    });
    // Stock of the second line drops after the draft was saved.
    stock.adjust({ user: whAdmin, itemId: tapeId, locationId: whAdmin.location_id!, mode: 'out', qty: '5', reason: 'Used' });
    const ledgerBefore = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM stock_ledger')!.n;
    assert.throws(() => transfers.dispatch({ user: whAdmin, id }), isAppError(/Not enough stock of Tape/));
    assert.equal(qty(boxId, whAdmin), 400, 'the first line was rolled back');
    assert.equal(qty(tapeId, whAdmin), 35);
    assert.equal(transfers.getTransfer(id)!.status, 'draft');
    assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM stock_ledger')!.n, ledgerBefore, 'no half-written ledger entries');
  });

  test('who may create, and where to', () => {
    assert.throws(() => transfers.create({ user: superAdmin, destId: storeA.location_id!, rawLines: lines(1), note: '', transportMode: 'courier', transportRef: '', dispatchNow: false }), isAppError(/Choose the location to send from/));
    assert.throws(() => transfers.create({ user: storeA, destId: storeA.location_id!, rawLines: lines(1), note: '', transportMode: 'courier', transportRef: '', dispatchNow: false }), isAppError(/must be different/));
    assert.throws(() => transfers.create({ user: storeA, destId: whAdmin.location_id!, rawLines: lines(1), note: '', transportMode: 'courier', transportRef: '', dispatchNow: false }), isAppError(/destination store/));
    assert.throws(() => transfers.create({ user: storeA, destId: storeB.location_id!, rawLines: [], note: '', transportMode: 'courier', transportRef: '', dispatchNow: false }), isAppError(/at least one item/));
    // Only the source can dispatch someone's draft.
    const id = transfers.create({ user: storeA, destId: storeB.location_id!, rawLines: lines(5), note: '', transportMode: 'courier', transportRef: '', dispatchNow: false });
    assert.throws(() => transfers.dispatch({ user: storeB, id }), isAppError(/Only the source/));
    assert.throws(() => transfers.dispatch({ user: whAdmin, id }), isAppError(/Only the source/));
  });

  test('a store with stock in transit cannot be deactivated', () => {
    const id = transfers.create({ user: whAdmin, destId: storeB.location_id!, rawLines: lines(1), note: '', transportMode: 'courier', transportRef: '', dispatchNow: true });
    assert.throws(() => locations.setLocationStatus(superAdmin, storeB.location_id!, false), isAppError(/in transit/));
    transfers.cancel({ user: whAdmin, id, reason: 'test' });
  });

  test("an item's transfers are listed newest first, without drafts, and a Store Admin only sees their own store's", () => {
    const tape = (n: number) => [{ itemId: tapeId, qty: String(n) }];
    const sent = transfers.create({ user: whAdmin, destId: storeB.location_id!, rawLines: tape(5), note: '', transportMode: 'courier', transportRef: '', dispatchNow: true });
    const draft = transfers.create({ user: whAdmin, destId: storeA.location_id!, rawLines: tape(3), note: '', transportMode: 'courier', transportRef: '', dispatchNow: false });

    const [last] = transfers.itemTransfers(whAdmin, tapeId);
    assert.deepEqual([last.id, last.source_name, last.dest_name, last.qty_sent], [sent, 'Central Warehouse', 'Store B', 5]);
    assert.equal(transfers.itemTransfers(superAdmin, tapeId)[0].id, sent);
    assert.equal(transfers.itemTransfers(whAdmin, tapeId).some((t) => t.id === draft), false, 'a draft has not moved any stock');
    assert.equal(transfers.itemTransfers(storeB, tapeId)[0].id, sent);
    assert.equal(transfers.itemTransfers(storeA, tapeId).some((t) => t.id === sent), false, 'an uninvolved store cannot see it');

    transfers.cancel({ user: whAdmin, id: sent, reason: 'test' });
    transfers.cancel({ user: whAdmin, id: draft, reason: '' });
  });
});

describe('super admin', () => {
  test('can change stock at any location', () => {
    const before = qty(tapeId, storeB);
    stock.adjust({ user: superAdmin, itemId: tapeId, locationId: storeB.location_id!, mode: 'in', qty: '4', reason: 'Top up' });
    assert.equal(qty(tapeId, storeB), before + 4);
    const entry = db.get<{ user_id: number; type: string }>('SELECT user_id, type FROM stock_ledger ORDER BY id DESC LIMIT 1')!;
    assert.deepEqual([entry.user_id, entry.type], [superAdmin.id, 'stock_in']);
    stock.adjust({ user: superAdmin, itemId: tapeId, locationId: storeB.location_id!, mode: 'out', qty: '4', reason: 'Undo top up' });
  });

  test('can run a transfer from any location, from draft to receipt', () => {
    const [sent, held] = [qty(tapeId, whAdmin), qty(tapeId, storeB)];
    const id = transfers.create({
      user: superAdmin, sourceId: whAdmin.location_id!, destId: storeB.location_id!,
      rawLines: [{ itemId: tapeId, qty: '3' }], note: '', transportMode: 'courier', transportRef: '', dispatchNow: false,
    });
    assert.equal(transfers.getTransfer(id)!.source_id, whAdmin.location_id);
    transfers.dispatch({ user: superAdmin, id });
    assert.equal(qty(tapeId, whAdmin), sent - 3);
    const [line] = transfers.getLines(id);
    assert.equal(transfers.receive({ user: superAdmin, id, received: { [line.id]: '3' }, remark: '' }), 'completed');
    assert.equal(qty(tapeId, storeB), held + 3);

    // And can cancel someone else's transfer before it is received.
    const other = transfers.create({ user: whAdmin, destId: storeA.location_id!, rawLines: [{ itemId: tapeId, qty: '1' }], note: '', transportMode: 'courier', transportRef: '', dispatchNow: true });
    transfers.cancel({ user: superAdmin, id: other, reason: 'Sent by mistake' });
    assert.equal(transfers.getTransfer(other)!.status, 'cancelled');
    assert.equal(qty(tapeId, whAdmin), sent - 3);
  });

  test('nobody else can choose where a transfer is sent from', () => {
    const id = transfers.create({
      user: storeA, sourceId: whAdmin.location_id!, destId: storeB.location_id!,
      rawLines: [{ itemId: boxId, qty: '1' }], note: '', transportMode: 'courier', transportRef: '', dispatchNow: false,
    });
    assert.equal(transfers.getTransfer(id)!.source_id, storeA.location_id, 'the chosen source is ignored');
    transfers.cancel({ user: storeA, id, reason: '' });
  });
});

describe('switching users', () => {
  test('only the Super Admin can switch, including while already acting as someone else', () => {
    assert.equal(perms.canSwitchUsers(superAdmin), true);
    assert.equal(perms.canSwitchUsers(whAdmin), false);
    assert.equal(perms.canSwitchUsers(storeA), false);
    assert.equal(perms.canSwitchUsers({ ...storeA, switched_from: { id: superAdmin.id, name: superAdmin.name } }), true);
  });

  test('what the Super Admin does as another user is recorded under that user, with a note saying who did it', () => {
    const asWarehouse: SessionUser = { ...whAdmin, switched_from: { id: superAdmin.id, name: superAdmin.name } };
    stock.adjust({ user: asWarehouse, itemId: tapeId, locationId: whAdmin.location_id!, mode: 'in', qty: '2', reason: 'Recount' });
    const entry = db.get<{ user_id: number; reason: string }>('SELECT user_id, reason FROM stock_ledger ORDER BY id DESC LIMIT 1')!;
    assert.deepEqual([entry.user_id, entry.reason], [whAdmin.id, 'Recount (done by Super Admin Root)']);

    const id = transfers.create({ user: asWarehouse, destId: storeA.location_id!, rawLines: [{ itemId: tapeId, qty: '2' }], note: '', transportMode: 'courier', transportRef: '', dispatchNow: true });
    assert.ok(transfers.getEvents(id).every((e) => e.user_id === whAdmin.id && e.detail.endsWith('(done by Super Admin Root)')));
    transfers.cancel({ user: whAdmin, id, reason: 'test' });
    assert.doesNotMatch(transfers.getEvents(id).at(-1)!.detail, /Super Admin/, 'the user acting for themselves leaves no note');
    stock.adjust({ user: whAdmin, itemId: tapeId, locationId: whAdmin.location_id!, mode: 'out', qty: '2', reason: 'Undo recount' });
  });
});

describe('users', () => {
  test('only the Super Admin manages users, and the last Super Admin is protected', async () => {
    await assert.rejects(users.createUser(whAdmin, { name: 'N', username: 'newuser', phone: '', role: 'store_admin', locationId: storeA.location_id, password: 'password123' }), isAppError(/Only the Super Admin/));
    await assert.rejects(users.updateUser(superAdmin, superAdmin.id, { name: 'Root', phone: '', role: 'store_admin', locationId: storeA.location_id, active: true, password: '' }), isAppError(/own role/));
    await assert.rejects(users.createUser(superAdmin, { name: 'N', username: 'asha', phone: '', role: 'store_admin', locationId: storeA.location_id, password: 'password123' }), isAppError(/already taken/));
    await assert.rejects(users.createUser(superAdmin, { name: 'N', username: 'nopw', phone: '', role: 'store_admin', locationId: storeA.location_id, password: '' }), isAppError(/Password is required/));
    // There is no minimum length: a short password is accepted.
    const shortId = await users.createUser(superAdmin, { name: 'short pass', username: 'shortpw', phone: '', role: 'store_admin', locationId: storeA.location_id, password: 'ab' });
    // The first letter of a person's name is stored as a capital.
    assert.equal(db.get<{ name: string }>('SELECT name FROM users WHERE id = ?', shortId)!.name, 'Short pass');
    await assert.rejects(users.createUser(superAdmin, { name: 'N', username: 'nostore', phone: '', role: 'store_admin', locationId: null, password: 'password123' }), isAppError(/Choose the store/));
  });

  test('passwords are stored as bcrypt hashes', async () => {
    const id = await users.createUser(superAdmin, { name: 'Second Admin', username: 'second', phone: '', role: 'store_admin', locationId: storeA.location_id, password: 'correct horse' });
    const row = db.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', id)!;
    assert.match(row.password_hash, /^\$2[aby]\$12\$/);
    const { checkPassword } = await import('../src/lib/passwords');
    assert.equal(await checkPassword('correct horse', row.password_hash), true);
    assert.equal(await checkPassword('wrong', row.password_hash), false);
    assert.equal(await checkPassword('anything', undefined), false);
  });
});

describe('bulk upload', () => {
  test('the template has Name, Size, Image, Unit and Stock columns only', async () => {
    assert.deepEqual(bulk.TEMPLATE_HEADERS, ['Name', 'Size', 'Image (filename or URL)', 'Unit', 'Stock']);
    assert.equal(bulk.templateCsv().trim(), 'Name,Size,Image (filename or URL),Unit,Stock');
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await bulk.templateXlsx()) as unknown as ArrayBuffer);
    const header = (wb.getWorksheet('Items')!.getRow(1).values as unknown[]).filter(Boolean);
    assert.deepEqual(header, ['Name', 'Size', 'Image (filename or URL)', 'Unit', 'Stock']);
  });

  test('CSV parsing handles quotes, commas and blank lines', () => {
    assert.deepEqual(bulk.parseCsv('﻿Name,Size\r\n"Box, large","10""x12"""\r\n\r\nTape,48mm'),
      [['Name', 'Size'], ['Box, large', '10"x12"'], [''], ['Tape', '48mm']]);
    assert.deepEqual(bulk.parseCsv('Name;Size\nA;B'), [['Name', 'Size'], ['A', 'B']]);
  });

  test('preview reports row-level errors and imports nothing by itself', async () => {
    const sheet = path.join(dataDir, 'sheet.csv');
    fs.writeFileSync(sheet, [
      'Name,Size,Image (filename or URL),Unit,Stock',
      'Mailer Bag,Medium,mailer.jpg,pcs,100',
      ',Large,x.jpg,,',
      'Mailer Bag,MEDIUM,mailer.jpg,,',
      'Kraft Box,Small,box.jpg,,',
      'Label Roll,100mm,,,abc',
      'Local Thing,One,http://127.0.0.1/a.png,,',
    ].join('\n'));
    const before = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM items')!.n;
    await assert.rejects(bulk.buildPreview({ user: whAdmin, sheetPath: sheet, sheetName: 'sheet.csv', zipPath: null }), isAppError(/permission/));
    const token = await bulk.buildPreview({ user: superAdmin, sheetPath: sheet, sheetName: 'sheet.csv', zipPath: null });
    const { rows } = bulk.loadPreview(token, superAdmin);
    assert.equal(rows.length, 6);
    assert.match(rows[0].errors.join(' '), /needs a ZIP/);
    assert.match(rows[1].errors.join(' '), /Name is missing/);
    assert.match(rows[2].errors.join(' '), /Duplicate of row 2/);
    assert.match(rows[3].errors.join(' '), /already exists/);
    assert.match(rows[4].errors.join(' '), /Image is missing/);
    assert.match(rows[4].errors.join(' '), /Stock must be a whole number/);
    assert.match(rows[5].errors.join(' '), /private network address/);
    assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM items')!.n, before);
    assert.throws(() => bulk.importPreview(token, superAdmin), isAppError(/no valid rows/));
    bulk.discard(token, superAdmin);
    assert.throws(() => bulk.loadPreview(token, superAdmin), isAppError(/expired/));
  });

  test('importing adds the Stock column to the warehouse as opening stock', async () => {
    const zipPath = path.join(dataDir, 'images.zip');
    fs.writeFileSync(zipPath, storedZip({ 'pouch.png': pngBuffer, 'Card.PNG': pngBuffer }));
    const sheet = path.join(dataDir, 'import.csv');
    fs.writeFileSync(sheet, [
      'Name,Size,Image (filename or URL),Unit,Stock',
      'Velvet Pouch,3 x 4 in,pouch.png,pcs,250',
      'Thank You Card,A6,card.png,pcs,',
      'Gift Bag,Large,pouch,pcs,12.5',
    ].join('\n'));
    const token = await bulk.buildPreview({ user: superAdmin, sheetPath: sheet, sheetName: 'import.csv', zipPath });
    const { rows } = bulk.loadPreview(token, superAdmin);
    assert.deepEqual(rows.map((r) => [r.name, r.stock, r.errors.length]), [['Velvet Pouch', 250, 0], ['Thank You Card', 0, 0], ['Gift Bag', 0, 1]]);
    assert.match(rows[2].errors[0], /Stock must be a whole number/);

    const result = bulk.importPreview(token, superAdmin);
    assert.deepEqual(result, { imported: 2, skipped: 0, units: 250, rejected: 1 });
    const pouch = db.get<{ id: number }>("SELECT id FROM items WHERE name = 'Velvet Pouch'")!;
    const card = db.get<{ id: number }>("SELECT id FROM items WHERE name = 'Thank You Card'")!;
    assert.equal(stock.getQty(pouch.id, db.warehouseId()), 250);
    assert.equal(stock.getQty(card.id, db.warehouseId()), 0);
    // The opening stock is in the ledger like any other change.
    const entry = db.get<{ type: string; qty_before: number; qty_after: number; reason: string; user_id: number }>(
      'SELECT type, qty_before, qty_after, reason, user_id FROM stock_ledger WHERE item_id = ?', pouch.id)!;
    assert.deepEqual(entry, { type: 'stock_in', qty_before: 0, qty_after: 250, reason: 'Opening stock from bulk import', user_id: superAdmin.id });
    assert.equal(db.get('SELECT 1 FROM stock_ledger WHERE item_id = ?', card.id), undefined, 'no entry when there is no opening stock');
  });

  test('image URLs pointing at private addresses are refused', async () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.10', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1']) {
      assert.equal(bulk.isPrivateAddress(ip), true, ip);
    }
    for (const ip of ['8.8.8.8', '93.184.216.34', '2606:4700::1111']) assert.equal(bulk.isPrivateAddress(ip), false, ip);
    const sheet = path.join(dataDir, 'urls.csv');
    fs.writeFileSync(sheet, 'Name,Size,Image\nInternal,One,http://127.0.0.1:3000/secret.png\nMeta,One,http://169.254.169.254/latest');
    const token = await bulk.buildPreview({ user: superAdmin, sheetPath: sheet, sheetName: 'urls.csv', zipPath: null });
    const { rows } = bulk.loadPreview(token, superAdmin);
    assert.match(rows[0].errors.join(' '), /private network address/);
    assert.match(rows[1].errors.join(' '), /private network address/);
  });
});
