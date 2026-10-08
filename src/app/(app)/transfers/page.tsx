import type { Metadata } from 'next';
import Form from 'next/form';
import Link from 'next/link';
import { Empty, PageHead, Pager, StatusBadge, Tabs } from '@/components/ui';
import { all, get } from '@/lib/db';
import { canCreateTransfer, isStore, isSuper } from '@/lib/permissions';
import { STATUS_LABELS } from '@/lib/services/transfers';
import { requireUser } from '@/lib/session';
import type { TransferStatus } from '@/lib/types';
import { fmtDateTime, fmtNum, likePattern, paginate, param, queryString } from '@/lib/util';

export const metadata: Metadata = { title: 'Transfers' };

const PAGE_SIZE = 30;

type View = 'incoming' | 'outgoing' | 'all';

interface TransferListRow {
  id: number;
  number: string;
  status: TransferStatus;
  created_at: string;
  dispatched_at: string | null;
  source_id: number;
  dest_id: number;
  source_name: string;
  dest_name: string;
  line_count: number;
  units: number;
}

const VIEW_LABELS: Record<View, string> = { incoming: 'Incoming', outgoing: 'Outgoing', all: 'All transfers' };

export default async function TransfersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const home = user.location_id;

  // Which lists a role may see. The Warehouse Admin's "all" list is read-only
  // and includes store-to-store transfers; a Store Admin never gets it.
  const views: View[] = isSuper(user) ? ['all'] : isStore(user) ? ['incoming', 'outgoing'] : ['outgoing', 'all'];
  const view = views.includes(param(sp.view) as View) ? (param(sp.view) as View) : views[0];
  const status = param(sp.status) in STATUS_LABELS ? (param(sp.status) as TransferStatus) : '';
  const q = param(sp.q).trim();

  const where: string[] = [];
  const params: (string | number)[] = [];
  if (view === 'incoming') { where.push("t.dest_id = ? AND t.status <> 'draft'"); params.push(home!); }
  if (view === 'outgoing') { where.push('t.source_id = ?'); params.push(home!); }
  if (status) { where.push('t.status = ?'); params.push(status); }
  if (q) {
    where.push("(t.number LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\' OR d.name LIKE ? ESCAPE '\\')");
    params.push(likePattern(q), likePattern(q), likePattern(q));
  }
  const from = `
    FROM transfers t
    JOIN locations s ON s.id = t.source_id
    JOIN locations d ON d.id = t.dest_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;

  const total = get<{ n: number }>(`SELECT COUNT(*) AS n ${from}`, ...params)!.n;
  const pager = paginate(total, param(sp.page), PAGE_SIZE);
  const rows = all<TransferListRow>(
    `SELECT t.id, t.number, t.status, t.created_at, t.dispatched_at, t.source_id, t.dest_id,
            s.name AS source_name, d.name AS dest_name,
            (SELECT COUNT(*) FROM transfer_items ti WHERE ti.transfer_id = t.id) AS line_count,
            (SELECT COALESCE(SUM(qty_sent), 0) FROM transfer_items ti WHERE ti.transfer_id = t.id) AS units
     ${from} ORDER BY t.id DESC LIMIT ? OFFSET ?`,
    ...params, pager.pageSize, pager.offset);

  const toReceive = home
    ? get<{ n: number }>("SELECT COUNT(*) AS n FROM transfers WHERE dest_id = ? AND status = 'dispatched'", home)!.n
    : 0;
  const filtered = !!q || !!status;

  return (
    <>
      <PageHead
        title="Transfers"
        sub={view === 'all' && !isSuper(user) ? 'All transfers, including store to store. View only unless the warehouse is the source.' : 'Stock moving between locations.'}
      >
        {canCreateTransfer(user) && <Link href="/transfers/new" className="btn btn-primary">Transfer</Link>}
      </PageHead>

      {views.length > 1 && (
        <Tabs tabs={views.map((v) => ({
          href: `/transfers${queryString({ view: v })}`,
          label: VIEW_LABELS[v],
          active: v === view,
          count: v === 'incoming' ? toReceive : undefined,
        }))} />
      )}

      <Form action="/transfers" className="toolbar card">
        <input type="hidden" name="view" value={view} />
        <input type="search" name="q" defaultValue={q} placeholder="Search number or location" aria-label="Search transfers" />
        <select name="status" defaultValue={status} aria-label="Status">
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS)
            .filter(([value]) => !(view === 'incoming' && value === 'draft'))
            .map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button type="submit" className="btn">Filter</button>
        {filtered && <Link href={`/transfers${queryString({ view })}`} className="btn btn-ghost">Clear</Link>}
      </Form>

      <div className="card">
        {rows.length === 0 ? (
          <Empty>{filtered ? 'No transfers match these filters.' : view === 'incoming' ? 'No transfers have been sent to you yet.' : 'No transfers yet.'}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table cards cards-wide">
              <thead>
                <tr>
                  <th>Transfer</th>
                  <th>From</th>
                  <th>To</th>
                  <th className="num">Items</th>
                  <th className="num">Units sent</th>
                  <th>Status</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const mustReceive = t.status === 'dispatched' && !!home && t.dest_id === home;
                  return (
                    <tr key={t.id}>
                      <td className="cell-main">
                        <Link href={`/transfers/${t.id}`} className="item-name nowrap">{t.number}</Link>
                        <div className="item-size">{fmtDateTime(t.dispatched_at ?? t.created_at)}</div>
                      </td>
                      <td data-label="From">{t.source_name}</td>
                      <td data-label="To">{t.dest_name}</td>
                      <td data-label="Items" className="num">{fmtNum(t.line_count)}</td>
                      <td data-label="Units sent" className="num">{fmtNum(t.units)}</td>
                      <td data-label="Status">
                        <StatusBadge status={t.status} />
                        {t.status === 'dispatched' && <div className="muted">In transit</div>}
                      </td>
                      <td className="cell-actions">
                        <Link href={`/transfers/${t.id}`} className={mustReceive ? 'btn btn-sm btn-primary' : 'btn btn-sm'}>
                          {mustReceive ? 'Check & approve' : 'View'}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pager pager={pager} path="/transfers" query={{ view, status, q }} noun="transfer(s)" />
      </div>
    </>
  );
}
