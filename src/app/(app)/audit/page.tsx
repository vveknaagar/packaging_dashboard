import type { Metadata } from 'next';
import Form from 'next/form';
import Link from 'next/link';
import { Empty, Forbidden, PageHead, Pager } from '@/components/ui';
import { AUDIT_GROUPS, AUDIT_LABELS, filterSql, readFilters, roleLabel, type AuditRow } from '@/lib/audit';
import { all, get } from '@/lib/db';
import { isSuper } from '@/lib/permissions';
import { requireUser } from '@/lib/session';
import { fmtDateTime, paginate, param, queryString } from '@/lib/util';

export const metadata: Metadata = { title: 'Audit log' };

const PAGE_SIZE = 50;

/** Everything every user has done, newest first. Only the Super Admin sees it. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (!isSuper(user)) return <Forbidden />;
  const sp = await searchParams;
  const filters = readFilters((name) => param(sp[name]));
  const { where, params } = filterSql(filters);

  // Independent lookups go to the database together rather than one after another.
  const [totalRow, people] = await Promise.all([
    get<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_log a ${where}`, ...params),
    all<{ id: number; name: string; username: string }>('SELECT id, name, username FROM users ORDER BY name'),
  ]);
  const pager = paginate(totalRow!.n, param(sp.page), PAGE_SIZE);
  const rows = await all<AuditRow>(`SELECT a.* FROM audit_log a ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    ...params, pager.pageSize, pager.offset);
  const query = { user: filters.user, action: filters.action, from: filters.from, to: filters.to, q: filters.q };
  const filtered = Object.values(query).some(Boolean);

  return (
    <>
      <PageHead title="Audit log" sub="Every action by every user: sign-ins, items, prices, stock, transfers, stores and users. Entries cannot be edited or deleted.">
        <a href={`/api/audit/export${queryString(query)}`} className="btn" download>Download CSV</a>
      </PageHead>

      <Form action="/audit" className="toolbar card">
        <select name="user" defaultValue={filters.user ?? ''} aria-label="User">
          <option value="">All users</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.username})</option>)}
        </select>
        <select name="action" defaultValue={filters.action} aria-label="Activity">
          <option value="">All activity</option>
          {Object.entries(AUDIT_GROUPS).map(([group, actions]) => (
            <optgroup key={group} label={group}>
              <option value={`group:${group}`}>All {group.toLowerCase()}</option>
              {Object.entries(actions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </optgroup>
          ))}
        </select>
        <label className="toolbar-date">From <input type="date" name="from" defaultValue={filters.from} /></label>
        <label className="toolbar-date">To <input type="date" name="to" defaultValue={filters.to} /></label>
        <input type="search" name="q" defaultValue={filters.q} placeholder="Search item, transfer, store, user…" aria-label="Search" />
        <button type="submit" className="btn">Filter</button>
        {filtered && <Link href="/audit" className="btn btn-ghost">Clear</Link>}
      </Form>

      <div className="card">
        {rows.length === 0 ? <Empty>{filtered ? 'No entries match these filters.' : 'Nothing has been recorded yet. Actions are recorded from now on.'}</Empty> : (
          <div className="table-wrap">
            <table className="table cards cards-wide">
              <thead>
                <tr>
                  <th>When</th>
                  <th>User</th>
                  <th>Activity</th>
                  <th>On</th>
                  <th>Details</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={r.action === 'login_failed' ? 'audit-failed' : undefined}>
                    <td data-label="When" className="nowrap">{fmtDateTime(r.ts)}</td>
                    <td className="cell-main">
                      <div className="item-name">{r.user_name || '—'}</div>
                      <div className="item-size">{[r.role && roleLabel(r.role), r.location_name].filter(Boolean).join(' · ')}</div>
                      {r.by_name && <div className="item-size">Done by Super Admin {r.by_name}</div>}
                    </td>
                    <td data-label="Activity"><strong>{AUDIT_LABELS[r.action] ?? r.action}</strong></td>
                    <td data-label="On">{r.target}</td>
                    <td data-label="Details" className="audit-detail">{r.detail}</td>
                    <td data-label="IP" className="muted nowrap">{r.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager pager={pager} path="/audit" query={query} noun="entries" />
      </div>
    </>
  );
}
