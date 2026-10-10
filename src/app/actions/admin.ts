'use server';

import { runAction } from '@/lib/action';
import { audit, changes, roleLabel } from '@/lib/audit';
import { get, now, run } from '@/lib/db';
import * as locations from '@/lib/services/locations';
import * as users from '@/lib/services/users';
import type { ActionResult, LocationRow } from '@/lib/types';
import { field, parseId, rawField, requireId } from '@/lib/util';

/* ---------- locations ---------- */

const LOCATION_FIELDS = { name: 'Name', code: 'Code', address: 'Address', gstin: 'GSTIN' };
const locationRow = (id: number) => get<LocationRow>('SELECT * FROM locations WHERE id = ?', id);

export async function saveLocationAction(formData: FormData): Promise<ActionResult> {
  return runAction(['super_admin'], async (user) => {
    const input = {
      name: rawField(formData, 'name'),
      code: rawField(formData, 'code'),
      address: rawField(formData, 'address'),
      gstin: rawField(formData, 'gstin'),
    };
    const id = parseId(rawField(formData, 'id'));
    if (id) {
      const before = await locationRow(id);
      await locations.updateLocation(user, id, input);
      const after = (await locationRow(id))!;
      await audit(user, 'location_updated', `${after.name} (${after.code})`, before ? changes(before, after, LOCATION_FIELDS) || 'No changes' : '');
      return { ok: 'Location updated.', redirectTo: '/locations' };
    }
    const wantsAdmin = field(formData, 'admin_username') !== '' || field(formData, 'admin_name') !== '';
    const storeId = await locations.createStore(user, input, wantsAdmin ? {
      name: rawField(formData, 'admin_name'),
      username: rawField(formData, 'admin_username'),
      phone: rawField(formData, 'admin_phone'),
      password: rawField(formData, 'admin_password'),
    } : null);
    const store = (await locationRow(storeId))!;
    await audit(user, 'location_created', `${store.name} (${store.code})`,
      [store.address, store.gstin && `GSTIN ${store.gstin}`, wantsAdmin && `Store Admin: ${field(formData, 'admin_username')}`].filter(Boolean).join(' · '));
    return {
      ok: wantsAdmin ? 'Store and its Store Admin created.' : 'Store created. Assign a Store Admin from the Users screen.',
      redirectTo: '/locations',
    };
  });
}

export async function setLocationStatusAction(formData: FormData): Promise<ActionResult> {
  return runAction(['super_admin'], async (user) => {
    const active = field(formData, 'active') === '1';
    const id = requireId(rawField(formData, 'id'), 'location');
    await locations.setLocationStatus(user, id, active);
    const store = await locationRow(id);
    await audit(user, active ? 'location_activated' : 'location_deactivated', store ? `${store.name} (${store.code})` : `Location #${id}`);
    return { ok: active ? 'Store activated.' : 'Store deactivated.' };
  });
}

/* ---------- users ---------- */

const USER_FIELDS = { name: 'Name', phone: 'Phone', role: 'Role', location: 'Location', status: 'Status' };
async function userSnapshot(id: number) {
  const u = await get<{ name: string; username: string; phone: string; role: string; active: number; location: string | null }>(
    `SELECT u.name, u.username, u.phone, u.role, u.active, l.name AS location
     FROM users u LEFT JOIN locations l ON l.id = u.location_id WHERE u.id = ?`, id);
  return u && { ...u, role: roleLabel(u.role), status: u.active ? 'Active' : 'Inactive' };
}

export async function saveUserAction(formData: FormData): Promise<ActionResult> {
  return runAction(['super_admin'], async (user) => {
    const id = parseId(rawField(formData, 'id'));
    const locationId = parseId(rawField(formData, 'location_id'));
    if (id) {
      const before = await userSnapshot(id);
      const password = rawField(formData, 'password');
      await users.updateUser(user, id, {
        name: rawField(formData, 'name'),
        phone: rawField(formData, 'phone'),
        role: rawField(formData, 'role'),
        locationId,
        active: field(formData, 'active') === '1',
        password,
      });
      const after = (await userSnapshot(id))!;
      const detail = [before && changes(before, after, USER_FIELDS), password && 'Password reset'].filter(Boolean).join('; ');
      await audit(user, 'user_updated', `${after.name} (${after.username})`, detail || 'No changes');
      return { ok: 'User updated.', redirectTo: '/users' };
    }
    const newId = await users.createUser(user, {
      name: rawField(formData, 'name'),
      username: rawField(formData, 'username'),
      phone: rawField(formData, 'phone'),
      role: rawField(formData, 'role'),
      locationId,
      password: rawField(formData, 'password'),
    });
    const created = (await userSnapshot(newId))!;
    await audit(user, 'user_created', `${created.name} (${created.username})`, [created.role, created.location].filter(Boolean).join(' · '));
    return { ok: 'User created.', redirectTo: '/users' };
  });
}

/* ---------- notifications ---------- */

export async function markNotificationsReadAction(): Promise<ActionResult> {
  return runAction(null, async (user) => {
    await run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', now(), user.id);
    return { ok: 'All notifications marked as read.' };
  });
}
