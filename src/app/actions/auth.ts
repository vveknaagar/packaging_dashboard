'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { runAction } from '@/lib/action';
import { audit } from '@/lib/audit';
import { get, now, run, tx } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { checkPassword, hashPassword } from '@/lib/passwords';
import { canSwitchUsers } from '@/lib/permissions';
import { insertUser, normaliseUsername } from '@/lib/services/users';
import {
  clearLoginFailures, createSession, destroyOtherSessions, destroySession, getUser,
  hasAnyUser, isLoginThrottled, recordLoginFailure, setActingAs, setFlash,
} from '@/lib/session';
import { capitalizeFirst } from '@/lib/text';
import type { ActionResult, SessionUser, UserRow } from '@/lib/types';
import { field, parseId, rawField } from '@/lib/util';

/** The user as the audit log records them, for screens that run before a session exists. */
async function auditUser(id: number): Promise<SessionUser | null> {
  return (await get<SessionUser>(
    `SELECT u.id, u.name, u.username, u.role, u.location_id, l.name AS location_name, l.type AS location_type
     FROM users u LEFT JOIN locations l ON l.id = u.location_id WHERE u.id = ?`, id)) ?? null;
}

/** First-time setup: create the Super Admin. Works only while no user exists. */
export async function setupAction(formData: FormData): Promise<ActionResult> {
  try {
    if (await hasAnyUser()) throw new AppError('Setup has already been completed. Please sign in.');
    const name = capitalizeFirst(field(formData, 'name', 80));
    if (!name) throw new AppError('Your name is required.');
    const username = normaliseUsername(rawField(formData, 'username'));
    const password = rawField(formData, 'password');
    if (password !== rawField(formData, 'confirm')) throw new AppError('The two passwords do not match.');
    const hash = await hashPassword(password);
    const userId = await tx(async () => {
      if (await hasAnyUser()) throw new AppError('Setup has already been completed. Please sign in.');
      return insertUser(name, username, hash, 'super_admin', null);
    });
    await createSession(userId);
    await audit(await auditUser(userId), 'setup', username, 'Super Admin account created');
    await setFlash('Super Admin account created. Next, add your stores, users and items.');
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    console.error(err);
    return { error: 'Something went wrong. Please try again.' };
  }
  redirect('/');
}

export async function loginAction(formData: FormData): Promise<ActionResult> {
  const username = rawField(formData, 'username').trim().toLowerCase().slice(0, 60);
  const password = rawField(formData, 'password');
  try {
    if (await isLoginThrottled(username)) {
      await audit(null, 'login_failed', username, 'Blocked: too many failed attempts', { name: username });
      return { error: 'Too many failed attempts. Please wait 15 minutes and try again.' };
    }
    const user = await get<UserRow>('SELECT * FROM users WHERE username = ?', username);
    const ok = await checkPassword(password, user?.password_hash);
    if (!user || !ok || !user.active) {
      await recordLoginFailure(username);
      const why = !user ? 'No such username' : !ok ? 'Wrong password' : 'Account is deactivated';
      await audit(user ? await auditUser(user.id) : null, 'login_failed', username, why, { name: username });
      return { error: 'Wrong username or password.' };
    }
    await clearLoginFailures(username);
    await createSession(user.id);
    await audit(await auditUser(user.id), 'login', username);
  } catch (err) {
    console.error(err);
    return { error: 'Something went wrong. Please try again.' };
  }
  redirect('/');
}

export async function logoutAction(): Promise<void> {
  const user = await getUser();
  if (user) await audit(user, 'logout', user.username);
  await destroySession();
  redirect('/login');
}

/**
 * Super Admin only: use the app as another user, or (with no user chosen, or
 * their own account chosen) go back to being themselves. They stay signed in
 * as the Super Admin throughout; signing out ends it.
 */
export async function switchUserAction(formData: FormData): Promise<void> {
  const user = await getUser();
  if (!user) redirect('/login');
  if (!canSwitchUsers(user)) redirect('/');
  const ownerId = user.switched_from?.id ?? user.id;
  const targetId = parseId(rawField(formData, 'user_id'));
  if (targetId && targetId !== ownerId) {
    const target = await get<{ id: number; name: string; active: number }>('SELECT id, name, active FROM users WHERE id = ?', targetId);
    if (target?.active) {
      await setActingAs(target.id);
      await audit(user, 'switch_user', target.name, `Now using the app as ${target.name}`);
      await setFlash(`You are now using the app as ${target.name}.`);
    }
  } else {
    await setActingAs(null);
    if (user.switched_from) await audit(user, 'switch_back', user.switched_from.name, `Stopped using the app as ${user.name}`);
    await setFlash('You are back in your own account.');
  }
  // Every screen depends on who is looking, so drop anything cached for the previous user.
  revalidatePath('/', 'layout');
  redirect('/');
}

export async function changePasswordAction(formData: FormData): Promise<ActionResult> {
  return runAction(null, async (user) => {
    const row = (await get<UserRow>('SELECT * FROM users WHERE id = ?', user.id))!;
    if (!(await checkPassword(rawField(formData, 'current'), row.password_hash))) {
      throw new AppError('Your current password is not correct.');
    }
    const password = rawField(formData, 'password');
    if (password !== rawField(formData, 'confirm')) throw new AppError('The two new passwords do not match.');
    await run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(password), user.id);
    await destroyOtherSessions(user.id);
    await audit(user, 'password_changed', user.username, 'Other sessions were signed out');
    return { ok: 'Password changed.' };
  });
}

/** The first-login tour was finished or skipped. A Super Admin looking through someone else's account leaves theirs alone. */
export async function finishTourAction(): Promise<void> {
  const user = await getUser();
  if (!user || user.switched_from) return;
  await run('UPDATE users SET tour_done_at = ? WHERE id = ? AND tour_done_at IS NULL', now(), user.id);
}
