import { get, now, run, tx, warehouseId } from '../db';
import { AppError, ForbiddenError, NotFoundError } from '../errors';
import { hashPassword } from '../passwords';
import { isSuper } from '../permissions';
import { capitalizeFirst } from '../text';
import type { LocationRow, Role, SessionUser, UserRow } from '../types';
import { clean } from '../util';

const USERNAME_RULE = /^[a-z0-9._-]{3,40}$/;
const ROLES: Role[] = ['super_admin', 'warehouse_admin', 'store_admin'];

export function normaliseUsername(value: unknown): string {
  const username = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!USERNAME_RULE.test(username)) {
    throw new AppError('Username must be 3 to 40 characters: letters, numbers, dot, dash or underscore.');
  }
  return username;
}

function assertSuper(user: SessionUser) {
  if (!isSuper(user)) throw new ForbiddenError('Only the Super Admin can manage users.');
}

function parseRole(value: unknown): Role {
  if (!ROLES.includes(value as Role)) throw new AppError('Choose a role.');
  return value as Role;
}

/** A Warehouse Admin always belongs to the warehouse; a Store Admin to exactly one store. */
function resolveLocation(role: Role, locationId: number | null): number | null {
  if (role === 'super_admin') return null;
  if (role === 'warehouse_admin') return warehouseId();
  const store = locationId ? get<LocationRow>('SELECT * FROM locations WHERE id = ?', locationId) : undefined;
  if (!store || store.type !== 'store') throw new AppError('Choose the store this Store Admin manages.');
  return store.id;
}

function assertUsernameFree(username: string, exceptId = 0) {
  if (get('SELECT 1 FROM users WHERE username = ? AND id <> ?', username, exceptId)) {
    throw new AppError(`The username "${username}" is already taken.`);
  }
}

/** Phone numbers are optional; when given they may hold digits, spaces and + - ( ). */
export function cleanPhone(value: unknown): string {
  const phone = clean(value, 30);
  if (phone && !/^[0-9+\-() ]+$/.test(phone)) throw new AppError('Phone number can contain only digits, spaces, +, - and brackets.');
  return phone;
}

export interface UserInput {
  name: unknown;
  username: unknown;
  phone: unknown;
  role: unknown;
  locationId: number | null;
  password: string;
}

/** Insert a user row. The caller has already checked who is allowed to do this. */
export function insertUser(name: string, username: string, passwordHash: string, role: Role, locationId: number | null, phone = ''): number {
  const info = run(
    'INSERT INTO users (name, username, password_hash, role, location_id, phone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    name, username, passwordHash, role, locationId, phone, now());
  return Number(info.lastInsertRowid);
}

export async function createUser(actor: SessionUser, input: UserInput): Promise<number> {
  assertSuper(actor);
  const name = capitalizeFirst(clean(input.name, 80));
  if (!name) throw new AppError('Name is required.');
  const username = normaliseUsername(input.username);
  const phone = cleanPhone(input.phone);
  const role = parseRole(input.role);
  const hash = await hashPassword(input.password);
  return tx(() => {
    assertUsernameFree(username);
    return insertUser(name, username, hash, role, resolveLocation(role, input.locationId), phone);
  });
}

export interface UserUpdate {
  name: unknown;
  phone: unknown;
  role: unknown;
  locationId: number | null;
  active: boolean;
  /** Empty string keeps the current password. */
  password: string;
}

export async function updateUser(actor: SessionUser, id: number, input: UserUpdate): Promise<void> {
  assertSuper(actor);
  const name = capitalizeFirst(clean(input.name, 80));
  if (!name) throw new AppError('Name is required.');
  const phone = cleanPhone(input.phone);
  const role = parseRole(input.role);
  const hash = input.password ? await hashPassword(input.password) : null;
  tx(() => {
    const target = get<UserRow>('SELECT * FROM users WHERE id = ?', id);
    if (!target) throw new NotFoundError('User not found.');
    if (target.id === actor.id && (role !== 'super_admin' || !input.active)) {
      throw new AppError('You cannot change your own role or deactivate your own account.');
    }
    const locationId = resolveLocation(role, input.locationId);
    run('UPDATE users SET name = ?, phone = ?, role = ?, location_id = ?, active = ? WHERE id = ?',
      name, phone, role, locationId, input.active ? 1 : 0, id);
    if (hash) run('UPDATE users SET password_hash = ? WHERE id = ?', hash, id);
    if (!get("SELECT 1 FROM users WHERE role = 'super_admin' AND active = 1")) {
      throw new AppError('There must always be at least one active Super Admin.');
    }
    // A new password, role or status signs the user out everywhere.
    if (hash || !input.active || role !== target.role || locationId !== target.location_id) {
      run('DELETE FROM sessions WHERE user_id = ?', id);
    }
  });
}
