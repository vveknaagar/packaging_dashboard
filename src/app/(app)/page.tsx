import type { Metadata } from 'next';
import Link from 'next/link';
import { Empty, PageHead, StatusBadge } from '@/components/ui';
import { all, get } from '@/lib/db';
import { canCreateTransfer, isStore } from '@/lib/permissions';
import { LEDGER_LABELS } from '@/lib/services/stock';
import { requireUser } from '@/lib/session';
import type { LedgerType, SessionUser, TransferStatus } from '@/lib/types';
import { fmtDateTime, fmtNum } from '@/lib/util';

export const metadata: Metadata = { title: 'Dashboard' };

interface TransferSummary {
  id: number;
  number: string;
  status: TransferStatus;
  dispatched_at: string | null;
  source_name: string;
  dest_name: string;
  line_count: number;
  units: number;
}

interface Activity {
  id: number;
  ts: string;
  type: LedgerType;
  qty_change: number;
  qty_after: number;
  item_name: string;
  item_size: string;
  location_name: string;
  user_name: string;
}

const TRANSFER_SUMMARY_SQL = `
  SELECT t.id, t.number, t.status, t.dispatched_at,
         s.name AS source_name, d.name AS dest_name,
         (SELECT COUNT(*) FROM transfer_items ti WHERE ti.transfer_id = t.id) AS line_count,
         (SELECT COALESCE(SUM(qty_sent), 0) FROM transfer_items ti WHERE ti.transfer_id = t.id) AS units
  FROM transfers t
  JOIN locations s ON s.id = t.source_id
  JOIN locations d ON d.id = t.dest_id`;

function recentActivity(locationId: number | null, limit: number): Activity[] {
  const sql = `
    SELECT g.id, g.ts, g.type, g.qty_change, g.qty_after,
           i.name AS item_name, i.size AS item_size, l.name AS location_name, u.name AS user_name
    FROM stock_ledger g
    JOIN items i ON i.id = g.item_id
    JOIN locations l ON l.id = g.location_id
    JOIN users u ON u.id = g.user_id
    ${locationId ? 'WHERE g.location_id = ?' : ''}
    ORDER BY g.id DESC LIMIT ?`;
  return locationId ? all<Activity>(sql, locationId, limit) : all<Activity>(sql, limit);
}

/* ---------- shared pieces ---------- */

function Tile({ label, value, note, href }: { label: string; value: string; note?: string; href?: string }) {
  const body = (
    <>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {note && <div className="tile-note">{note}</div>}
    </>
  );
  return href ? <Link href={href} className="tile tile-link">{body}</Link> : <div className="tile">{body}</div>;
}

function TransferList({ transfers, empty, action }: { transfers: TransferSummary[]; empty: string; action?: string }) {
  if (!transfers.length) return <Empty>{empty}</Empty>;
  return (
    <ul className="row-list">
      {transfers.map((t) => (
        <li key={t.id}>
          <Link href={`/transfers/${t.id}`} className="row-link">
            <div>
              <div className="row-title">{t.number} <StatusBadge status={t.status} /></div>
              <div className="muted">{t.source_name} → {t.dest_name} · {t.line_count} item(s), {fmtNum(t.units)} unit(s)</div>
              <div className="muted">Dispatched {fmtDateTime(t.dispatched_at)}</div>
            </div>
            {action && <span className="btn btn-primary btn-sm">{action}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ActivityList({ rows, showLocation }: { rows: Activity[]; showLocation: boolean }) {
  if (!rows.length) return <Empty>No stock movements yet.</Empty>;
  return (
    <ul className="row-list">
      {rows.map((a) => (
        <li key={a.id} className="activity">
          <div>
            <div className="row-title">{a.item_name} <span className="muted">· {a.item_size}</span></div>
            <div className="muted">
              {LEDGER_LABELS[a.type]}{showLocation ? ` at ${a.location_name}` : ''} · {a.user_name} · {fmtDateTime(a.ts)}
            </div>
          </div>
          <div className="activity-qty">
            <strong>{a.qty_change > 0 ? '+' : '−'}{fmtNum(Math.abs(a.qty_change))}</strong>
            <span className="muted">now {fmtNum(a.qty_after)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ---------- Store Admin ---------- */

function StoreDashboard({ user }: { user: SessionUser }) {
  const locationId = user.location_id!;
  const summary = get<{ items_in_stock: number; units: number }>(
    `SELECT COUNT(CASE WHEN qty > 0 THEN 1 END) AS items_in_stock, COALESCE(SUM(qty), 0) AS units
     FROM stock WHERE location_id = ?`, locationId)!;
  const incoming = all<TransferSummary>(`${TRANSFER_SUMMARY_SQL} WHERE t.status = 'dispatched' AND t.dest_id = ? ORDER BY t.dispatched_at`, locationId);
  const outgoing = all<TransferSummary>(`${TRANSFER_SUMMARY_SQL} WHERE t.status = 'dispatched' AND t.source_id = ? ORDER BY t.dispatched_at`, locationId);
  const sum = (list: TransferSummary[]) => list.reduce((n, t) => n + t.units, 0);

  return (
    <>
      <PageHead title={user.location_name ?? 'My store'} sub="Your store's stock and transfers at a glance.">
        <Link href="/transfers/new" className="btn btn-primary">New transfer</Link>
      </PageHead>
      <div className="tiles">
        <Tile label="Items in stock" value={fmtNum(summary.items_in_stock)} href="/stock?view=instock" />
        <Tile label="Total stock" value={fmtNum(summary.units)} note="units on hand" href="/stock" />
        <Tile label="Pending your approval" value={fmtNum(incoming.length)} note={`${fmtNum(sum(incoming))} unit(s) on the way`} href="/transfers?view=incoming&status=dispatched" />
        <Tile label="Outgoing in transit" value={fmtNum(outgoing.length)} note={`${fmtNum(sum(outgoing))} unit(s) sent, not yet received`} href="/transfers?view=outgoing&status=dispatched" />
      </div>
      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>Pending your approval</h2><Link href="/transfers?view=incoming">View all</Link></div>
          <TransferList transfers={incoming} empty="Nothing is waiting for your approval." action="Check & approve" />
        </section>
        <section className="card">
          <div className="card-head"><h2>Outgoing in transit</h2><Link href="/transfers?view=outgoing">View all</Link></div>
          <TransferList transfers={outgoing} empty="Nothing you sent is in transit." />
        </section>
        <section className="card span-all">
          <div className="card-head"><h2>Recent activity</h2><Link href="/stock/ledger">Stock ledger</Link></div>
          <ActivityList rows={recentActivity(locationId, 8)} showLocation={false} />
        </section>
      </div>
    </>
  );
}

/* ---------- Warehouse Admin and Super Admin ---------- */

interface LocationStock {
  id: number;
  name: string;
  code: string;
  type: string;
  units: number;
  items_in_stock: number;
}

function AdminDashboard({ user }: { user: SessionUser }) {
  const totalItems = get<{ n: number }>('SELECT COUNT(*) AS n FROM items WHERE active = 1')!.n;
  const totalStock = get<{ n: number }>('SELECT COALESCE(SUM(qty), 0) AS n FROM stock')!.n;
  const byLocation = all<LocationStock>(
    `SELECT l.id, l.name, l.code, l.type,
            COALESCE(SUM(s.qty), 0) AS units,
            COUNT(CASE WHEN s.qty > 0 THEN 1 END) AS items_in_stock
     FROM locations l LEFT JOIN stock s ON s.location_id = l.id
     GROUP BY l.id
     HAVING l.active = 1 OR units > 0
     ORDER BY (l.type = 'warehouse') DESC, units DESC, l.name`);
  const pending = all<TransferSummary>(`${TRANSFER_SUMMARY_SQL} WHERE t.status = 'dispatched' ORDER BY t.dispatched_at`);
  const maxUnits = Math.max(1, ...byLocation.map((l) => l.units));
  const inTransitUnits = pending.reduce((n, t) => n + t.units, 0);

  return (
    <>
      <PageHead title="Dashboard" sub="Stock and transfers across the warehouse and all stores.">
        {canCreateTransfer(user) && <Link href="/transfers/new" className="btn btn-primary">New transfer</Link>}
      </PageHead>
      <div className="tiles">
        <Tile label="Total items" value={fmtNum(totalItems)} note="active in the item list" href="/items" />
        <Tile label="Total stock" value={fmtNum(totalStock)} note="units across all locations" href="/stock/matrix" />
        <Tile label="Transfers in transit" value={fmtNum(pending.length)} note={`${fmtNum(inTransitUnits)} unit(s) on the way`} href="/transfers?view=all&status=dispatched" />
      </div>
      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>Stock by location</h2><Link href="/stock/matrix">Stock matrix</Link></div>
          {totalStock === 0 ? <Empty>No stock has been recorded yet.</Empty> : (
            <ul className="bar-list" aria-label="Units in stock by location">
              {byLocation.map((l) => (
                <li key={l.id}>
                  <Link href={`/stock?location=${l.id}`} className="bar-row" title={`${l.name}: ${fmtNum(l.units)} units, ${l.items_in_stock} item(s) in stock`}>
                    <span className="bar-label">{l.name}</span>
                    <span className="bar-track"><span className="bar-fill" style={{ width: `${(l.units / maxUnits) * 100}%` }} /></span>
                    <span className="bar-value">{fmtNum(l.units)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <div className="card-head"><h2>Pending approval</h2><Link href="/transfers?view=all&status=dispatched">View all</Link></div>
          <TransferList transfers={pending.slice(0, 6)} empty="No transfers are waiting for approval." />
        </section>
        <section className="card span-all">
          <div className="card-head"><h2>Recent activity</h2><Link href="/stock/ledger">Stock ledger</Link></div>
          <ActivityList rows={recentActivity(null, 8)} showLocation />
        </section>
      </div>
    </>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();
  return isStore(user) ? <StoreDashboard user={user} /> : <AdminDashboard user={user} />;
}
