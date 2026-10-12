import type { Metadata } from 'next';
import Form from 'next/form';
import Link from 'next/link';
import { Empty, Forbidden, PageHead, Pager, Tabs } from '@/components/ui';
import { activityByStore, actionCounts, AUDIT_GROUPS, AUDIT_LABELS, filterSql, groupCount, readFilters, roleLabel, type AuditRow, type StoreActivity } from '@/lib/audit';
import { all, get } from '@/lib/db';
import { isSuper } from '@/lib/permissions';
import { requireUser } from '@/lib/session';
import { fmtDateTime, fmtNum, paginate, param, queryString } from '@/lib/util';

export const metadata: Metadata = { title: 'Audit log' };

const PAGE_SIZE = 50;
const GROUPS = Object.keys(AUDIT_GROUPS);

type Query = Record<string, string | number | null | undefined>;

/** Everything every user has done, newest first, or tallied per store and user. Only the Super Admin sees it. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (!isSuper(user)) return <Forbidden />;
  const sp = await searchParams;
  const view = param(sp.view) === 'stores' ? 'stores' : 'entries';
  const filters = readFilters((name) => param(sp[name]));
  const { where, params } = filterSql(filters);

  // Independent lookups go to the database together rather than one after another.
  const [people, locations] = await Promise.all([
    all<{ id: number; name: string; username: string }>('SELECT id, name, username FROM users ORDER BY name'),
    all<{ id: number; name: string; type: string }>("SELECT id, name, type FROM locations ORDER BY type = 'store', name"),
  ]);
  const query = { user: filters.user, store: filters.store, action: filters.action, from: filters.from, to: filters.to, q: filters.q };
  const filtered = Object.values(query).some(Boolean);
  const viewQuery = { ...query, view: view === 'stores' ? view : undefined };

  return (
    <>
      <PageHead title="Audit log" sub="Every action by every user: sign-ins, items, prices, stock, transfers, stores and users. Entries cannot be edited or deleted.">
        <a href={`/api/audit/export${queryString(viewQuery)}`} className="btn" download>Download CSV</a>
      </PageHead>

      <Tabs tabs={[
        { href: `/audit${queryString(query)}`, label: 'All entries', active: view === 'entries' },
        { href: `/audit${queryString({ ...query, view: 'stores' })}`, label: 'By store and user', active: view === 'stores' },
      ]} />

      <Form action="/audit" className="toolbar card">
        {view === 'stores' && <input type="hidden" name="view" value="stores" />}
        <select name="store" defaultValue={filters.store ?? ''} aria-label="Store">
          <option value="">All stores</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}{l.type === 'warehouse' ? ' (warehouse)' : ''}</option>)}
        </select>
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
        {filtered && <Link href={`/audit${queryString({ view: viewQuery.view })}`} className="btn btn-ghost">Clear</Link>}
      </Form>

      {view === 'stores'
        ? <ByStore stores={await activityByStore(filters)} storeIds={new Map(locations.map((l) => [l.name.toLowerCase(), l.id]))} query={query} filtered={filtered} />
        : <Entries where={where} params={params} page={param(sp.page)} query={query} filtered={filtered} />}
    </>
  );
}

async function Entries({ where, params, page, query, filtered }: { where: string; params: (string | number)[]; page: string; query: Query; filtered: boolean }) {
  const totalRow = await get<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_log a ${where}`, ...params);
  const pager = paginate(totalRow!.n, page, PAGE_SIZE);
  const rows = await all<AuditRow>(`SELECT a.* FROM audit_log a ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    ...params, pager.pageSize, pager.offset);
  return (
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
  );
}

/** One card per location: each of its users with how many entries they have of every kind. */
function ByStore({ stores, storeIds, query, filtered }: { stores: StoreActivity[]; storeIds: Map<string, number>; query: Query; filtered: boolean }) {
  if (stores.length === 0) {
    return <div className="card"><Empty>{filtered ? 'No entries match these filters.' : 'Nothing has been recorded yet. Actions are recorded from now on.'}</Empty></div>;
  }
  // Counts open the matching entries in the list.
  const entries = (more: Query) => `/audit${queryString({ ...query, ...more })}`;
  return stores.map((s) => {
    const storeId = storeIds.get(s.store.toLowerCase());
    return (
      <section key={s.store} className="card">
        <div className="card-head">
          <h2>{s.store || 'No store (Super Admin, failed sign-ins)'}</h2>
          <span className="muted">
            {s.users.length} {s.users.length === 1 ? 'user' : 'users'} · {fmtNum(s.total)} entries · last {fmtDateTime(s.last)}
            {storeId && <> · <Link href={entries({ store: storeId })}>See entries</Link></>}
          </span>
        </div>
        <div className="table-wrap">
          <table className="table cards cards-wide">
            <thead>
              <tr>
                <th>User</th>
                {GROUPS.map((g) => <th key={g} className="num">{g}</th>)}
                <th className="num">Total</th>
                <th>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {s.users.map((u) => {
                const link = (more: Query, n: number) => (u.user_id && n ? <Link href={entries({ user: u.user_id, ...more })}>{fmtNum(n)}</Link> : n ? fmtNum(n) : '—');
                return (
                  <tr key={`${u.user_id}|${u.user_name}`}>
                    <td className="cell-main">
                      <div className="item-name">{u.user_name || '—'}</div>
                      <div className="item-size">{u.role ? roleLabel(u.role) : 'Unknown user'}</div>
                      <div className="item-size audit-breakdown">
                        {actionCounts(u.actions).map((a) => `${a.label} ${fmtNum(a.n)}`).join(' · ')}
                      </div>
                    </td>
                    {GROUPS.map((g) => <td key={g} data-label={g} className="num">{link({ action: `group:${g}` }, groupCount(u.actions, g))}</td>)}
                    <td data-label="Total" className="num"><strong>{link({}, u.total)}</strong></td>
                    <td data-label="Last activity" className="nowrap">{fmtDateTime(u.last)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted audit-breakdown">
          <strong>Every activity:</strong> {actionCounts(s.actions).map((a) => `${a.label} ${fmtNum(a.n)}`).join(' · ')}
        </p>
      </section>
    );
  });
}
