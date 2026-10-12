import { headers } from 'next/headers';
import { all, now, run } from './db';
import { ROLE_LABELS } from './permissions';
import type { Role, SessionUser } from './types';
import { fmtMoney, likePattern } from './util';

/** Every kind of entry, grouped as the filter on the Audit log screen shows them. */
export const AUDIT_GROUPS: Record<string, Record<string, string>> = {
  'Sign-in': {
    login: 'Signed in',
    login_failed: 'Failed sign-in',
    logout: 'Signed out',
    switch_user: 'Switched to another user',
    switch_back: 'Switched back to own account',
    password_changed: 'Changed password',
    setup: 'First-time setup',
  },
  Items: {
    item_created: 'Item added',
    item_updated: 'Item edited',
    item_activated: 'Item activated',
    item_deactivated: 'Item deactivated',
    pricing_changed: 'Price / HSN changed',
    bulk_imported: 'Bulk upload imported',
    bulk_discarded: 'Bulk upload discarded',
  },
  Stock: {
    stock_in: 'Stock in',
    stock_out: 'Stock out',
    stock_set: 'Stock adjusted',
  },
  Transfers: {
    transfer_draft: 'Transfer draft saved',
    transfer_dispatched: 'Transfer dispatched',
    transfer_received: 'Transfer received',
    transfer_discrepancy: 'Transfer received with discrepancy',
    transfer_rejected: 'Transfer rejected',
    transfer_cancelled: 'Transfer cancelled',
  },
  Setup: {
    location_created: 'Store added',
    location_updated: 'Location edited',
    location_activated: 'Store activated',
    location_deactivated: 'Store deactivated',
    partner_created: 'Logistic partner added',
    partner_updated: 'Logistic partner edited',
    partner_activated: 'Logistic partner activated',
    partner_deactivated: 'Logistic partner deactivated',
    user_created: 'User added',
    user_updated: 'User edited',
  },
};

export const AUDIT_LABELS: Record<string, string> = Object.assign({}, ...Object.values(AUDIT_GROUPS));

export type AuditAction = keyof typeof AUDIT_LABELS;

async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    return (h.get('x-forwarded-for') || h.get('x-real-ip') || '').split(',')[0].trim().slice(0, 64);
  } catch {
    return ''; // Not inside a request (scripts and tests).
  }
}

/**
 * Record an action. The user is who the app was being used as; if a Super Admin
 * was acting through that account, they are recorded too. A failure to write
 * the entry is logged but never undoes or blocks the action itself.
 */
export async function audit(user: SessionUser | null, action: AuditAction, target = '', detail = '', who?: { name: string; role?: Role | '' }): Promise<void> {
  try {
    await run(
      `INSERT INTO audit_log (ts, user_id, user_name, role, location_name, by_user_id, by_name, action, target, detail, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      now(),
      user?.id ?? null,
      (user?.name ?? who?.name ?? '').slice(0, 120),
      user?.role ?? who?.role ?? '',
      user?.location_name ?? '',
      user?.switched_from?.id ?? null,
      user?.switched_from?.name ?? '',
      action,
      target.slice(0, 300),
      detail.slice(0, 4000),
      await clientIp());
  } catch (err) {
    console.error('Could not write the audit log:', err);
  }
}

/** "Name: Old → New; Role: Store Admin → Warehouse Admin" for the fields that changed. */
export function changes<T extends object>(before: T, after: T, labels: Partial<Record<keyof T, string>>): string {
  const show = (v: unknown) => (v === null || v === undefined || v === '' ? '(blank)' : String(v));
  return (Object.entries(labels) as [keyof T, string][])
    .filter(([key]) => String(before[key] ?? '') !== String(after[key] ?? ''))
    .map(([key, label]) => `${label}: ${show(before[key])} → ${show(after[key])}`)
    .join('; ');
}

export const roleLabel = (role: string) => ROLE_LABELS[role as Role] ?? role;
export const money = (paise: number | null) => (paise === null ? '' : fmtMoney(paise));

/** Names to show for ids, so entries read "Kraft Box (Small)" rather than "item 12". */
export async function itemLabel(id: number): Promise<string> {
  const [row] = await all<{ name: string; size: string }>('SELECT name, size FROM items WHERE id = ?', id);
  return row ? `${row.name} (${row.size})` : `Item #${id}`;
}

/* ---------- reading the log ---------- */

export interface AuditRow {
  id: number;
  ts: string;
  user_id: number | null;
  user_name: string;
  role: string;
  location_name: string;
  by_name: string;
  action: string;
  target: string;
  detail: string;
  ip: string;
}

export interface AuditFilters {
  user: number | null;
  /** A location: what its users did. */
  store: number | null;
  /** One action, or a whole group ("group:Stock"). */
  action: string;
  from: string;
  to: string;
  q: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A calendar day in India as the UTC instant it starts, to compare with the stored ISO times. */
const dayStart = (day: string, plusDays = 0) => {
  const d = new Date(`${day}T00:00:00+05:30`);
  d.setUTCDate(d.getUTCDate() + plusDays);
  return d.toISOString();
};

export function readFilters(get: (name: string) => string): AuditFilters {
  const id = (name: string) => {
    const n = Number(get(name));
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  const action = get('action');
  return {
    user: id('user'),
    store: id('store'),
    action: action in AUDIT_LABELS || (action.startsWith('group:') && action.slice(6) in AUDIT_GROUPS) ? action : '',
    from: DATE.test(get('from')) ? get('from') : '',
    to: DATE.test(get('to')) ? get('to') : '',
    q: get('q').trim().slice(0, 100),
  };
}

/** WHERE clause and parameters for the filters. */
export function filterSql(f: AuditFilters): { where: string; params: (string | number)[] } {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.user) { where.push('(a.user_id = ? OR a.by_user_id = ?)'); params.push(f.user, f.user); }
  // Entries carry the location's name as it was then; its users' ids also catch entries from before a rename.
  if (f.store) {
    where.push('(a.user_id IN (SELECT id FROM users WHERE location_id = ?) OR a.location_name = (SELECT name FROM locations WHERE id = ?))');
    params.push(f.store, f.store);
  }
  if (f.action.startsWith('group:')) {
    const keys = Object.keys(AUDIT_GROUPS[f.action.slice(6)]);
    where.push(`a.action IN (${keys.map(() => '?').join(', ')})`);
    params.push(...keys);
  } else if (f.action) { where.push('a.action = ?'); params.push(f.action); }
  if (f.from) { where.push('a.ts >= ?'); params.push(dayStart(f.from)); }
  if (f.to) { where.push('a.ts < ?'); params.push(dayStart(f.to, 1)); }
  if (f.q) {
    const like = likePattern(f.q);
    where.push("(a.target ILIKE ? ESCAPE '\\' OR a.detail ILIKE ? ESCAPE '\\' OR a.user_name ILIKE ? ESCAPE '\\' OR a.by_name ILIKE ? ESCAPE '\\')");
    params.push(like, like, like, like);
  }
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

/* ---------- by store and user ---------- */

export interface UserActivity {
  user_id: number | null;
  user_name: string;
  role: string;
  /** Entries per action. */
  actions: Record<string, number>;
  total: number;
  last: string;
}

export interface StoreActivity {
  /** The location's name as recorded; '' for entries tied to no location (Super Admin, failed sign-ins). */
  store: string;
  users: UserActivity[];
  actions: Record<string, number>;
  total: number;
  last: string;
}

/** Entries per location, per user and per action, for the same filters as the list. */
export async function activityByStore(f: AuditFilters): Promise<StoreActivity[]> {
  const { where, params } = filterSql(f);
  const rows = await all<{ location_name: string; user_id: number | null; user_name: string; role: string; action: string; n: number; last: string }>(
    `SELECT a.location_name, a.user_id, a.user_name, a.role, a.action, COUNT(*) AS n, MAX(a.ts) AS last
     FROM audit_log a ${where}
     GROUP BY a.location_name, a.user_id, a.user_name, a.role, a.action`, ...params);

  const stores = new Map<string, StoreActivity & { byUser: Map<string, UserActivity> }>();
  for (const r of rows) {
    let store = stores.get(r.location_name);
    if (!store) stores.set(r.location_name, store = { store: r.location_name, users: [], actions: {}, total: 0, last: '', byUser: new Map() });
    const key = `${r.user_id ?? ''}|${r.user_name}`;
    let person = store.byUser.get(key);
    if (!person) store.byUser.set(key, person = { user_id: r.user_id, user_name: r.user_name, role: r.role, actions: {}, total: 0, last: '' });
    for (const tally of [store, person]) {
      tally.actions[r.action] = (tally.actions[r.action] ?? 0) + r.n;
      tally.total += r.n;
      if (r.last > tally.last) tally.last = r.last;
    }
  }
  return [...stores.values()]
    .map(({ byUser, ...store }) => ({ ...store, users: [...byUser.values()].sort((a, b) => b.total - a.total || a.user_name.localeCompare(b.user_name)) }))
    // Locations by name, then the entries that belong to no location.
    .sort((a, b) => Number(!a.store) - Number(!b.store) || a.store.localeCompare(b.store));
}

/** Entries in one group of actions ("Stock") from a tally. */
export const groupCount = (actions: Record<string, number>, group: string): number =>
  Object.keys(AUDIT_GROUPS[group]).reduce((sum, action) => sum + (actions[action] ?? 0), 0);

/** Every action in a tally with its count, in the order the filter lists them. */
export const actionCounts = (actions: Record<string, number>) =>
  Object.keys(AUDIT_LABELS).filter((action) => actions[action]).map((action) => ({ action, label: AUDIT_LABELS[action], n: actions[action] }));
