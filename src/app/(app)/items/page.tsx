import type { Metadata } from 'next';
import Form from 'next/form';
import Link from 'next/link';
import { setItemStatusAction } from '@/app/actions/items';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { ActiveBadge, Empty, ItemCell, PageHead, Pager } from '@/components/ui';
import { all, get, warehouseId } from '@/lib/db';
import { isStore, isSuper } from '@/lib/permissions';
import { requireUser } from '@/lib/session';
import type { ItemRow, LocationRow } from '@/lib/types';
import { fmtNum, likePattern, paginate, param, parseId } from '@/lib/util';

export const metadata: Metadata = { title: 'Items' };

const PAGE_SIZE = 50;

interface ItemListRow extends ItemRow {
  qty: number;
}

export default async function ItemsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const q = param(sp.q).trim();
  const status = ['active', 'inactive', 'all'].includes(param(sp.status)) ? param(sp.status) : 'active';
  const canManage = isSuper(user);
  const store = isStore(user);

  // Whose stock the Stock column shows. A Store Admin always sees their own
  // store. The Warehouse Admin starts on the warehouse and the Super Admin on
  // the total; both can switch to any location.
  const locations = store ? [] : await all<LocationRow>(
    "SELECT * FROM locations ORDER BY (type = 'warehouse') DESC, active DESC, name");
  const requested = param(sp.location);
  const requestedId = parseId(requested);
  let locationId: number | null; // null means the total across all locations
  if (store) locationId = user.location_id;
  else if (requested === 'all') locationId = null;
  else if (requestedId && locations.some((l) => l.id === requestedId)) locationId = requestedId;
  else locationId = isSuper(user) ? null : await warehouseId();
  const locationName = locationId === null
    ? 'All locations'
    : store ? user.location_name ?? 'My store' : locations.find((l) => l.id === locationId)!.name;

  const where: string[] = [];
  const params: (string | number)[] = [];
  if (q) {
    where.push("(i.name LIKE ? ESCAPE '\\' OR i.size LIKE ? ESCAPE '\\')");
    params.push(likePattern(q), likePattern(q));
  }
  if (status !== 'all') { where.push('i.active = ?'); params.push(status === 'active' ? 1 : 0); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = (await get<{ n: number }>(`SELECT COUNT(*) AS n FROM items i ${whereSql}`, ...params))!.n;
  const pager = paginate(total, param(sp.page), PAGE_SIZE);
  const qtySql = locationId === null
    ? '(SELECT COALESCE(SUM(s.qty), 0) FROM stock s WHERE s.item_id = i.id)'
    : '(SELECT COALESCE(SUM(s.qty), 0) FROM stock s WHERE s.item_id = i.id AND s.location_id = ?)';
  const items = await all<ItemListRow>(
    `SELECT i.*, ${qtySql} AS qty FROM items i ${whereSql}
     ORDER BY i.name, i.size LIMIT ? OFFSET ?`,
    ...(locationId === null ? [] : [locationId]), ...params, pager.pageSize, pager.offset);

  const filtered = !!q || status !== 'active';
  // Kept in links so paging and clearing filters do not lose the chosen location.
  const locationQuery = store ? undefined : locationId === null ? 'all' : locationId;

  return (
    <>
      <PageHead title="Items" sub={`The packaging item list. Stock shown for: ${locationName}.`}>
        {canManage && (
          <>
            <Link href="/items/bulk" className="btn">Bulk upload</Link>
            <Link href="/items/new" className="btn btn-primary">Add item</Link>
          </>
        )}
      </PageHead>

      <Form action="/items" className="toolbar card">
        <input type="search" name="q" defaultValue={q} placeholder="Search name or size" aria-label="Search items" />
        {!store && (
          <select name="location" defaultValue={locationId === null ? 'all' : locationId} aria-label="Show stock for">
            <option value="all">Stock: all locations (total)</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>Stock: {l.name}{l.active ? '' : ' (inactive)'}</option>
            ))}
          </select>
        )}
        <select name="status" defaultValue={status} aria-label="Status">
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
        <button type="submit" className="btn">Filter</button>
        {filtered && <Link href={`/items${locationQuery ? `?location=${locationQuery}` : ''}`} className="btn btn-ghost">Clear</Link>}
      </Form>

      <div className="card">
        {items.length === 0 ? (
          <Empty>
            {filtered ? 'No items match these filters.' : canManage ? 'No items yet. Add the first item or use Bulk upload.' : 'No items have been added yet.'}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table cards">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Unit</th>
                  <th>Status</th>
                  <th className="num">
                    Stock
                    <div className="th-sub">{locationName}</div>
                  </th>
                  {canManage && <th><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className={item.active ? undefined : 'inactive'}>
                    <td className="cell-main"><ItemCell name={item.name} size={item.size} thumb={item.thumb} image={item.image} /></td>
                    <td data-label="Unit">{item.unit || <span className="muted">—</span>}</td>
                    <td data-label="Status"><ActiveBadge active={item.active} /></td>
                    <td data-label={`Stock (${locationName})`} className="num"><strong>{fmtNum(item.qty)}</strong></td>
                    {canManage && (
                      <td className="cell-actions">
                        <Link href={`/items/${item.id}/edit`} className="btn btn-sm">Edit</Link>
                        <ActionForm
                          action={setItemStatusAction}
                          className="inline-form" toastErrors
                          confirm={item.active
                            ? `Deactivate ${item.name} (${item.size})? It stays in history but can no longer be added to stock or transfers.`
                            : undefined}
                        >
                          <input type="hidden" name="id" value={item.id} />
                          <input type="hidden" name="active" value={item.active ? '0' : '1'} />
                          <SubmitButton className="btn btn-sm btn-ghost">{item.active ? 'Deactivate' : 'Activate'}</SubmitButton>
                        </ActionForm>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager pager={pager} path="/items" query={{ q, location: locationQuery, status: status === 'active' ? '' : status }} noun="item(s)" />
      </div>
    </>
  );
}
