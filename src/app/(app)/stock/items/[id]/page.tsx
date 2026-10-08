import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Empty, PageHead, StatusBadge, Thumb } from '@/components/ui';
import { all, get, warehouseId } from '@/lib/db';
import { isStore } from '@/lib/permissions';
import { getQty, inTransit } from '@/lib/services/stock';
import { itemTransfers } from '@/lib/services/transfers';
import { requireUser } from '@/lib/session';
import type { ItemRow } from '@/lib/types';
import { fmtDateTime, fmtNum, parseId } from '@/lib/util';

export const metadata: Metadata = { title: 'Item stock' };

export default async function ItemStockPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = parseId((await params).id);
  const item = id ? get<ItemRow>('SELECT * FROM items WHERE id = ?', id) : undefined;
  if (!item) notFound();

  // A Store Admin sees the item at their own store; everyone else sees the warehouse.
  const store = isStore(user);
  const locationId = store ? user.location_id! : warehouseId();
  const qty = getQty(item.id, locationId);
  const onTheWay = inTransit(locationId, 'outgoing').get(item.id) ?? 0;
  const arriving = inTransit(locationId, 'incoming').get(item.id) ?? 0;
  const transfers = itemTransfers(user, item.id);
  const last = transfers.at(0);

  // Where every unit of this item is right now. A Store Admin only sees their own store, above.
  const byLocation = store ? [] : all<{ id: number; name: string; type: string; qty: number }>(
    `SELECT l.id, l.name, l.type, COALESCE(s.qty, 0) AS qty
     FROM locations l LEFT JOIN stock s ON s.location_id = l.id AND s.item_id = ?
     WHERE l.active = 1 OR COALESCE(s.qty, 0) > 0
     ORDER BY (l.type = 'warehouse') DESC, l.name COLLATE NOCASE`, item.id);
  const inTransitAll = store ? 0 : get<{ n: number }>(
    `SELECT COALESCE(SUM(ti.qty_sent), 0) AS n
     FROM transfer_items ti JOIN transfers t ON t.id = ti.transfer_id
     WHERE t.status = 'dispatched' AND ti.item_id = ?`, item.id)!.n;
  const everywhere = byLocation.reduce((n, l) => n + l.qty, 0) + inTransitAll;

  return (
    <>
      <PageHead
        title={item.name}
        sub={<>{item.size}{item.unit ? ` · ${item.unit}` : ''}{!item.active && ' · Inactive item'}</>}
      >
        <Link href="/stock" className="btn">Back to stock</Link>
      </PageHead>

      <div className="tiles tiles-stack">
        <div className="tile item-tile">
          <Thumb src={item.thumb} href={item.image} alt={item.name} size={64} />
          <div>
            <div className="tile-label">{store ? `Stock at ${user.location_name ?? 'your store'}` : 'Warehouse stock'}</div>
            <div className="tile-value">{fmtNum(qty)}</div>
            <div className="tile-note">
              {item.unit || 'units'} on hand
              {onTheWay ? ` · ${fmtNum(onTheWay)} in transit out` : ''}
              {arriving ? ` · ${fmtNum(arriving)} on the way in` : ''}
            </div>
          </div>
        </div>
        {last ? (
          <Link href={`/transfers/${last.id}`} className="tile tile-link">
            <div className="tile-label">Last transfer · {last.number}</div>
            <div className="tile-value">{fmtNum(last.qty_sent)} <span className="tile-unit">{item.unit}</span></div>
            <div className="tile-note">{last.source_name} → <strong>{last.dest_name}</strong></div>
            <div className="tile-note">{fmtDateTime(last.dispatched_at)} · <StatusBadge status={last.status} /></div>
          </Link>
        ) : (
          <div className="tile">
            <div className="tile-label">Last transfer</div>
            <div className="tile-value">—</div>
            <div className="tile-note">{store ? 'No transfers of this item to or from your store yet.' : 'This item has not been transferred yet.'}</div>
          </div>
        )}
      </div>

      {!store && (
        <section className="card">
          <div className="card-head">
            <h2>Stock at every location</h2>
            <Link href="/stock/matrix">Stock matrix</Link>
          </div>
          <ul className="row-list">
            {byLocation.map((l) => (
              <li key={l.id}>
                <Link href={`/stock?location=${l.id}`} className="row-link">
                  <span>{l.name}{l.type === 'warehouse' ? ' (warehouse)' : ''}</span>
                  <span><strong>{fmtNum(l.qty)}</strong> <span className="muted">{item.unit}</span></span>
                </Link>
              </li>
            ))}
            {inTransitAll > 0 && (
              <li>
                <div className="row-link">
                  <span>In transit (sent, not yet received)</span>
                  <span><strong>{fmtNum(inTransitAll)}</strong> <span className="muted">{item.unit}</span></span>
                </div>
              </li>
            )}
            <li>
              <div className="row-link">
                <span className="row-title">Total</span>
                <span><strong>{fmtNum(everywhere)}</strong> <span className="muted">{item.unit}</span></span>
              </div>
            </li>
          </ul>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2>Recent transfers of this item</h2>
          <Link href={`/stock/ledger?q=${encodeURIComponent(item.name)}`}>Stock ledger</Link>
        </div>
        {transfers.length === 0 ? <Empty>No transfers yet.</Empty> : (
          <div className="table-wrap">
            <table className="table cards cards-wide">
              <thead>
                <tr>
                  <th>Transfer</th>
                  <th>From</th>
                  <th>To</th>
                  <th className="num">Qty sent</th>
                  <th className="num">Qty received</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((t) => (
                  <tr key={t.id}>
                    <td className="cell-main">
                      <Link href={`/transfers/${t.id}`} className="item-name nowrap">{t.number}</Link>
                      <div className="item-size">{fmtDateTime(t.dispatched_at)}</div>
                    </td>
                    <td data-label="From">{t.source_name}</td>
                    <td data-label="To">{t.dest_name}</td>
                    <td data-label="Qty sent" className="num"><strong>{fmtNum(t.qty_sent)}</strong> <span className="muted">{item.unit}</span></td>
                    <td data-label="Qty received" className="num">{t.qty_received === null ? <span className="muted">—</span> : fmtNum(t.qty_received)}</td>
                    <td data-label="Status"><StatusBadge status={t.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
