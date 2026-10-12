import { all, get, insert, now, run, tx } from '../db';
import { AppError, ForbiddenError, NotFoundError } from '../errors';
import { hashPassword } from '../passwords';
import { isSuper } from '../permissions';
import { capitalizeFirst } from '../text';
import type { LocationRow, LocationType, SessionUser } from '../types';
import { clean } from '../util';
import { cleanPhone, insertUser, normaliseUsername } from './users';

/** A location has no contact fields of its own: its contact is its admin (name and phone). */
export interface LocationInput {
  name: unknown;
  code: unknown;
  address: unknown;
  /** City, state and PIN code: required for a store, printed on its delivery challans. */
  city?: unknown;
  state?: unknown;
  pincode?: unknown;
  gstin: unknown;
}

/** Optional Store Admin created together with a new store. */
export interface NewAdminInput {
  name: unknown;
  username: unknown;
  phone: unknown;
  password: string;
}

function assertSuper(user: SessionUser) {
  if (!isSuper(user)) throw new ForbiddenError('Only the Super Admin can manage locations.');
}

/** 15 characters: state code, PAN, entity number, Z, check character. */
const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** A store must have an address, city, state, PIN code and GSTIN; for the warehouse they are optional. */
function validate(input: LocationInput, type: LocationType) {
  const name = clean(input.name, 80);
  const code = clean(input.code, 12).toUpperCase();
  const address = clean(input.address, 300);
  const city = clean(input.city, 60);
  const state = clean(input.state, 60);
  const pincode = clean(input.pincode, 10).replace(/\s/g, '');
  const gstin = clean(input.gstin, 30).replace(/\s/g, '').toUpperCase();
  if (!name) throw new AppError('Name is required.');
  if (!/^[A-Z0-9-]{1,12}$/.test(code)) throw new AppError('Code is required: up to 12 letters, numbers or dashes.');
  if (type === 'store' && !address) throw new AppError('Address is required for a store.');
  if (type === 'store' && !city) throw new AppError('City is required for a store.');
  if (type === 'store' && !state) throw new AppError('State is required for a store.');
  if (type === 'store' && !pincode) throw new AppError('PIN code is required for a store.');
  if (pincode && !/^\d{6}$/.test(pincode)) throw new AppError('PIN code must be 6 digits.');
  if (type === 'store' && !gstin) throw new AppError('GSTIN is required for a store.');
  if (gstin && !GSTIN_PATTERN.test(gstin)) throw new AppError('GSTIN must be 15 characters, for example 24ABCDE1234F1Z5.');
  return { name, code, address, city, state, pincode, gstin };
}

async function assertCodeFree(code: string, exceptId = 0) {
  if (await get('SELECT 1 FROM locations WHERE code = ? AND id <> ?', code, exceptId)) {
    throw new AppError(`The code "${code}" is already used by another location.`);
  }
}

/** Add a store. Stores are the only locations that can be added; the warehouse is fixed. */
export async function createStore(actor: SessionUser, input: LocationInput, admin: NewAdminInput | null): Promise<number> {
  assertSuper(actor);
  const data = validate(input, 'store');
  let adminData: { name: string; username: string; phone: string; hash: string } | null = null;
  if (admin) {
    const name = capitalizeFirst(clean(admin.name, 80));
    if (!name) throw new AppError('Store Admin name is required.');
    adminData = {
      name,
      username: normaliseUsername(admin.username),
      phone: cleanPhone(admin.phone),
      hash: await hashPassword(admin.password),
    };
  }
  return tx(async () => {
    await assertCodeFree(data.code);
    const id = await insert(
      "INSERT INTO locations (type, name, code, address, city, state, pincode, gstin, created_at) VALUES ('store', ?, ?, ?, ?, ?, ?, ?, ?)",
      data.name, data.code, data.address, data.city, data.state, data.pincode, data.gstin, now());
    if (adminData) {
      if (await get('SELECT 1 FROM users WHERE username = ?', adminData.username)) {
        throw new AppError(`The username "${adminData.username}" is already taken.`);
      }
      await insertUser(adminData.name, adminData.username, adminData.hash, 'store_admin', id, adminData.phone);
    }
    return id;
  });
}

export async function updateLocation(actor: SessionUser, id: number, input: LocationInput): Promise<void> {
  assertSuper(actor);
  await tx(async () => {
    const location = await get<LocationRow>('SELECT * FROM locations WHERE id = ?', id);
    if (!location) throw new NotFoundError('Location not found.');
    const data = validate(input, location.type);
    await assertCodeFree(data.code, id);
    await run('UPDATE locations SET name = ?, code = ?, address = ?, city = ?, state = ?, pincode = ?, gstin = ? WHERE id = ?',
      data.name, data.code, data.address, data.city, data.state, data.pincode, data.gstin, id);
  });
}

export async function setLocationStatus(actor: SessionUser, id: number, active: boolean): Promise<void> {
  assertSuper(actor);
  await tx(async () => {
    const location = await get<LocationRow>('SELECT * FROM locations WHERE id = ?', id);
    if (!location) throw new NotFoundError('Location not found.');
    if (location.type === 'warehouse') throw new AppError('The warehouse cannot be deactivated.');
    if (!active) {
      const open = (await get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM transfers WHERE status = 'dispatched' AND (source_id = ? OR dest_id = ?)", id, id))!.n;
      if (open) throw new AppError(`${location.name} has ${open} transfer(s) in transit. Receive, reject or cancel them first.`);
    }
    await run('UPDATE locations SET active = ? WHERE id = ?', active ? 1 : 0, id);
  });
}

export interface LocationContact {
  name: string;
  phone: string;
}

/**
 * The people to contact at each location, keyed by location id: its active
 * admins, oldest account first. This is what "contact person and phone" means
 * for a location now that it has no contact fields of its own.
 */
export async function allContacts(): Promise<Map<number, LocationContact[]>> {
  const rows = await all<{ location_id: number; name: string; phone: string }>(
    'SELECT location_id, name, phone FROM users WHERE active = 1 AND location_id IS NOT NULL ORDER BY id');
  const map = new Map<number, LocationContact[]>();
  for (const row of rows) {
    const list = map.get(row.location_id) ?? [];
    list.push({ name: row.name, phone: row.phone });
    map.set(row.location_id, list);
  }
  return map;
}
