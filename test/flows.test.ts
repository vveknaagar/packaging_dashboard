/**
 * Tests for the rules that protect stock: permissions, the ledger, and the
 * transfer flow. They run against a throwaway Postgres (PGlite, in memory)
 * and a temp folder for uploaded sheets.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import pg from 'pg';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'packaging-test-'));
process.env.DATA_DIR = dataDir;

type Db = typeof import('../src/lib/db');
type Stock = typeof import('../src/lib/services/stock');
type Transfers = typeof import('../src/lib/services/transfers');
type Items = typeof import('../src/lib/services/items');
type Locations = typeof import('../src/lib/services/locations');
type Users = typeof import('../src/lib/services/users');
type Bulk = typeof import('../src/lib/services/bulk');
type Images = typeof import('../src/lib/services/images');
type Perms = typeof import('../src/lib/permissions');
type SessionUser = import('../src/lib/types').SessionUser;

let db: Db;
let stock: Stock;
let transfers: Transfers;
let items: Items;
let locations: Locations;
let users: Users;
let bulk: Bulk;
let images: Images;
let perms: Perms;

let superAdmin: SessionUser;
let whAdmin: SessionUser;
let storeA: SessionUser;
let storeB: SessionUser;
let boxId: number;
let tapeId: number;
let pngBuffer: Buffer;

async function loadUser(id: number): Promise<SessionUser> {
  return (await db.get<SessionUser>(
    `SELECT u.id, u.name, u.username, u.role, u.location_id, l.name AS location_name, l.type AS location_type
     FROM users u LEFT JOIN locations l ON l.id = u.location_id WHERE u.id = ?`, id))!;
}

/**
 * Run SQL that the database itself must refuse, on a connection of its own.
 * PGlite's socket server drops a connection after a constraint error (real
 * Postgres does not), so the app's own connection is kept out of it.
 */
async function refusedSql(sql: string, ...params: (string | number)[]): Promise<void> {
  const client = new pg.Client(process.env.DATABASE_URL);
  client.on('error', () => {});
  await client.connect();
  let n = 0;
  try {
    await client.query(sql.replace(/\?/g, () => `$${++n}`), params);
  } finally {
    await client.end().catch(() => {});
  }
}

const qty = (itemId: number, user: SessionUser) => stock.getQty(itemId, user.location_id!);
const isAppError = (pattern: RegExp) => (err: unknown) => {
  assert.ok(err instanceof Error && err.name.endsWith('Error') && 'status' in err, `expected an AppError, got ${err}`);
  assert.match((err as Error).message, pattern);
  return true;
};

let pglite: PGlite;
let server: PGLiteSocketServer;

before(async () => {
  // The app gets one connection; refusedSql() below uses the other.
  pglite = await PGlite.create({ extensions: { citext } });
  server = new PGLiteSocketServer({ db: pglite, port: 0, host: '127.0.0.1', maxConnections: 2 });
  await server.start();
  process.env.DATABASE_URL = `postgres://postgres@${server.getServerConn()}/postgres`;
  process.env.DATABASE_POOL_MAX = '1';

  db = await import('../src/lib/db');
  stock = await import('../src/lib/services/stock');
  transfers = await import('../src/lib/services/transfers');
  items = await import('../src/lib/services/items');
  locations = await import('../src/lib/services/locations');
  users = await import('../src/lib/services/users');
  bulk = await import('../src/lib/services/bulk');
  images = await import('../src/lib/services/images');
  perms = await import('../src/lib/permissions');
  const sharp = (await import('sharp')).default;
  pngBuffer = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#c9a26b' } }).png().toBuffer();

  // A fake hash keeps the tests fast; password hashing is covered separately.
  superAdmin = await loadUser(await users.insertUser('Root', 'root', 'x', 'super_admin', null));
  whAdmin = await loadUser(await users.insertUser('Wanda', 'wanda', 'x', 'warehouse_admin', await db.warehouseId()));
  const storeAId = await locations.createStore(superAdmin, { name: 'Store A', code: 'STA', address: 'Ring Road', gstin: '24ABCDE1234F1Z5' }, null);
  const storeBId = await locations.createStore(superAdmin, { name: 'Store B', code: 'STB', address: 'Ring Road', gstin: '24ABCDE1234F1Z5' }, null);
  storeA = await loadUser(await users.insertUser('Asha', 'asha', 'x', 'store_admin', storeAId));
  storeB = await loadUser(await users.insertUser('Bela', 'bela', 'x', 'store_admin', storeBId));

  boxId = await items.createItem(superAdmin, { name: 'Kraft Box', size: 'Small', unit: 'pcs' }, pngBuffer);
  tapeId = await items.createItem(superAdmin, { name: 'Tape', size: '48mm', unit: 'roll' }, pngBuffer);
  await stock.adjust({ user: whAdmin, itemId: boxId, locationId: whAdmin.location_id!, mode: 'in', qty: '500', reason: 'Opening stock' });
  await stock.adjust({ user: whAdmin, itemId: tapeId, locationId: whAdmin.location_id!, mode: 'in', qty: '40', reason: 'Opening stock' });
});

after(async () => {
  await db.close();
  await server.stop();
  await pglite.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('locations', () => {
  test('there is exactly one warehouse and a second cannot be created', async () => {
    assert.equal((await db.all("SELECT id FROM locations WHERE type = 'warehouse'")).length, 1);
    await assert.rejects(refusedSql("INSERT INTO locations (type, name, code, created_at) VALUES ('warehouse', 'W2', 'W2', 'now')"));
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
    assert.deepEqual(await db.get('SELECT code, gstin FROM locations WHERE id = ?', id), { code: 'SU', gstin: '24ABCDE1234F1Z5' });
  });

  test('the financial year code runs April to March', async () => {
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
    assert.deepEqual((await locations.allContacts()).get(id), [{ name: 'Chetan', phone: '98765 43210' }]);
    // A second admin is listed too, and editing a user's phone changes the location's contact.
    const second = await users.createUser(superAdmin, { name: 'Dev', username: 'dev', phone: '', role: 'store_admin', locationId: id, password: 'pw' });
    await users.updateUser(superAdmin, second, { name: 'Dev', phone: '+91 261 400 500', role: 'store_admin', locationId: id, active: true, password: '' });
    assert.deepEqual((await locations.allContacts()).get(id), [{ name: 'Chetan', phone: '98765 43210' }, { name: 'Dev', phone: '+91 261 400 500' }]);
    // A deactivated admin is no longer a contact.
    await users.updateUser(superAdmin, second, { name: 'Dev', phone: '+91 261 400 500', role: 'store_admin', locationId: id, active: false, password: '' });
    assert.equal((await locations.allContacts()).get(id)!.length, 1);
    assert.equal((await locations.allContacts()).get(storeA.location_id!)![0].name, 'Asha');
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

  test('a thumbnail is generated and stored with the image', async () => {
    const item = (await db.get<{ image: string; thumb: string }>('SELECT image, thumb FROM items WHERE id = ?', boxId))!;
    const sharp = (await import('sharp')).default;
    for (const [file, maxSide] of [[item.image, 1200], [item.thumb, 200]] as const) {
      const data = await images.readStored(file);
      assert.ok(data, `${file} is stored`);
      const meta = await sharp(data).metadata();
      assert.equal(meta.format, 'webp');
      assert.ok(meta.width! <= maxSide && meta.height! <= maxSide);
    }
  });

  test('replacing a picture removes the old one, and a failed save leaves no picture behind', async () => {
    const before = (await db.get<{ image: string; thumb: string }>('SELECT image, thumb FROM items WHERE id = ?', tapeId))!;
    await items.updateItem(superAdmin, tapeId, { name: 'Tape', size: '48mm', unit: 'roll' }, pngBuffer);
    const after = (await db.get<{ image: string; thumb: string }>('SELECT image, thumb FROM items WHERE id = ?', tapeId))!;
    assert.notEqual(after.image, before.image);
    assert.equal(await images.readStored(before.image), undefined);
    assert.equal(await images.readStored(before.thumb), undefined);
    assert.ok(await images.readStored(after.image));

    const count = async () => (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM images'))!.n;
    const stored = await count();
    // Renaming the tape to clash with the box fails, and its new picture is not kept.
    await assert.rejects(items.updateItem(superAdmin, tapeId, { name: 'Kraft Box', size: 'Small', unit: '' }, pngBuffer), isAppError(/already exists/));
    assert.equal(await count(), stored);
  });

  test('only the Super Admin can manage items', async () => {
    const input = { name: 'Sneaky', size: 'S', unit: '' };
    await assert.rejects(items.createItem(whAdmin, input, pngBuffer), isAppError(/Only the Super Admin/));
    await assert.rejects(async () => await items.setItemStatus(storeA, boxId, false), isAppError(/Only the Super Admin/));
  });

  test('items can be deactivated but never deleted', async () => {
    await items.setItemStatus(superAdmin, tapeId, false);
    assert.equal((await db.get<{ active: number }>('SELECT active FROM items WHERE id = ?', tapeId))!.active, 0);
    await items.setItemStatus(superAdmin, tapeId, true);
    await assert.rejects(refusedSql('DELETE FROM items WHERE id = ?', tapeId), /cannot be deleted/);
  });
});

describe('stock', () => {
  test('a Warehouse or Store Admin can edit only their own location', async () => {
    const args = { itemId: boxId, mode: 'in', qty: '5', reason: 'test' };
    await assert.rejects(async () => await stock.adjust({ ...args, user: storeA, locationId: whAdmin.location_id! }), isAppError(/own location/));
    await assert.rejects(async () => await stock.adjust({ ...args, user: storeA, locationId: storeB.location_id! }), isAppError(/own location/));
    await assert.rejects(async () => await stock.adjust({ ...args, user: whAdmin, locationId: storeA.location_id! }), isAppError(/own location/));
  });

  test('a reason is mandatory and stock never goes below zero', async () => {
    const base = { user: whAdmin, itemId: boxId, locationId: whAdmin.location_id! };
    await assert.rejects(async () => await stock.adjust({ ...base, mode: 'out', qty: '10', reason: '   ' }), isAppError(/reason is required/));
    await assert.rejects(async () => await stock.adjust({ ...base, mode: 'out', qty: '501', reason: 'too many' }), isAppError(/Not enough stock/));
    await assert.rejects(async () => await stock.adjust({ ...base, mode: 'out', qty: '-5', reason: 'negative' }), isAppError(/whole number/));
    await assert.rejects(async () => await stock.adjust({ ...base, mode: 'in', qty: '1.5', reason: 'fraction' }), isAppError(/whole number/));
    assert.equal(await qty(boxId, whAdmin), 500);
    await assert.rejects(refusedSql('UPDATE stock SET qty = -1 WHERE item_id = ?', boxId), /check constraint/);
  });

  test('every change writes a ledger entry with before and after', async () => {
    await stock.adjust({ user: whAdmin, itemId: boxId, locationId: whAdmin.location_id!, mode: 'out', qty: '20', reason: 'Damaged' });
    await stock.adjust({ user: whAdmin, itemId: boxId, locationId: whAdmin.location_id!, mode: 'set', qty: '500', reason: 'Recount' });
    const rows = await db.all<{ type: string; qty_change: number; qty_before: number; qty_after: number; reason: string; user_id: number }>(
      'SELECT * FROM stock_ledger WHERE item_id = ? ORDER BY id DESC LIMIT 2', boxId);
    assert.deepEqual(rows.map((r) => [r.type, r.qty_change, r.qty_before, r.qty_after, r.reason]),
      [['adjustment', 20, 480, 500, 'Recount'], ['stock_out', -20, 500, 480, 'Damaged']]);
    assert.equal(rows[0].user_id, whAdmin.id);
  });

  test('ledger entries cannot be changed or deleted', async () => {
    await assert.rejects(refusedSql("UPDATE stock_ledger SET reason = 'edited'"), /permanent/);
    await assert.rejects(refusedSql('DELETE FROM stock_ledger'), /permanent/);
  });

  test('visibility: a Store Admin sees only their own store', async () => {
    assert.equal(perms.canViewLocation(storeA, storeA.location_id!), true);
    assert.equal(perms.canViewLocation(storeA, storeB.location_id!), false);
    assert.equal(perms.canViewLocation(storeA, whAdmin.location_id!), false);
    assert.equal(perms.canViewLocation(whAdmin, storeB.location_id!), true);
    assert.equal(perms.canEditStock(whAdmin, storeB.location_id!), false);
  });
});

describe('transfers', () => {
  const lines = (n: number) => [{ itemId: boxId, qty: String(n) }];

  test('a draft moves no stock and is hidden from the destination', async () => {
    const id = await transfers.create({ user: whAdmin, destId: storeA.location_id!, rawLines: lines(100), note: '', transportMode: 'courier', transportRef: '', dispatchNow: false });
    const t = (await transfers.getTransfer(id))!;
    assert.equal(t.status, 'draft');
    // Numbered in the sending location's own series: code, financial year, running count.
    assert.equal(t.number, `WH${transfers.financialYearCode()}-01`);
    assert.equal(await qty(boxId, whAdmin), 500);
    assert.equal(perms.canViewTransfer(storeA, t), false);
    assert.equal(perms.canViewTransfer(storeB, t), false);
    await transfers.cancel({ user: whAdmin, id, reason: '' });
    assert.equal((await transfers.getTransfer(id))!.status, 'cancelled');
    assert.equal(await qty(boxId, whAdmin), 500);
  });

  test('quantity cannot exceed available stock', async () => {
    await assert.rejects(async () => await transfers.create({ user: whAdmin, destId: storeA.location_id!, rawLines: lines(501), note: '', transportMode: 'courier', transportRef: '', dispatchNow: true, parcelPhoto: pngBuffer }),
      isAppError(/only 500 available/));
  });

  test('only the Super Admin sets price and HSN, and dispatch freezes them on the slip', async () => {
    await assert.rejects(async () => await items.savePricing(whAdmin, [{ id: boxId, hsn: '4819', price: '10' }]), isAppError(/Only the Super Admin/));
    await assert.rejects(async () => await items.savePricing(superAdmin, [{ id: boxId, hsn: '48', price: '10' }]), isAppError(/4, 6 or 8 digits/));
    await assert.rejects(async () => await items.savePricing(superAdmin, [{ id: boxId, hsn: '4819', price: '1.234' }]), isAppError(/not a valid price/));
    assert.equal(items.parsePrice('₹1,250.5'), 125050);
    assert.equal(items.parsePrice(''), null);

    assert.equal(await items.savePricing(superAdmin, [{ id: boxId, hsn: '48191010', price: '12.50' }]), 1);
    assert.equal(await items.savePricing(superAdmin, [{ id: boxId, hsn: '48191010', price: '12.5' }]), 0, 'unchanged rows are skipped');

    const draft = await transfers.create({ user: whAdmin, destId: storeA.location_id!, rawLines: lines(2), note: '', transportMode: 'hand', transportRef: '', dispatchNow: false });
    assert.equal((await transfers.getLines(draft))[0].rate_paise, null, 'a draft has no price yet');
    await transfers.dispatch({ user: whAdmin, id: draft, parcelPhoto: pngBuffer });
    // A later price change does not touch what was dispatched.
    await items.savePricing(superAdmin, [{ id: boxId, hsn: '4819', price: '99' }]);
    const [line] = await transfers.getLines(draft);
    assert.equal(line.hsn, '48191010');
    assert.equal(line.rate_paise, 1250);
    await transfers.cancel({ user: whAdmin, id: draft, reason: 'test' });
  });

  test('a transfer needs a mode of transport', async () => {
    await assert.rejects(async () => await transfers.create({ user: whAdmin, destId: storeA.location_id!, rawLines: lines(1), note: '', transportMode: '', transportRef: '', dispatchNow: false }),
      isAppError(/mode of transport/));
    await assert.rejects(async () => await transfers.create({ user: whAdmin, destId: storeA.location_id!, rawLines: lines(1), note: '', transportMode: 'teleport', transportRef: '', dispatchNow: false }),
      isAppError(/mode of transport/));
  });

  test('each sending location numbers its transfers in its own series', async () => {
    const fy = transfers.financialYearCode();
    const before = (await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM transfers WHERE number LIKE 'WH%'"))!.n;
    const a = await transfers.create({ user: whAdmin, destId: storeA.location_id!, rawLines: lines(1), note: '', transportMode: 'hand', transportRef: 'GJ05AB1234', dispatchNow: false });
    const b = await transfers.create({ user: whAdmin, destId: storeB.location_id!, rawLines: lines(1), note: '', transportMode: 'hand', transportRef: '', dispatchNow: false });
    assert.equal((await transfers.getTransfer(a))!.number, `WH${fy}-${String(before + 1).padStart(2, '0')}`);
    assert.equal((await transfers.getTransfer(b))!.number, `WH${fy}-${String(before + 2).padStart(2, '0')}`);
    assert.equal((await transfers.getTransfer(a))!.transport_ref, 'GJ05AB1234');
    for (const id of [a, b]) await transfers.cancel({ user: whAdmin, id, reason: '' });
  });

  test('the sender must add a photo of the parcel to dispatch, and it is kept with the transfer', async () => {
    const before = await qty(boxId, whAdmin);
    await assert.rejects(async () => await transfers.create({ user: whAdmin, destId: storeA.location_id!, rawLines: lines(1), note: '', transportMode: 'courier', transportRef: '', dispatchNow: true }),
      isAppError(/photo of the packed parcel/));
    const draft = await transfers.create({ user: whAdmin, destId: storeA.location_id!, rawLines: lines(1), note: '', transportMode: 'courier', transportRef: '', dispatchNow: false });
    assert.equal((await transfers.getTransfer(draft))!.parcel_image, '', 'a draft needs no photo');
    await assert.rejects(async () => await transfers.dispatch({ user: whAdmin, id: draft }), isAppError(/photo of the packed parcel/));
    await assert.rejects(async () => await transfers.dispatch({ user: whAdmin, id: draft, parcelPhoto: Buffer.from('not an image') }), isAppError(/not a valid image/));
    assert.equal((await transfers.getTransfer(draft))!.status, 'draft');
    assert.equal(await qty(boxId, whAdmin), before, 'no stock moves without a photo');

    await transfers.dispatch({ user: whAdmin, id: draft, parcelPhoto: pngBuffer });
    const t = (await transfers.getTransfer(draft))!;
    assert.match(t.parcel_image, /^parcels\/[a-f0-9]{24}\.webp$/);
    const stored = (await images.readStored(t.parcel_image))!;
    assert.equal(stored.subarray(8, 12).toString(), 'WEBP');
    assert.ok(await images.readStored(t.parcel_thumb));
    await transfers.cancel({ user: whAdmin, id: draft, reason: 'test over' });
  });

  test('dispatch deducts from source; receipt in full adds to destination', async () => {
    const id = await transfers.create({ user: whAdmin, destId: storeA.location_id!, rawLines: lines(100), note: 'Van 2', transportMode: 'courier', transportRef: '', dispatchNow: true, parcelPhoto: pngBuffer });
    const t = (await transfers.getTransfer(id))!;
    assert.equal(t.status, 'dispatched');
    assert.equal(await qty(boxId, whAdmin), 400);
    assert.equal(await qty(boxId, storeA), 0, 'nothing reaches the store before it confirms receipt');
    assert.equal((await stock.inTransit(whAdmin.location_id!, 'outgoing')).get(boxId), 100);
    assert.equal((await stock.inTransit(storeA.location_id!, 'incoming')).get(boxId), 100);
    assert.equal(perms.canViewTransfer(storeA, t), true);
    assert.equal(perms.canViewTransfer(storeB, t), false, 'an uninvolved store cannot see it');
    // It shows as pending approval for the destination only, until approved.
    assert.deepEqual((await transfers.pendingApprovals(storeA)).map((p) => p.id), [id]);
    assert.equal((await transfers.pendingApprovals(storeB)).length, 0);

    const [line] = await transfers.getLines(id);
    // Only the destination may receive.
    await assert.rejects(async () => await transfers.receive({ user: storeB, id, received: { [line.id]: '100' }, remark: '' }), isAppError(/Only the destination/));
    await assert.rejects(async () => await transfers.receive({ user: whAdmin, id, received: { [line.id]: '100' }, remark: '' }), isAppError(/Only the destination/));

    assert.equal(await transfers.receive({ user: storeA, id, received: { [line.id]: '100' }, remark: '' }), 'completed');
    assert.equal(await qty(boxId, storeA), 100);
    assert.equal((await transfers.pendingApprovals(storeA)).length, 0, 'no longer pending once approved');
    assert.equal((await stock.inTransit(whAdmin.location_id!, 'outgoing')).get(boxId), undefined);
    // Cannot be received twice or cancelled afterwards.
    await assert.rejects(async () => await transfers.receive({ user: storeA, id, received: { [line.id]: '100' }, remark: '' }), isAppError(/not waiting/));
    await assert.rejects(async () => await transfers.cancel({ user: whAdmin, id, reason: 'late' }), isAppError(/no longer be cancelled/));
    const ledger = await db.all<{ type: string; transfer_id: number }>('SELECT type, transfer_id FROM stock_ledger WHERE transfer_id = ? ORDER BY id', id);
    assert.deepEqual(ledger.map((l) => l.type), ['transfer_out', 'transfer_in']);
  });

  test('a discrepancy needs a remark, adds only what was received and notifies the Warehouse Admin', async () => {
    const id = await transfers.create({ user: storeA, destId: storeB.location_id!, rawLines: lines(40), note: '', transportMode: 'courier', transportRef: '', dispatchNow: true, parcelPhoto: pngBuffer });
    assert.equal(await qty(boxId, storeA), 60);
    const [line] = await transfers.getLines(id);
    await assert.rejects(async () => await transfers.receive({ user: storeB, id, received: { [line.id]: '35' }, remark: '' }), isAppError(/remark/));
    assert.equal((await transfers.getTransfer(id))!.status, 'dispatched', 'a refused receipt leaves everything untouched');
    assert.equal(await qty(boxId, storeB), 0);

    assert.equal(await transfers.receive({ user: storeB, id, received: { [line.id]: '35' }, remark: '5 crushed in transit' }), 'discrepancy');
    assert.equal(await qty(boxId, storeB), 35);
    assert.equal(await qty(boxId, storeA), 60);
    const note = await db.get<{ message: string }>('SELECT message FROM notifications WHERE user_id = ? AND transfer_id = ?', whAdmin.id, id);
    assert.match(note!.message, /Discrepancy/);
    // The Warehouse Admin can view this store-to-store transfer.
    assert.equal(perms.canViewTransfer(whAdmin, (await transfers.getTransfer(id))!), true);
  });

  test('reject returns the stock to the source and needs a reason', async () => {
    const id = await transfers.create({ user: whAdmin, destId: storeB.location_id!, rawLines: lines(50), note: '', transportMode: 'courier', transportRef: '', dispatchNow: true, parcelPhoto: pngBuffer });
    assert.equal(await qty(boxId, whAdmin), 350);
    await assert.rejects(async () => await transfers.reject({ user: storeB, id, reason: '' }), isAppError(/reason is required/));
    await assert.rejects(async () => await transfers.reject({ user: storeA, id, reason: 'not mine' }), isAppError(/Only the destination/));
    await transfers.reject({ user: storeB, id, reason: 'Wrong items' });
    assert.equal((await transfers.getTransfer(id))!.status, 'rejected');
    assert.equal(await qty(boxId, whAdmin), 400);
    assert.equal(await qty(boxId, storeB), 35);
  });

  test('the source can cancel before receipt and the stock comes back', async () => {
    const id = await transfers.create({ user: whAdmin, destId: storeA.location_id!, rawLines: lines(30), note: '', transportMode: 'courier', transportRef: '', dispatchNow: true, parcelPhoto: pngBuffer });
    assert.equal(await qty(boxId, whAdmin), 370);
    await assert.rejects(async () => await transfers.cancel({ user: storeA, id, reason: 'x' }), isAppError(/Only the source/));
    await assert.rejects(async () => await transfers.cancel({ user: whAdmin, id, reason: '' }), isAppError(/reason is required/));
    await transfers.cancel({ user: whAdmin, id, reason: 'Sent by mistake' });
    assert.equal((await transfers.getTransfer(id))!.status, 'cancelled');
    assert.equal(await qty(boxId, whAdmin), 400);
  });

  test('dispatch is all-or-nothing when one line cannot be fulfilled', async () => {
    const id = await transfers.create({
      user: whAdmin, destId: storeA.location_id!, note: '', transportMode: 'courier', transportRef: '', dispatchNow: false,
      rawLines: [{ itemId: boxId, qty: '10' }, { itemId: tapeId, qty: '40' }],
    });
    // Stock of the second line drops after the draft was saved.
    await stock.adjust({ user: whAdmin, itemId: tapeId, locationId: whAdmin.location_id!, mode: 'out', qty: '5', reason: 'Used' });
    const ledgerBefore = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM stock_ledger'))!.n;
    await assert.rejects(async () => await transfers.dispatch({ user: whAdmin, id, parcelPhoto: pngBuffer }), isAppError(/Not enough stock of Tape/));
    assert.equal(await qty(boxId, whAdmin), 400, 'the first line was rolled back');
    assert.equal(await qty(tapeId, whAdmin), 35);
    assert.equal((await transfers.getTransfer(id))!.status, 'draft');
    assert.equal((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM stock_ledger'))!.n, ledgerBefore, 'no half-written ledger entries');
  });

  test('who may create, and where to', async () => {
    await assert.rejects(async () => await transfers.create({ user: superAdmin, destId: storeA.location_id!, rawLines: lines(1), note: '', transportMode: 'courier', transportRef: '', dispatchNow: false }), isAppError(/Choose the location to send from/));
    await assert.rejects(async () => await transfers.create({ user: storeA, destId: storeA.location_id!, rawLines: lines(1), note: '', transportMode: 'courier', transportRef: '', dispatchNow: false }), isAppError(/must be different/));
    await assert.rejects(async () => await transfers.create({ user: storeA, destId: whAdmin.location_id!, rawLines: lines(1), note: '', transportMode: 'courier', transportRef: '', dispatchNow: false }), isAppError(/destination store/));
    await assert.rejects(async () => await transfers.create({ user: storeA, destId: storeB.location_id!, rawLines: [], note: '', transportMode: 'courier', transportRef: '', dispatchNow: false }), isAppError(/at least one item/));
    // Only the source can dispatch someone's draft.
    const id = await transfers.create({ user: storeA, destId: storeB.location_id!, rawLines: lines(5), note: '', transportMode: 'courier', transportRef: '', dispatchNow: false });
    await assert.rejects(async () => await transfers.dispatch({ user: storeB, id, parcelPhoto: pngBuffer }), isAppError(/Only the source/));
    await assert.rejects(async () => await transfers.dispatch({ user: whAdmin, id, parcelPhoto: pngBuffer }), isAppError(/Only the source/));
  });

  test('a store with stock in transit cannot be deactivated', async () => {
    const id = await transfers.create({ user: whAdmin, destId: storeB.location_id!, rawLines: lines(1), note: '', transportMode: 'courier', transportRef: '', dispatchNow: true, parcelPhoto: pngBuffer });
    await assert.rejects(async () => await locations.setLocationStatus(superAdmin, storeB.location_id!, false), isAppError(/in transit/));
    await transfers.cancel({ user: whAdmin, id, reason: 'test' });
  });

  test("an item's transfers are listed newest first, without drafts, and a Store Admin only sees their own store's", async () => {
    const tape = (n: number) => [{ itemId: tapeId, qty: String(n) }];
    const sent = await transfers.create({ user: whAdmin, destId: storeB.location_id!, rawLines: tape(5), note: '', transportMode: 'courier', transportRef: '', dispatchNow: true, parcelPhoto: pngBuffer });
    const draft = await transfers.create({ user: whAdmin, destId: storeA.location_id!, rawLines: tape(3), note: '', transportMode: 'courier', transportRef: '', dispatchNow: false });

    const [last] = await transfers.itemTransfers(whAdmin, tapeId);
    assert.deepEqual([last.id, last.source_name, last.dest_name, last.qty_sent], [sent, 'Central Warehouse', 'Store B', 5]);
    assert.equal((await transfers.itemTransfers(superAdmin, tapeId))[0].id, sent);
    assert.equal((await transfers.itemTransfers(whAdmin, tapeId)).some((t) => t.id === draft), false, 'a draft has not moved any stock');
    assert.equal((await transfers.itemTransfers(storeB, tapeId))[0].id, sent);
    assert.equal((await transfers.itemTransfers(storeA, tapeId)).some((t) => t.id === sent), false, 'an uninvolved store cannot see it');

    await transfers.cancel({ user: whAdmin, id: sent, reason: 'test' });
    await transfers.cancel({ user: whAdmin, id: draft, reason: '' });
  });
});

describe('super admin', () => {
  test('can change stock at any location', async () => {
    const before = await qty(tapeId, storeB);
    await stock.adjust({ user: superAdmin, itemId: tapeId, locationId: storeB.location_id!, mode: 'in', qty: '4', reason: 'Top up' });
    assert.equal(await qty(tapeId, storeB), before + 4);
    const entry = (await db.get<{ user_id: number; type: string }>('SELECT user_id, type FROM stock_ledger ORDER BY id DESC LIMIT 1'))!;
    assert.deepEqual([entry.user_id, entry.type], [superAdmin.id, 'stock_in']);
    await stock.adjust({ user: superAdmin, itemId: tapeId, locationId: storeB.location_id!, mode: 'out', qty: '4', reason: 'Undo top up' });
  });

  test('can run a transfer from any location, from draft to receipt', async () => {
    const [sent, held] = [await qty(tapeId, whAdmin), await qty(tapeId, storeB)];
    const id = await transfers.create({
      user: superAdmin, sourceId: whAdmin.location_id!, destId: storeB.location_id!,
      rawLines: [{ itemId: tapeId, qty: '3' }], note: '', transportMode: 'courier', transportRef: '', dispatchNow: false,
    });
    assert.equal((await transfers.getTransfer(id))!.source_id, whAdmin.location_id);
    await transfers.dispatch({ user: superAdmin, id, parcelPhoto: pngBuffer });
    assert.equal(await qty(tapeId, whAdmin), sent - 3);
    const [line] = await transfers.getLines(id);
    assert.equal(await transfers.receive({ user: superAdmin, id, received: { [line.id]: '3' }, remark: '' }), 'completed');
    assert.equal(await qty(tapeId, storeB), held + 3);

    // And can cancel someone else's transfer before it is received.
    const other = await transfers.create({ user: whAdmin, destId: storeA.location_id!, rawLines: [{ itemId: tapeId, qty: '1' }], note: '', transportMode: 'courier', transportRef: '', dispatchNow: true, parcelPhoto: pngBuffer });
    await transfers.cancel({ user: superAdmin, id: other, reason: 'Sent by mistake' });
    assert.equal((await transfers.getTransfer(other))!.status, 'cancelled');
    assert.equal(await qty(tapeId, whAdmin), sent - 3);
  });

  test('nobody else can choose where a transfer is sent from', async () => {
    const id = await transfers.create({
      user: storeA, sourceId: whAdmin.location_id!, destId: storeB.location_id!,
      rawLines: [{ itemId: boxId, qty: '1' }], note: '', transportMode: 'courier', transportRef: '', dispatchNow: false,
    });
    assert.equal((await transfers.getTransfer(id))!.source_id, storeA.location_id, 'the chosen source is ignored');
    await transfers.cancel({ user: storeA, id, reason: '' });
  });
});

describe('switching users', () => {
  test('only the Super Admin can switch, including while already acting as someone else', async () => {
    assert.equal(perms.canSwitchUsers(superAdmin), true);
    assert.equal(perms.canSwitchUsers(whAdmin), false);
    assert.equal(perms.canSwitchUsers(storeA), false);
    assert.equal(perms.canSwitchUsers({ ...storeA, switched_from: { id: superAdmin.id, name: superAdmin.name } }), true);
  });

  test('what the Super Admin does as another user is recorded under that user, with a note saying who did it', async () => {
    const asWarehouse: SessionUser = { ...whAdmin, switched_from: { id: superAdmin.id, name: superAdmin.name } };
    await stock.adjust({ user: asWarehouse, itemId: tapeId, locationId: whAdmin.location_id!, mode: 'in', qty: '2', reason: 'Recount' });
    const entry = (await db.get<{ user_id: number; reason: string }>('SELECT user_id, reason FROM stock_ledger ORDER BY id DESC LIMIT 1'))!;
    assert.deepEqual([entry.user_id, entry.reason], [whAdmin.id, 'Recount (done by Super Admin Root)']);

    const id = await transfers.create({ user: asWarehouse, destId: storeA.location_id!, rawLines: [{ itemId: tapeId, qty: '2' }], note: '', transportMode: 'courier', transportRef: '', dispatchNow: true, parcelPhoto: pngBuffer });
    assert.ok((await transfers.getEvents(id)).every((e) => e.user_id === whAdmin.id && e.detail.endsWith('(done by Super Admin Root)')));
    await transfers.cancel({ user: whAdmin, id, reason: 'test' });
    assert.doesNotMatch((await transfers.getEvents(id)).at(-1)!.detail, /Super Admin/, 'the user acting for themselves leaves no note');
    await stock.adjust({ user: whAdmin, itemId: tapeId, locationId: whAdmin.location_id!, mode: 'out', qty: '2', reason: 'Undo recount' });
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
    assert.equal((await db.get<{ name: string }>('SELECT name FROM users WHERE id = ?', shortId))!.name, 'Short pass');
    await assert.rejects(users.createUser(superAdmin, { name: 'N', username: 'nostore', phone: '', role: 'store_admin', locationId: null, password: 'password123' }), isAppError(/Choose the store/));
  });

  test('passwords are stored as bcrypt hashes', async () => {
    const id = await users.createUser(superAdmin, { name: 'Second Admin', username: 'second', phone: '', role: 'store_admin', locationId: storeA.location_id, password: 'correct horse' });
    const row = (await db.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', id))!;
    assert.match(row.password_hash, /^\$2[aby]\$12\$/);
    const { checkPassword } = await import('../src/lib/passwords');
    assert.equal(await checkPassword('correct horse', row.password_hash), true);
    assert.equal(await checkPassword('wrong', row.password_hash), false);
    assert.equal(await checkPassword('anything', undefined), false);
  });
});

describe('bulk upload', () => {
  test('the template has Name, Size, Unit and Stock columns only, with no image column', async () => {
    assert.deepEqual(bulk.TEMPLATE_HEADERS, ['Name', 'Size', 'Unit', 'Stock']);
    assert.equal(bulk.templateCsv().trim(), 'Name,Size,Unit,Stock');
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await bulk.templateXlsx()) as unknown as ArrayBuffer);
    const header = (wb.getWorksheet('Items')!.getRow(1).values as unknown[]).filter(Boolean);
    assert.deepEqual(header, ['Name', 'Size', 'Unit', 'Stock']);
  });

  test('CSV parsing handles quotes, commas and blank lines', async () => {
    assert.deepEqual(bulk.parseCsv('﻿Name,Size\r\n"Box, large","10""x12"""\r\n\r\nTape,48mm'),
      [['Name', 'Size'], ['Box, large', '10"x12"'], [''], ['Tape', '48mm']]);
    assert.deepEqual(bulk.parseCsv('Name;Size\nA;B'), [['Name', 'Size'], ['A', 'B']]);
  });

  test('preview reports row-level errors and imports nothing by itself', async () => {
    const sheet = path.join(dataDir, 'sheet.csv');
    fs.writeFileSync(sheet, [
      'Name,Size,Unit,Stock',
      'Mailer Bag,Medium,pcs,100',
      ',Large,,',
      'Mailer Bag,MEDIUM,,',
      'Kraft Box,Small,,',
      'Label Roll,100mm,,abc',
    ].join('\n'));
    const before = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM items'))!.n;
    await assert.rejects(bulk.buildPreview({ user: whAdmin, sheetPath: sheet, sheetName: 'sheet.csv' }), isAppError(/permission/));
    const token = await bulk.buildPreview({ user: superAdmin, sheetPath: sheet, sheetName: 'sheet.csv' });
    const { rows } = await bulk.loadPreview(token, superAdmin);
    assert.equal(rows.length, 5);
    assert.deepEqual(rows[0].errors, []);
    assert.match(rows[1].errors.join(' '), /Name is missing/);
    assert.match(rows[2].errors.join(' '), /Duplicate of row 2/);
    assert.match(rows[3].errors.join(' '), /already exists/);
    assert.match(rows[4].errors.join(' '), /Stock must be a whole number/);
    assert.equal((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM items'))!.n, before);
    await bulk.discard(token, superAdmin);
    await assert.rejects(bulk.loadPreview(token, superAdmin), isAppError(/expired/));
  });

  test('a sheet without Name or Size headings is refused; an old Image column is ignored', async () => {
    const sheet = path.join(dataDir, 'headings.csv');
    fs.writeFileSync(sheet, 'Name,Unit\nTape,roll');
    await assert.rejects(bulk.buildPreview({ user: superAdmin, sheetPath: sheet, sheetName: 'headings.csv' }), isAppError(/Missing: size/));
    fs.writeFileSync(sheet, 'Name,Size,Image (filename or URL),Unit,Stock\nOld Format Box,Tiny,box.jpg,pcs,5');
    const token = await bulk.buildPreview({ user: superAdmin, sheetPath: sheet, sheetName: 'headings.csv' });
    const { rows } = await bulk.loadPreview(token, superAdmin);
    assert.deepEqual(rows.map((r) => [r.name, r.size, r.unit, r.stock, r.errors]), [['Old Format Box', 'Tiny', 'pcs', 5, []]]);
    await bulk.discard(token, superAdmin);
  });

  test('importing adds items without pictures and the Stock column as opening stock', async () => {
    const sheet = path.join(dataDir, 'import.csv');
    fs.writeFileSync(sheet, [
      'Name,Size,Unit,Stock',
      'Velvet Pouch,3 x 4 in,pcs,250',
      'Thank You Card,A6,pcs,',
      'Gift Bag,Large,pcs,12.5',
    ].join('\n'));
    const token = await bulk.buildPreview({ user: superAdmin, sheetPath: sheet, sheetName: 'import.csv' });
    const { rows } = await bulk.loadPreview(token, superAdmin);
    assert.deepEqual(rows.map((r) => [r.name, r.stock, r.errors.length]), [['Velvet Pouch', 250, 0], ['Thank You Card', 0, 0], ['Gift Bag', 0, 1]]);
    assert.match(rows[2].errors[0], /Stock must be a whole number/);

    const result = await bulk.importPreview(token, superAdmin);
    assert.deepEqual(result, { imported: 2, skipped: 0, units: 250, rejected: 1 });
    await assert.rejects(bulk.loadPreview(token, superAdmin), isAppError(/expired/));
    const pouch = (await db.get<{ id: number; image: string; thumb: string }>("SELECT id, image, thumb FROM items WHERE name = 'Velvet Pouch'"))!;
    const card = (await db.get<{ id: number }>("SELECT id FROM items WHERE name = 'Thank You Card'"))!;
    assert.deepEqual([pouch.image, pouch.thumb], ['', ''], 'imported items start without a picture');
    assert.equal(await stock.getQty(pouch.id, await db.warehouseId()), 250);
    assert.equal(await stock.getQty(card.id, await db.warehouseId()), 0);
    // The opening stock is in the ledger like any other change.
    const entry = (await db.get<{ type: string; qty_before: number; qty_after: number; reason: string; user_id: number }>(
      'SELECT type, qty_before, qty_after, reason, user_id FROM stock_ledger WHERE item_id = ?', pouch.id))!;
    assert.deepEqual(entry, { type: 'stock_in', qty_before: 0, qty_after: 250, reason: 'Opening stock from bulk import', user_id: superAdmin.id });
    assert.equal(await db.get('SELECT 1 FROM stock_ledger WHERE item_id = ?', card.id), undefined, 'no entry when there is no opening stock');

    // A picture can be added later with Edit item.
    await items.updateItem(superAdmin, pouch.id, { name: 'Velvet Pouch', size: '3 x 4 in', unit: 'pcs' }, pngBuffer);
    const updated = (await db.get<{ image: string }>('SELECT image FROM items WHERE id = ?', pouch.id))!;
    assert.ok(await images.readStored(updated.image));
  });
});

describe('audit log', () => {
  test('records who did what, notes a Super Admin acting as someone, filters, and cannot be changed', async () => {
    const audit = await import('../src/lib/audit');
    await audit.audit(storeA, 'stock_out', 'Kraft Box (Small)', 'Store A: 10 → 5');
    await audit.audit({ ...whAdmin, switched_from: { id: superAdmin.id, name: superAdmin.name } }, 'transfer_dispatched', 'TR-9', 'Central Warehouse → Store A');
    await audit.audit(null, 'login_failed', 'nobody', 'No such username', { name: 'nobody' });

    const rows = await db.all<import('../src/lib/audit').AuditRow & { by_user_id: number | null }>('SELECT * FROM audit_log ORDER BY id');
    const out = rows.find((r) => r.action === 'stock_out')!;
    assert.equal(out.user_name, 'Asha');
    assert.equal(out.location_name, 'Store A');
    const acted = rows.find((r) => r.action === 'transfer_dispatched')!;
    assert.equal(acted.user_id, whAdmin.id);
    assert.equal(acted.by_user_id, superAdmin.id);
    assert.equal(rows.find((r) => r.action === 'login_failed')!.user_id, null);

    const count = async (f: Partial<Record<string, string>>) => {
      const { where, params } = audit.filterSql(audit.readFilters((n) => f[n] ?? ''));
      return (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_log a ${where}`, ...params))!.n;
    };
    assert.equal(await count({ user: String(superAdmin.id) }), 1, 'a user filter includes what they did through other accounts');
    assert.equal(await count({ action: 'group:Stock' }), 1);
    assert.equal(await count({ q: 'tr-9' }), 1);
    assert.equal(await count({ action: 'not_an_action' }), 3, 'an unknown activity is ignored');

    await assert.rejects(refusedSql('UPDATE audit_log SET detail = ? WHERE id = ?', 'edited', out.id));
    await assert.rejects(refusedSql('DELETE FROM audit_log WHERE id = ?', out.id));
  });
});

describe('logistic partners', () => {
  test('only the Super Admin keeps the list; senders pick an active partner on a transfer', async () => {
    const logistics = await import('../src/lib/services/logistics');
    await assert.rejects(logistics.savePartner(whAdmin, null, { name: 'Blue Dart', contact: '', phone: '' }), isAppError(/Only the Super Admin/));
    const blueDart = await logistics.savePartner(superAdmin, null, { name: 'Blue Dart', contact: 'Ravi', phone: '98250 00000' });
    await assert.rejects(logistics.savePartner(superAdmin, null, { name: 'blue dart', contact: '', phone: '' }), isAppError(/already exists/));
    await assert.rejects(logistics.setPartnerStatus(storeA, blueDart, false), isAppError(/Only the Super Admin/));

    const send = (partnerId: unknown) => transfers.create({
      user: whAdmin, destId: storeA.location_id!, rawLines: [{ itemId: tapeId, qty: '1' }], note: '',
      transportMode: 'courier', transportRef: 'BD123', partnerId, dispatchNow: false,
    });
    const id = await send(String(blueDart));
    assert.equal((await transfers.getTransfer(id))!.partner_name, 'Blue Dart');
    assert.equal((await transfers.getTransfer(await send('')))!.logistics_partner_id, null, 'a partner is optional');
    await assert.rejects(send('999999'), isAppError(/from the list/));

    // A deactivated partner cannot be chosen any more, but transfers that used it keep it.
    await logistics.setPartnerStatus(superAdmin, blueDart, false);
    await assert.rejects(send(String(blueDart)), isAppError(/from the list/));
    assert.equal((await transfers.getTransfer(id))!.partner_name, 'Blue Dart');
  });
});
