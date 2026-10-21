import type { Metadata } from 'next';
import Link from 'next/link';
import { Empty, PageHead, StatusBadge } from '@/components/ui';
import { all, get } from '@/lib/db';
import { canCreateTransfer, isStore, isSuper } from '@/lib/permissions';
import { LEDGER_LABELS, runningLow } from '@/lib/services/stock';
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

function recentActivity(locationId: number | null, limit: number): Promise<Activity[]> {
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

/** Whole rupees for the dashboard, e.g. 1234550 paise to "₹12,346". */
const rupees = (paise: number) => `₹${fmtNum(Math.round(paise / 100))}`;

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
              <div className="muted">{t.dispatched_at ? `Dispatched ${fmtDateTime(t.dispatched_at)}` : 'Not dispatched yet'}</div>
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

interface ItemValue {
  id: number;
  name: string;
  size: string;
  qty: number;
  value_paise: number | null;
}

/** One location's stock as an amount, item by item. Items without a price have a null value. */
function itemValues(locationId: number): Promise<ItemValue[]> {
  return all<ItemValue>(
    `SELECT i.id, i.name, i.size, s.qty, s.qty * i.price_paise AS value_paise
     FROM stock s JOIN items i ON i.id = s.item_id
     WHERE s.location_id = ? AND s.qty > 0
     ORDER BY value_paise DESC NULLS LAST, i.name`, locationId);
}

const SHOWN_ITEMS = 8;

/** "Stock value by item" for one location: the most valuable items, and what is left uncounted. */
function ItemValueCard({ rows, locationName, wide }: { rows: ItemValue[]; locationName: string; wide?: boolean }) {
  const total = rows.reduce((n, r) => n + (r.value_paise ?? 0), 0);
  const unpriced = rows.filter((r) => r.value_paise === null).reduce((n, r) => n + r.qty, 0);
  const shown = rows.filter((r) => r.value_paise).slice(0, SHOWN_ITEMS);
  const rest = rows.filter((r) => r.value_paise).length - shown.length;
  const max = Math.max(1, ...shown.map((r) => r.value_paise!));
  return (
    <section className={`card${wide ? ' span-all' : ''}`}>
      <div className="card-head"><h2>Stock value by item</h2><span className="muted">{rupees(total)} at {locationName}</span></div>
      {total === 0 ? <Empty>{rows.length ? 'Prices have not been set yet. Ask the Super Admin.' : 'No stock here yet.'}</Empty> : (
        <ul className="bar-list" aria-label={`Value of stock at ${locationName} by item`}>
          {shown.map((r) => (
            <li key={r.id}>
              <Link href={`/stock/items/${r.id}`} className="bar-row" title={`${r.name} (${r.size}): ${fmtNum(r.qty)} units, ${rupees(r.value_paise!)}`}>
                <span className="bar-label">{r.name} <span className="muted">· {r.size}</span></span>
                <span className="bar-track"><span className="bar-fill bar-fill-value" style={{ width: `${(r.value_paise! / max) * 100}%` }} /></span>
                <span className="bar-value">{rupees(r.value_paise!)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {rest > 0 && <p className="hint">and {rest} more item(s). <Link href="/stock">See all stock</Link></p>}
      {unpriced > 0 && total > 0 && <p className="hint">{fmtNum(unpriced)} unit(s) have no price yet and are not counted.</p>}
    </section>
  );
}

/* ---------- Store Admin ---------- */

async function StoreDashboard({ user }: { user: SessionUser }) {
  const locationId = user.location_id!;
  const [summaryRow, incoming, outgoing, awaiting, activity, values] = await Promise.all([
    get<{ items_in_stock: number; units: number }>(
      `SELECT COUNT(CASE WHEN qty > 0 THEN 1 END) AS items_in_stock, COALESCE(SUM(qty), 0) AS units
       FROM stock WHERE location_id = ?`, locationId),
    all<TransferSummary>(`${TRANSFER_SUMMARY_SQL} WHERE t.status = 'dispatched' AND t.dest_id = ? ORDER BY t.dispatched_at`, locationId),
    all<TransferSummary>(`${TRANSFER_SUMMARY_SQL} WHERE t.status = 'dispatched' AND t.source_id = ? ORDER BY t.dispatched_at`, locationId),
    all<TransferSummary>(`${TRANSFER_SUMMARY_SQL} WHERE t.status IN ('awaiting_approval', 'approved') AND t.source_id = ? ORDER BY t.id`, locationId),
    recentActivity(locationId, 8),
    itemValues(locationId),
  ]);
  const summary = summaryRow!;
  const value = values.reduce((n, r) => n + (r.value_paise ?? 0), 0);
  const sum = (list: TransferSummary[]) => list.reduce((n, t) => n + t.units, 0);

  return (
    <>
      <PageHead title={user.location_name ?? 'My store'} sub="Your store's stock and transfers at a glance.">
        <Link href="/transfers/new" className="btn btn-primary">New transfer</Link>
      </PageHead>
      <div className="tiles">
        <Tile label="Items in stock" value={fmtNum(summary.items_in_stock)} href="/stock?view=instock" />
        <Tile label="Total stock" value={fmtNum(summary.units)} note="units on hand" href="/stock" />
        <Tile label="Stock value" value={rupees(value)} note="of the stock in your store" href="/stock" />
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
        {awaiting.length > 0 && (
          <section className="card">
            <div className="card-head"><h2>Warehouse approval</h2><Link href="/transfers?view=outgoing">View all</Link></div>
            <TransferList transfers={awaiting} empty="" />
          </section>
        )}
        <ItemValueCard rows={values} locationName={user.location_name ?? 'your store'} />
        <section className="card">
          <div className="card-head"><h2>Recent activity</h2><Link href="/stock/ledger">Stock ledger</Link></div>
          <ActivityList rows={activity} showLocation={false} />
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
  /** Units on hand times each item's price. Items without a price count as nothing. */
  value_paise: number;
  /** Units on hand of items that have no price yet. */
  unpriced_units: number;
}

async function AdminDashboard({ user }: { user: SessionUser }) {
  // Independent lookups go to the database together rather than one after another.
  // The Super Admin sees stock value store by store; a Warehouse Admin, like a Store Admin, only for their own location.
  const storeWise = isSuper(user);
  const [totals, byLocation, pending, toApprove, activity, ownValues, low] = await Promise.all([
    get<{ items: number; units: number }>(
      'SELECT (SELECT COUNT(*) FROM items WHERE active = 1) AS items, (SELECT COALESCE(SUM(qty), 0) FROM stock) AS units'),
    all<LocationStock>(
      `SELECT l.id, l.name, l.code, l.type,
              COALESCE(SUM(s.qty), 0) AS units,
              COUNT(CASE WHEN s.qty > 0 THEN 1 END) AS items_in_stock,
              COALESCE(SUM(s.qty * i.price_paise), 0) AS value_paise,
              COALESCE(SUM(CASE WHEN i.price_paise IS NULL THEN s.qty END), 0) AS unpriced_units
       FROM locations l LEFT JOIN stock s ON s.location_id = l.id LEFT JOIN items i ON i.id = s.item_id
       GROUP BY l.id
       HAVING l.active = 1 OR COALESCE(SUM(s.qty), 0) > 0
       ORDER BY (l.type = 'warehouse') DESC, units DESC, l.name`),
    all<TransferSummary>(`${TRANSFER_SUMMARY_SQL} WHERE t.status = 'dispatched' ORDER BY t.dispatched_at`),
    all<TransferSummary>(`${TRANSFER_SUMMARY_SQL} WHERE t.status = 'awaiting_approval' ORDER BY t.id`),
    recentActivity(null, 8),
    !storeWise && user.location_id ? itemValues(user.location_id) : null,
    runningLow(),
  ]);
  const totalItems = totals!.items;
  const totalStock = totals!.units;
  const maxUnits = Math.max(1, ...byLocation.map((l) => l.units));
  const inTransitUnits = pending.reduce((n, t) => n + t.units, 0);
  const showValue = storeWise;
  const ownValue = ownValues?.reduce((n, r) => n + (r.value_paise ?? 0), 0) ?? 0;
  const byValue = [...byLocation].sort((a, b) => b.value_paise - a.value_paise);
  const totalValue = byLocation.reduce((n, l) => n + l.value_paise, 0);
  const storeValue = byLocation.filter((l) => l.type === 'store').reduce((n, l) => n + l.value_paise, 0);
  const maxValue = Math.max(1, ...byLocation.map((l) => l.value_paise));
  const unpriced = byLocation.reduce((n, l) => n + l.unpriced_units, 0);

  return (
    <>
      <PageHead title="Dashboard" sub="Stock and transfers across the warehouse and all stores.">
        {canCreateTransfer(user) && <Link href="/transfers/new" className="btn btn-primary">New transfer</Link>}
      </PageHead>
      <div className="tiles">
        <Tile label="Total items" value={fmtNum(totalItems)} note="active in the item list" href="/items" />
        <Tile label="Total stock" value={fmtNum(totalStock)} note="units across all locations" href="/stock/matrix" />
        {showValue && <Tile label="Stock value" value={rupees(totalValue)} note={`${rupees(storeValue)} of it in stores`} href="/pricing" />}
        {ownValues && <Tile label="Stock value" value={rupees(ownValue)} note={`of the stock at ${user.location_name}`} href="/stock" />}
        <Tile label="Running low" value={fmtNum(low.length)} note={low.length ? 'item(s) at or below minimum in the warehouse' : 'nothing below its minimum'} href="/stock?view=low" />
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
        {showValue && (
          <section className="card">
            <div className="card-head"><h2>Stock value by location</h2><Link href="/pricing">Price &amp; HSN</Link></div>
            {totalValue === 0 ? <Empty>{totalStock === 0 ? 'No stock has been recorded yet.' : 'Set item prices on the Price & HSN screen to see stock value.'}</Empty> : (
              <ul className="bar-list" aria-label="Value of stock by location">
                {byValue.map((l) => (
                  <li key={l.id}>
                    <Link
                      href={`/stock?location=${l.id}`} className="bar-row"
                      title={`${l.name}: ${rupees(l.value_paise)} for ${fmtNum(l.units)} units, ${Math.round((l.value_paise / totalValue) * 100)}% of all stock value`}
                    >
                      <span className="bar-label">{l.name}</span>
                      <span className="bar-track"><span className="bar-fill bar-fill-value" style={{ width: `${(l.value_paise / maxValue) * 100}%` }} /></span>
                      <span className="bar-value">{rupees(l.value_paise)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {unpriced > 0 && totalStock > 0 && (
              <p className="hint">
                {fmtNum(unpriced)} unit(s) have no price yet and are not counted. <Link href="/pricing?missing=1">Set prices</Link>
              </p>
            )}
          </section>
        )}
        {low.length > 0 && (
          <section className="card card-pending span-all">
            <div className="card-head"><h2>Running low in the warehouse</h2><Link href="/stock?view=low">View all</Link></div>
            <ul className="row-list">
              {low.slice(0, 8).map((r) => (
                <li key={r.id} className="activity">
                  <Link href={`/stock/items/${r.id}`} className="row-title">{r.name} <span className="muted">· {r.size}</span></Link>
                  <div className="activity-qty">
                    <strong className={r.qty === 0 ? 'text-crit' : undefined}>{fmtNum(r.qty)}</strong>
                    <span className="muted">min {fmtNum(r.min_stock)}{r.unit ? ` ${r.unit}` : ''}</span>
                  </div>
                </li>
              ))}
            </ul>
            {low.length > 8 && <p className="hint">and {low.length - 8} more item(s).</p>}
          </section>
        )}
        <section className={`card${toApprove.length ? ' card-pending' : ''}${showValue ? ' span-all' : ''}`}>
          <div className="card-head"><h2>Transfers to approve</h2><Link href="/transfers?view=all&status=awaiting_approval">View all</Link></div>
          <TransferList transfers={toApprove.slice(0, 6)} empty="No store transfers are waiting for your approval." action="Review" />
        </section>
        <section className={`card${showValue ? ' span-all' : ''}`}>
          <div className="card-head"><h2>Pending approval</h2><Link href="/transfers?view=all&status=dispatched">View all</Link></div>
          <TransferList transfers={pending.slice(0, 6)} empty="No transfers are waiting for approval." />
        </section>
        {ownValues && <ItemValueCard rows={ownValues} locationName={user.location_name ?? 'your location'} wide />}
        <section className="card span-all">
          <div className="card-head"><h2>Recent activity</h2><Link href="/stock/ledger">Stock ledger</Link></div>
          <ActivityList rows={activity} showLocation />
        </section>
      </div>
    </>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();
  return isStore(user) ? <StoreDashboard user={user} /> : <AdminDashboard user={user} />;
}
