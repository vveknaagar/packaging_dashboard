import crypto from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { config } from './config';
import { get, run } from './db';
import type { Role, SessionUser } from './types';

const COOKIE_NAME = 'pkg_session';
const FLASH_COOKIE = 'pkg_flash';
/** A session ends after this long without activity... */
const IDLE_MS = 12 * 60 * 60 * 1000;
/** ...and never lasts longer than this, however active. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// Only a hash of the session token is stored, so a copy of the database
// cannot be used to impersonate anyone.
const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

interface SessionRow {
  user_id: number;
  acting_as: number | null;
  expires: number;
  created_at: number;
}

type UserLookup = Omit<SessionUser, 'switched_from'> & { active: number };

const loadUser = (id: number) => get<UserLookup>(
  `SELECT u.id, u.name, u.username, u.role, u.location_id, u.active,
          l.name AS location_name, l.type AS location_type
   FROM users u LEFT JOIN locations l ON l.id = u.location_id
   WHERE u.id = ?`, id);

/**
 * The signed-in user for this request, or null. Looked up in the database
 * every time, so a deactivated user or a changed role takes effect at once.
 */
export const getUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  const tokenHash = hashToken(token);
  const session = get<SessionRow>('SELECT user_id, acting_as, expires, created_at FROM sessions WHERE token_hash = ?', tokenHash);
  // The session always belongs to the person who signed in, even while they act as someone else.
  const owner = session ? loadUser(session.user_id) : undefined;
  const nowMs = Date.now();
  if (!session || !owner || !owner.active || session.expires <= nowMs || session.created_at + MAX_AGE_MS <= nowMs) {
    if (session) run('DELETE FROM sessions WHERE token_hash = ?', tokenHash);
    return null;
  }
  if (session.expires - nowMs < IDLE_MS / 2) {
    run('UPDATE sessions SET expires = ? WHERE token_hash = ?', nowMs + IDLE_MS, tokenHash);
  }

  let row = owner;
  let switchedFrom: SessionUser['switched_from'];
  if (session.acting_as) {
    // Only an active Super Admin can act as another user, and only while that user is active.
    const target = owner.role === 'super_admin' ? loadUser(session.acting_as) : undefined;
    if (target?.active) {
      row = target;
      switchedFrom = { id: owner.id, name: owner.name };
    } else {
      run('UPDATE sessions SET acting_as = NULL WHERE token_hash = ?', tokenHash);
    }
  }
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    role: row.role,
    location_id: row.location_id,
    location_name: row.location_name,
    location_type: row.location_type,
    ...(switchedFrom && { switched_from: switchedFrom }),
  };
});

/** For pages: the signed-in user, or a redirect to the login screen. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect('/login');
  return user;
}

export const hasRole = (user: SessionUser, ...roles: Role[]) => roles.includes(user.role);

export function hasAnyUser(): boolean {
  return !!get('SELECT 1 FROM users LIMIT 1');
}

/** Start a session for a user who has just proved who they are. */
export async function createSession(userId: number): Promise<void> {
  const token = crypto.randomBytes(32).toString('base64url');
  const nowMs = Date.now();
  run('DELETE FROM sessions WHERE expires <= ?', nowMs);
  run('INSERT INTO sessions (token_hash, user_id, created_at, expires) VALUES (?, ?, ?, ?)',
    hashToken(token), userId, nowMs, nowMs + IDLE_MS);
  const secure = config.COOKIE_SECURE || (await headers()).get('x-forwarded-proto') === 'https';
  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: MAX_AGE_MS / 1000,
  });
}

/** Make this browser's session act as another user (null returns to the signed-in account). The caller checks who may. */
export async function setActingAs(userId: number | null): Promise<void> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (token) run('UPDATE sessions SET acting_as = ? WHERE token_hash = ?', userId, hashToken(token));
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (token) run('DELETE FROM sessions WHERE token_hash = ?', hashToken(token));
  store.delete(COOKIE_NAME);
}

/** Sign a user out everywhere except (optionally) the browser making this request. */
export async function destroyOtherSessions(userId: number): Promise<void> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  run('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', userId, token ? hashToken(token) : '');
}

/** A one-shot message shown on the next page ("Item saved"). Read and cleared in the browser. */
export async function setFlash(message: string): Promise<void> {
  (await cookies()).set(FLASH_COOKIE, message, { path: '/', maxAge: 30, sameSite: 'lax' });
}

/* ---------- login throttling ---------- */

const MAX_FAILURES_PER_CLIENT = 8;
const MAX_FAILURES_PER_USERNAME = 40;
const WINDOW_MS = 15 * 60 * 1000;

const holder = globalThis as unknown as { __loginFailures?: Map<string, { count: number; first: number }> };
const failures = (holder.__loginFailures ??= new Map());

async function throttleKeys(username: string): Promise<[string, string]> {
  const forwarded = (await headers()).get('x-forwarded-for') || '';
  const ip = forwarded.split(',')[0].trim() || 'unknown';
  return [`${ip}|${username}`, `*|${username}`];
}

function countFor(key: string): number {
  const entry = failures.get(key);
  if (!entry) return 0;
  if (Date.now() - entry.first > WINDOW_MS) { failures.delete(key); return 0; }
  return entry.count;
}

export async function isLoginThrottled(username: string): Promise<boolean> {
  const [clientKey, userKey] = await throttleKeys(username);
  return countFor(clientKey) >= MAX_FAILURES_PER_CLIENT || countFor(userKey) >= MAX_FAILURES_PER_USERNAME;
}

export async function recordLoginFailure(username: string): Promise<void> {
  if (failures.size > 10000) failures.clear();
  for (const key of await throttleKeys(username)) {
    const entry = failures.get(key);
    if (!entry || Date.now() - entry.first > WINDOW_MS) failures.set(key, { count: 1, first: Date.now() });
    else entry.count += 1;
  }
}

export async function clearLoginFailures(username: string): Promise<void> {
  const [clientKey] = await throttleKeys(username);
  failures.delete(clientKey);
}
