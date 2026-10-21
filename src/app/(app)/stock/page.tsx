import type { Metadata } from 'next';
import Form from 'next/form';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AdjustStockButton } from '@/components/AdjustStockButton';
import { Empty, PageHead, Pager } from '@/components/ui';
import { all, get, warehouseId } from '@/lib/db';
import { canEditStock, canViewLocation, isStore } from '@/lib/permissions';
import { inTransit } from '@/lib/services/stock';
import { requireUser } from '@/lib/session';
import type { LocationRow } from '@/lib/types';
import { stockFilter, type StockView } from '@/lib/stock-queries';
import { fmtNum, paginate, param, parseId } from '@/lib/util';

export const metadata: Metadata = { title: 'Stock' };

const PAGE_SIZE = 50;

interface StockRow {
  id: number;
  name: string;
  size: string;
  unit: string;
  thumb: string;
  image: string;
  active: number;
  qty: number;
  min_stock: number;
}

export default async function StockPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;

  // A Store Admin is always pinned to their own store, whatever the URL says.
  // No location chosen means the warehouse, found in the same query.
  const chosen = isStore(user) ? user.location_id! : parseId(param(sp.location));
  const location = await get<LocationRow>(
    "SELECT * FROM locations WHERE id = COALESCE(?::integer, (SELECT id FROM locations WHERE type = 'warehouse'))", chosen);
  if (!location || !canViewLocation(user, location.id)) notFound();

  const canEdit = canEditStock(user, location.id) && !!location.active;
  const q = param(sp.q).trim();
  // Minimum stock is kept for the warehouse, so only there can items be Running low.
  const isWarehouse = location.type === 'warehouse';
  const v = param(sp.view);
  const view: StockView = v === 'instock' || (v === 'low' && isWarehouse) ? v : 'all';
  const { from, params } = stockFilter(location.id, isWarehouse, q, view);

  // Independent lookups go to the database together rather than one after another.
  const [totalRow, totalsRow, outgoing, locations] = await Promise.all([
    get<{ n: number }>(`SELECT COUNT(*) AS n ${from}`, ...params),
    get<{ items: number; units: number }>(
      'SELECT COUNT(CASE WHEN qty > 0 THEN 1 END) AS items, COALESCE(SUM(qty), 0) AS units FROM stock WHERE location_id = ?', location.id),
    inTransit(location.id, 'outgoing'),
    isStore(user) ? [] : all<LocationRow>("SELECT * FROM locations ORDER BY (type = 'warehouse') DESC, active DESC, name"),
  ]);
  const totals = totalsRow!;
  const pager = paginate(totalRow!.n, param(sp.page), PAGE_SIZE);
  const rows = await all<StockRow>(
    `SELECT i.id, i.name, i.size, i.unit, i.thumb, i.image, i.active, COALESCE(s.qty, 0) AS qty, i.min_stock
     ${from} ORDER BY i.name, i.size LIMIT ? OFFSET ?`,
    ...params, pager.pageSize, pager.offset);
  const filtered = !!q || view !== 'all';
  const locationQuery = isStore(user) ? undefined : location.id;

  return (
    <>
      <PageHead
        title={`Stock · ${location.name}`}
        sub={<>
          {fmtNum(totals.items)} item(s) in stock, {fmtNum(totals.units)} unit(s) on hand.
          {!canEdit && ' View only.'}
          {!location.active && ' This location is inactive.'}
        </>}
      >
        {canEdit && location.type === 'store' && <Link href={`/stock/sell?location=${location.id}`} className="btn btn-primary">Mark sold</Link>}
        <Link href={`/stock/ledger${locationQuery ? `?location=${locationQuery}` : ''}`} className="btn">Stock ledger</Link>
        {!isStore(user) && <Link href="/stock/matrix" className="btn">Stock matrix</Link>}
        <a href={`/api/stock/export?${new URLSearchParams({ ...(locationQuery ? { location: String(locationQuery) } : {}), q, view: view === 'all' ? '' : view })}`} className="btn" download>Download Excel</a>
      </PageHead>

      <Form action="/stock" className="toolbar card">
        {!isStore(user) && (
          <select name="location" defaultValue={location.id} aria-label="Location">
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}{l.type === 'warehouse' ? ' (warehouse)' : ''}{l.active ? '' : ' (inactive)'}</option>
            ))}
          </select>
        )}
        <input type="search" name="q" defaultValue={q} placeholder="Search name or size" aria-label="Search items" />
        <select name="view" defaultValue={view} aria-label="Show">
          <option value="all">All items</option>
          <option value="instock">In stock only</option>
          {isWarehouse && <option value="low">Running low</option>}
        </select>
        <button type="submit" className="btn">Apply</button>
        {filtered && <Link href={`/stock${locationQuery ? `?location=${locationQuery}` : ''}`} className="btn btn-ghost">Clear</Link>}
      </Form>

      <div className="card">
        {rows.length === 0 ? (
          <Empty>{view === 'low' && !q ? 'Nothing is running low. Set a Min stock for items on the Price & HSN screen.' : filtered ? 'No items match these filters.' : 'No items have been added yet.'}</Empty>
        ) : (
          <ul className="item-grid">
            {rows.map((r) => (
              <li key={r.id} className={r.active ? 'item-tab' : 'item-tab inactive'}>
                <Link href={`/stock/items/${r.id}`} className="item-tab-link">
                  {r.image
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img className="item-tab-img" src={`/uploads/${r.image}`} alt="" width={240} height={240} loading="lazy" />
                    : <span className="item-tab-img thumb-missing" title="No picture yet" aria-hidden="true" />}
                  <span className="item-name">{r.name}</span>
                  <span className="item-size">{r.size}</span>
                </Link>
                <div className="item-tab-stock">
                  <strong>{fmtNum(r.qty)}</strong> <span className="muted">{r.unit} in stock</span>
                  {outgoing.get(r.id) ? <div className="muted">{fmtNum(outgoing.get(r.id))} in transit out</div> : null}
                  {!r.active && <div><span className="badge badge-off">Inactive item</span></div>}
                  {isWarehouse && !!r.active && r.min_stock > 0 && r.qty <= r.min_stock && (
                    <div><span className="badge badge-low" title={`Minimum is ${r.min_stock}`}>Running low · min {fmtNum(r.min_stock)}</span></div>
                  )}
                </div>
                {canEdit && (
                  <AdjustStockButton
                    itemId={r.id} itemName={r.name} itemSize={r.size} unit={r.unit}
                    qty={r.qty} locationId={location.id} itemActive={!!r.active}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        <Pager pager={pager} path="/stock" query={{ location: locationQuery, q, view: view === 'all' ? '' : view }} noun="item(s)" />
      </div>
    </>
  );
}
