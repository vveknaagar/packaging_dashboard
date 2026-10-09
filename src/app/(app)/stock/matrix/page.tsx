import type { Metadata } from 'next';
import Form from 'next/form';
import Link from 'next/link';
import { Empty, Forbidden, PageHead, Pager, Thumb } from '@/components/ui';
import { all, get } from '@/lib/db';
import { isStore } from '@/lib/permissions';
import { requireUser } from '@/lib/session';
import type { LocationRow } from '@/lib/types';
import { fmtNum, likePattern, paginate, param } from '@/lib/util';

export const metadata: Metadata = { title: 'Stock matrix' };

const PAGE_SIZE = 100;

interface MatrixItem {
  id: number;
  name: string;
  size: string;
  unit: string;
  thumb: string;
  active: number;
  total: number;
}

/** Items down the side, locations across the top. Warehouse Admin and Super Admin only. */
export default async function StockMatrixPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (isStore(user)) return <Forbidden />;
  const sp = await searchParams;
  const q = param(sp.q).trim();

  const where = ['(i.active = 1 OR EXISTS (SELECT 1 FROM stock s WHERE s.item_id = i.id AND s.qty > 0))'];
  const params: (string | number)[] = [];
  if (q) {
    where.push("(i.name LIKE ? ESCAPE '\\' OR i.size LIKE ? ESCAPE '\\')");
    params.push(likePattern(q), likePattern(q));
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  // Independent lookups go to the database together rather than one after another.
  const [locations, totalRow] = await Promise.all([
    all<LocationRow>(
      `SELECT l.* FROM locations l
       WHERE l.active = 1 OR EXISTS (SELECT 1 FROM stock s WHERE s.location_id = l.id AND s.qty > 0)
       ORDER BY (l.type = 'warehouse') DESC, l.name`),
    get<{ n: number }>(`SELECT COUNT(*) AS n FROM items i ${whereSql}`, ...params),
  ]);
  const pager = paginate(totalRow!.n, param(sp.page), PAGE_SIZE);
  const items = await all<MatrixItem>(
    `SELECT i.id, i.name, i.size, i.unit, i.thumb, i.active,
            (SELECT COALESCE(SUM(qty), 0) FROM stock s WHERE s.item_id = i.id) AS total
     FROM items i ${whereSql}
     ORDER BY i.name, i.size LIMIT ? OFFSET ?`,
    ...params, pager.pageSize, pager.offset);

  // One lookup for every cell on this page: "itemId:locationId" -> quantity.
  const cells = new Map<string, number>();
  if (items.length) {
    const ids = items.map((i) => i.id);
    const rows = await all<{ item_id: number; location_id: number; qty: number }>(
      `SELECT item_id, location_id, qty FROM stock WHERE item_id IN (${ids.map(() => '?').join(',')})`, ...ids);
    for (const row of rows) cells.set(`${row.item_id}:${row.location_id}`, row.qty);
  }

  return (
    <>
      <PageHead title="Stock matrix" sub="Every item against every location.">
        <Link href="/stock" className="btn">Stock by location</Link>
      </PageHead>

      <Form action="/stock/matrix" className="toolbar card">
        <input type="search" name="q" defaultValue={q} placeholder="Search name or size" aria-label="Search items" />
        <button type="submit" className="btn">Search</button>
        {q && <Link href="/stock/matrix" className="btn btn-ghost">Clear</Link>}
      </Form>

      <div className="card">
        {items.length === 0 ? <Empty>{q ? 'No items match.' : 'No items have been added yet.'}</Empty> : (
          <div className="table-wrap matrix-wrap">
            <table className="table matrix">
              <thead>
                <tr>
                  <th className="sticky-col">Item</th>
                  <th className="num">Total</th>
                  {locations.map((l) => (
                    <th key={l.id} className="num">
                      <Link href={`/stock?location=${l.id}`}>{l.name}</Link>
                      <div className="th-sub">{l.type === 'warehouse' ? 'Warehouse' : l.code}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className={item.active ? undefined : 'inactive'}>
                    <td className="sticky-col">
                      <div className="item-cell">
                        <Thumb src={item.thumb} size={36} />
                        <div>
                          <div className="item-name">{item.name}</div>
                          <div className="item-size">{item.size}</div>
                        </div>
                      </div>
                    </td>
                    <td className="num"><strong>{fmtNum(item.total)}</strong></td>
                    {locations.map((l) => {
                      const key = `${item.id}:${l.id}`;
                      return (
                        <td key={l.id} className="num">
                          {cells.has(key) || l.type === 'warehouse' ? fmtNum(cells.get(key) ?? 0) : <span className="muted">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager pager={pager} path="/stock/matrix" query={{ q }} noun="item(s)" />
      </div>
    </>
  );
}
