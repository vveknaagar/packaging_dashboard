import { activityByStore, AUDIT_LABELS, filterSql, readFilters, roleLabel, type AuditRow } from '@/lib/audit';
import { all } from '@/lib/db';
import { isSuper } from '@/lib/permissions';
import { getUser } from '@/lib/session';
import { fmtDateTime } from '@/lib/util';

/** Enough for years of use; a bigger download should be narrowed with the filters. */
const MAX_ROWS = 50_000;

const csvCell = (value: string) => {
  // A leading = + - @ would make Excel run the cell as a formula.
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * The Audit log, with the same filters as the screen, as a CSV file for Excel: every entry,
 * or with view=stores one row per store and user with a column for every activity.
 */
export async function GET(request: Request) {
  const user = await getUser();
  if (!user || !isSuper(user)) return new Response('Not allowed', { status: 403 });
  const search = new URL(request.url).searchParams;
  const filters = readFilters((name) => search.get(name) ?? '');
  const byStore = search.get('view') === 'stores';

  const lines: string[][] = [];
  if (byStore) {
    const actions = Object.keys(AUDIT_LABELS);
    lines.push(['Store', 'User', 'Role', ...actions.map((a) => AUDIT_LABELS[a]), 'Total', 'Last activity']);
    for (const s of await activityByStore(filters)) {
      for (const u of s.users) {
        lines.push([s.store || 'No store', u.user_name, u.role ? roleLabel(u.role) : '',
          ...actions.map((a) => String(u.actions[a] ?? 0)), String(u.total), fmtDateTime(u.last)]);
      }
    }
  } else {
    const { where, params } = filterSql(filters);
    const rows = await all<AuditRow>(`SELECT a.* FROM audit_log a ${where} ORDER BY a.id DESC LIMIT ?`, ...params, MAX_ROWS);
    lines.push(['When', 'User', 'Role', 'Location', 'Done by Super Admin', 'Activity', 'On', 'Details', 'IP']);
    for (const r of rows) {
      lines.push([fmtDateTime(r.ts), r.user_name, r.role ? roleLabel(r.role) : '', r.location_name, r.by_name,
        AUDIT_LABELS[r.action] ?? r.action, r.target, r.detail, r.ip]);
    }
  }
  const csv = `﻿${lines.map((cells) => cells.map(csvCell).join(',')).join('\r\n')}\r\n`;
  const day = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="audit-${byStore ? 'by-store' : 'log'}-${day}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
