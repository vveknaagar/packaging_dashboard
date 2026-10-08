'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { runAction } from '@/lib/action';
import { get, run, tx } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { checkPassword, hashPassword } from '@/lib/passwords';
import { canSwitchUsers } from '@/lib/permissions';
import { insertUser, normaliseUsername } from '@/lib/services/users';
import {
  clearLoginFailures, createSession, destroyOtherSessions, destroySession, getUser,
  hasAnyUser, isLoginThrottled, recordLoginFailure, setActingAs, setFlash,
} from '@/lib/session';
import { capitalizeFirst } from '@/lib/text';
import type { ActionResult, UserRow } from '@/lib/types';
import { field, parseId, rawField } from '@/lib/util';

/** First-time setup: create the Super Admin. Works only while no user exists. */
export async function setupAction(formData: FormData): Promise<ActionResult> {
  try {
    if (hasAnyUser()) throw new AppError('Setup has already been completed. Please sign in.');
    const name = capitalizeFirst(field(formData, 'name', 80));
    if (!name) throw new AppError('Your name is required.');
    const username = normaliseUsername(rawField(formData, 'username'));
    const password = rawField(formData, 'password');
    if (password !== rawField(formData, 'confirm')) throw new AppError('The two passwords do not match.');
    const hash = await hashPassword(password);
    const userId = tx(() => {
      if (hasAnyUser()) throw new AppError('Setup has already been completed. Please sign in.');
      return insertUser(name, username, hash, 'super_admin', null);
    });
    await createSession(userId);
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
      return { error: 'Too many failed attempts. Please wait 15 minutes and try again.' };
    }
    const user = get<UserRow>('SELECT * FROM users WHERE username = ?', username);
    const ok = await checkPassword(password, user?.password_hash);
    if (!user || !ok || !user.active) {
      await recordLoginFailure(username);
      return { error: 'Wrong username or password.' };
    }
    await clearLoginFailures(username);
    await createSession(user.id);
  } catch (err) {
    console.error(err);
    return { error: 'Something went wrong. Please try again.' };
  }
  redirect('/');
}

export async function logoutAction(): Promise<void> {
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
    const target = get<{ id: number; name: string; active: number }>('SELECT id, name, active FROM users WHERE id = ?', targetId);
    if (target?.active) {
      await setActingAs(target.id);
      await setFlash(`You are now using the app as ${target.name}.`);
    }
  } else {
    await setActingAs(null);
    await setFlash('You are back in your own account.');
  }
  // Every screen depends on who is looking, so drop anything cached for the previous user.
  revalidatePath('/', 'layout');
  redirect('/');
}

export async function changePasswordAction(formData: FormData): Promise<ActionResult> {
  return runAction(null, async (user) => {
    const row = get<UserRow>('SELECT * FROM users WHERE id = ?', user.id)!;
    if (!(await checkPassword(rawField(formData, 'current'), row.password_hash))) {
      throw new AppError('Your current password is not correct.');
    }
    const password = rawField(formData, 'password');
    if (password !== rawField(formData, 'confirm')) throw new AppError('The two new passwords do not match.');
    run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(password), user.id);
    await destroyOtherSessions(user.id);
    return { ok: 'Password changed.' };
  });
}
