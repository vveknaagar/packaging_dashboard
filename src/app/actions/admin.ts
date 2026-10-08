'use server';

import { runAction } from '@/lib/action';
import { now, run } from '@/lib/db';
import * as locations from '@/lib/services/locations';
import * as users from '@/lib/services/users';
import type { ActionResult } from '@/lib/types';
import { field, parseId, rawField, requireId } from '@/lib/util';

/* ---------- locations ---------- */

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
      locations.updateLocation(user, id, input);
      return { ok: 'Location updated.', redirectTo: '/locations' };
    }
    const wantsAdmin = field(formData, 'admin_username') !== '' || field(formData, 'admin_name') !== '';
    await locations.createStore(user, input, wantsAdmin ? {
      name: rawField(formData, 'admin_name'),
      username: rawField(formData, 'admin_username'),
      phone: rawField(formData, 'admin_phone'),
      password: rawField(formData, 'admin_password'),
    } : null);
    return {
      ok: wantsAdmin ? 'Store and its Store Admin created.' : 'Store created. Assign a Store Admin from the Users screen.',
      redirectTo: '/locations',
    };
  });
}

export async function setLocationStatusAction(formData: FormData): Promise<ActionResult> {
  return runAction(['super_admin'], (user) => {
    const active = field(formData, 'active') === '1';
    locations.setLocationStatus(user, requireId(rawField(formData, 'id'), 'location'), active);
    return { ok: active ? 'Store activated.' : 'Store deactivated.' };
  });
}

/* ---------- users ---------- */

export async function saveUserAction(formData: FormData): Promise<ActionResult> {
  return runAction(['super_admin'], async (user) => {
    const id = parseId(rawField(formData, 'id'));
    const locationId = parseId(rawField(formData, 'location_id'));
    if (id) {
      await users.updateUser(user, id, {
        name: rawField(formData, 'name'),
        phone: rawField(formData, 'phone'),
        role: rawField(formData, 'role'),
        locationId,
        active: field(formData, 'active') === '1',
        password: rawField(formData, 'password'),
      });
      return { ok: 'User updated.', redirectTo: '/users' };
    }
    await users.createUser(user, {
      name: rawField(formData, 'name'),
      username: rawField(formData, 'username'),
      phone: rawField(formData, 'phone'),
      role: rawField(formData, 'role'),
      locationId,
      password: rawField(formData, 'password'),
    });
    return { ok: 'User created.', redirectTo: '/users' };
  });
}

/* ---------- notifications ---------- */

export async function markNotificationsReadAction(): Promise<ActionResult> {
  return runAction(null, (user) => {
    run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', now(), user.id);
    return { ok: 'All notifications marked as read.' };
  });
}
