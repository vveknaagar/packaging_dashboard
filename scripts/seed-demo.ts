/**
 * Fills an EMPTY database with demo data so the app can be explored at once:
 * three stores, one user per role, a few items with placeholder pictures,
 * opening stock and transfers in different states.
 *
 *   npm run seed:demo    the database in .env (DATABASE_URL)
 *   npm run seed:local   the local database used by start:local / dev:local
 *
 * It refuses to run once there is real data (stores, items or transfers), or
 * if a demo username is already taken. An existing Super Admin account is
 * fine: it is kept and works alongside the demo users. All demo accounts share one
 * password (printed at the end). Do not use demo data for real stock.
 */
import sharp from 'sharp';
import { close, get, warehouseId } from '../src/lib/db';
import { hashPassword } from '../src/lib/passwords';
import * as items from '../src/lib/services/items';
import * as locations from '../src/lib/services/locations';
import * as stock from '../src/lib/services/stock';
import * as transfers from '../src/lib/services/transfers';
import { insertUser } from '../src/lib/services/users';
import type { Role, SessionUser } from '../src/lib/types';

const PASSWORD = process.env.DEMO_PASSWORD || 'packaging123';

const ITEMS = [
  { name: 'Kraft Box', size: 'Small 6 x 4 x 2 in', label: 'KB-S', unit: 'pcs', colour: '#c9a26b', open: 1500 },
  { name: 'Kraft Box', size: 'Medium 10 x 8 x 4 in', label: 'KB-M', unit: 'pcs', colour: '#b98f55', open: 900 },
  { name: 'Kraft Box', size: 'Large 14 x 10 x 6 in', label: 'KB-L', unit: 'pcs', colour: '#a67c44', open: 90 },
  { name: 'Jewellery Pouch', size: 'Velvet 3 x 4 in', label: 'JP-V', unit: 'pcs', colour: '#7b2d4f', open: 2400 },
  { name: 'Paper Carry Bag', size: 'Medium', label: 'CB-M', unit: 'pcs', colour: '#e9e2d0', open: 1800 },
  { name: 'Bubble Wrap Roll', size: '1 m x 50 m', label: 'BW-50', unit: 'roll', colour: '#bcd9ee', open: 36 },
  { name: 'Packing Tape', size: '48 mm x 65 m', label: 'PT-48', unit: 'roll', colour: '#d9a441', open: 240 },
  { name: 'Thank You Card', size: 'A6', label: 'TY-A6', unit: 'pcs', colour: '#f3efe6', open: 400 },
];

async function placeholder(label: string, colour: string): Promise<Buffer> {
  const safe = label.replace(/[<>&]/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">
    <rect width="600" height="600" fill="#ffffff"/>
    <rect x="110" y="170" width="380" height="300" rx="18" fill="${colour}" stroke="#3a3a36" stroke-width="6"/>
    <path d="M110 250 H490" stroke="#3a3a36" stroke-width="6"/>
    <text x="300" y="540" font-family="Arial, sans-serif" font-size="34" text-anchor="middle" fill="#3a3a36">${safe}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** A stand-in photo of a packed parcel, which every dispatch needs. */
function parcelPhoto(label: string): Promise<Buffer> {
  const safe = label.replace(/[<>&]/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
    <rect width="800" height="600" fill="#e8e4da"/>
    <rect x="200" y="140" width="400" height="300" rx="10" fill="#b98f55" stroke="#5a4325" stroke-width="6"/>
    <rect x="370" y="140" width="60" height="300" fill="#d9a441" opacity="0.9"/>
    <rect x="240" y="320" width="150" height="80" fill="#ffffff" stroke="#5a4325" stroke-width="3"/>
    <text x="400" y="520" font-family="Arial, sans-serif" font-size="36" text-anchor="middle" fill="#3a3a36">Parcel ${safe}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg().toBuffer();
}

async function user(id: number): Promise<SessionUser> {
  return (await get<SessionUser>(
    `SELECT u.id, u.name, u.username, u.role, u.location_id, l.name AS location_name, l.type AS location_type
     FROM users u LEFT JOIN locations l ON l.id = u.location_id WHERE u.id = ?`, id))!;
}

async function main() {
  const realData = await get("SELECT 1 FROM locations WHERE type = 'store' UNION ALL SELECT 1 FROM items UNION ALL SELECT 1 FROM transfers LIMIT 1");
  const taken = await get("SELECT 1 FROM users WHERE username IN ('admin', 'warehouse', 'store1', 'store2', 'store3')");
  if (realData || taken) {
    console.error('This database already has stores, items, transfers or demo users, so demo data was not added.');
    await close();
    process.exit(1);
  }
  const hash = await hashPassword(PASSWORD);
  const add = async (name: string, username: string, role: Role, locationId: number | null, phone = '') =>
    user(await insertUser(name, username, hash, role, locationId, phone));

  const admin = await add('Demo Super Admin', 'admin', 'super_admin', null);
  const warehouse = await add('Demo Warehouse Admin', 'warehouse', 'warehouse_admin', await warehouseId(), '0261 000 0000');

  const storeIds: number[] = [];
  for (const s of [
    { name: 'Varachha Store', code: 'VAR', address: 'Varachha Road, Surat', city: 'Surat', state: 'Gujarat', pincode: '395006', gstin: '24AAACD1234E1Z1' },
    { name: 'Adajan Store', code: 'ADJ', address: 'Adajan, Surat', city: 'Surat', state: 'Gujarat', pincode: '395009', gstin: '24AAACD1234E2Z0' },
    { name: 'Vesu Store', code: 'VES', address: 'Vesu, Surat', city: 'Surat', state: 'Gujarat', pincode: '395007', gstin: '24AAACD1234E3Z9' },
  ]) storeIds.push(await locations.createStore(admin, s, null));
  const store1 = await add('Demo Store Admin (Varachha)', 'store1', 'store_admin', storeIds[0], '0261 000 0001');
  const store2 = await add('Demo Store Admin (Adajan)', 'store2', 'store_admin', storeIds[1], '0261 000 0002');
  await add('Demo Store Admin (Vesu)', 'store3', 'store_admin', storeIds[2], '0261 000 0003');

  const itemIds: number[] = [];
  for (const item of ITEMS) {
    const id = await items.createItem(admin,
      { name: item.name, size: item.size, unit: item.unit },
      await placeholder(item.label, item.colour));
    itemIds.push(id);
    await stock.adjust({ user: warehouse, itemId: id, locationId: warehouse.location_id!, mode: 'in', qty: String(item.open), reason: 'Opening stock' });
  }
  const line = (index: number, qty: number) => ({ itemId: itemIds[index], qty: String(qty) });

  // Received in full.
  const t1 = await transfers.create({ user: warehouse, destId: storeIds[0], rawLines: [line(0, 300), line(3, 500), line(4, 400), line(6, 30)], note: 'Weekly replenishment', transportMode: 'road_own', transportRef: '', dispatchNow: true, parcelPhoto: await parcelPhoto('1') });
  await transfers.receive({ user: store1, id: t1, received: Object.fromEntries((await transfers.getLines(t1)).map((l) => [l.id, String(l.qty_sent)])), remark: '' });
  // Received with a discrepancy.
  const t2 = await transfers.create({ user: warehouse, destId: storeIds[1], rawLines: [line(0, 200), line(1, 150), line(5, 6)], note: '', transportMode: 'road_own', transportRef: '', dispatchNow: true, parcelPhoto: await parcelPhoto('2') });
  await transfers.receive({
    user: store2, id: t2, remark: '10 small boxes arrived crushed',
    received: Object.fromEntries((await transfers.getLines(t2)).map((l) => [l.id, String(l.item_id === itemIds[0] ? l.qty_sent - 10 : l.qty_sent)])),
  });
  // In transit: waiting to be received.
  await transfers.create({ user: warehouse, destId: storeIds[0], rawLines: [line(1, 120), line(7, 150)], note: 'Festival stock', transportMode: 'road_own', transportRef: '', dispatchNow: true, parcelPhoto: await parcelPhoto('3') });
  await transfers.create({ user: store1, destId: storeIds[1], rawLines: [line(3, 100)], note: 'Adajan ran short of pouches', transportMode: 'road_own', transportRef: '', dispatchNow: true, parcelPhoto: await parcelPhoto('4') });
  // A draft.
  await transfers.create({ user: warehouse, destId: storeIds[2], rawLines: [line(4, 300), line(6, 24)], note: 'First stock for Vesu', transportMode: 'road_own', transportRef: '', dispatchNow: false });
  // Everyday use at a store.
  await stock.adjust({ user: store1, itemId: itemIds[0], locationId: store1.location_id!, mode: 'out', qty: '140', reason: 'Used for orders' });

  await close();
  console.log('Demo data added.\n');
  console.log('Sign in with any of these (same password for all):');
  console.log('  admin      Super Admin');
  console.log('  warehouse  Warehouse Admin');
  console.log('  store1     Store Admin, Varachha Store');
  console.log('  store2     Store Admin, Adajan Store');
  console.log('  store3     Store Admin, Vesu Store');
  console.log(`\nPassword: ${PASSWORD}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
