import type { Metadata } from 'next';
import Form from 'next/form';
import Link from 'next/link';
import { Empty, PageHead, Pager } from '@/components/ui';
import { all, get } from '@/lib/db';
import { isStore } from '@/lib/permissions';
import { LEDGER_LABELS } from '@/lib/services/stock';
import { requireUser } from '@/lib/session';
import type { LedgerType, LocationRow } from '@/lib/types';
import { fmtDateTime, fmtNum, likePattern, paginate, param, parseId } from '@/lib/util';

export const metadata: Metadata = { title: 'Stock ledger' };

const PAGE_SIZE = 50;

interface LedgerRow {
  id: number;
  ts: string;
  type: LedgerType;
  qty_change: number;
  qty_before: number;
  qty_after: number;
  reason: string;
  transfer_id: number | null;
  transfer_number: string | null;
  item_name: string;
  item_size: string;
  location_name: string;
  user_name: string;
}

/** The permanent record of every stock change: who, when, how much and why. */
export default async function LedgerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const store = isStore(user);

  // A Store Admin only ever sees their own store's entries.
  const locationId = store ? user.location_id : parseId(param(sp.location));
  const type = param(sp.type) in LEDGER_LABELS ? (param(sp.type) as LedgerType) : '';
  const q = param(sp.q).trim();

  const where: string[] = [];
  const params: (string | number)[] = [];
  if (locationId) { where.push('g.location_id = ?'); params.push(locationId); }
  if (type) { where.push('g.type = ?'); params.push(type); }
  if (q) {
    where.push("(i.name LIKE ? ESCAPE '\\' OR i.size LIKE ? ESCAPE '\\')");
    params.push(likePattern(q), likePattern(q));
  }
  const from = `
    FROM stock_ledger g
    JOIN items i ON i.id = g.item_id
    JOIN locations l ON l.id = g.location_id
    JOIN users u ON u.id = g.user_id
    LEFT JOIN transfers t ON t.id = g.transfer_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;

  const total = (await get<{ n: number }>(`SELECT COUNT(*) AS n ${from}`, ...params))!.n;
  const pager = paginate(total, param(sp.page), PAGE_SIZE);
  const rows = await all<LedgerRow>(
    `SELECT g.id, g.ts, g.type, g.qty_change, g.qty_before, g.qty_after, g.reason, g.transfer_id,
            t.number AS transfer_number, i.name AS item_name, i.size AS item_size,
            l.name AS location_name, u.name AS user_name
     ${from} ORDER BY g.id DESC LIMIT ? OFFSET ?`,
    ...params, pager.pageSize, pager.offset);
  const locations = store ? [] : await all<LocationRow>("SELECT * FROM locations ORDER BY (type = 'warehouse') DESC, name");
  const filtered = !!q || !!type || (!store && !!locationId);

  return (
    <>
      <PageHead title="Stock ledger" sub="Every stock change is recorded here permanently and cannot be edited or deleted." />

      <Form action="/stock/ledger" className="toolbar card">
        {!store && (
          <select name="location" defaultValue={locationId ?? ''} aria-label="Location">
            <option value="">All locations</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}
        <select name="type" defaultValue={type} aria-label="Type of change">
          <option value="">All types</option>
          {Object.entries(LEDGER_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <input type="search" name="q" defaultValue={q} placeholder="Search item" aria-label="Search item" />
        <button type="submit" className="btn">Filter</button>
        {filtered && <Link href="/stock/ledger" className="btn btn-ghost">Clear</Link>}
      </Form>

      <div className="card">
        {rows.length === 0 ? <Empty>{filtered ? 'No entries match these filters.' : 'No stock changes have been recorded yet.'}</Empty> : (
          <div className="table-wrap">
            <table className="table cards cards-wide">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Item</th>
                  {!store && <th>Location</th>}
                  <th>Type</th>
                  <th className="num">Change</th>
                  <th className="num">Before → After</th>
                  <th>Reason</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td data-label="When" className="nowrap">{fmtDateTime(r.ts)}</td>
                    <td className="cell-main">
                      <div className="item-name">{r.item_name}</div>
                      <div className="item-size">{r.item_size}</div>
                    </td>
                    {!store && <td data-label="Location">{r.location_name}</td>}
                    <td data-label="Type">{LEDGER_LABELS[r.type]}</td>
                    <td data-label="Change" className="num"><strong>{r.qty_change > 0 ? '+' : '−'}{fmtNum(Math.abs(r.qty_change))}</strong></td>
                    <td data-label="Before → After" className="num">{fmtNum(r.qty_before)} → {fmtNum(r.qty_after)}</td>
                    <td data-label="Reason">
                      {r.reason}
                      {r.transfer_id && <> · <Link href={`/transfers/${r.transfer_id}`}>{r.transfer_number}</Link></>}
                    </td>
                    <td data-label="By">{r.user_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager pager={pager} path="/stock/ledger" query={{ location: store ? undefined : locationId, type, q }} noun="entries" />
      </div>
    </>
  );
}
