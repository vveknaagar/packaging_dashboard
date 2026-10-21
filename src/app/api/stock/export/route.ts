import { all, get } from '@/lib/db';
import { canViewLocation, isStore } from '@/lib/permissions';
import { getUser } from '@/lib/session';
import { stockFilter, type StockView } from '@/lib/stock-queries';
import type { LocationRow } from '@/lib/types';
import { MAX_EXPORT_ROWS, xlsxResponse } from '@/lib/xlsx';
import { parseId } from '@/lib/util';

/** One location's stock, with the same filters as the Stock screen, as an Excel file. */
export async function GET(request: Request) {
  const user = await getUser();
  if (!user) return new Response('Not signed in', { status: 401 });
  const search = new URL(request.url).searchParams;

  // A Store Admin is always pinned to their own store; no location means the warehouse.
  const chosen = isStore(user) ? user.location_id! : parseId(search.get('location'));
  const location = await get<LocationRow>(
    "SELECT * FROM locations WHERE id = COALESCE(?::integer, (SELECT id FROM locations WHERE type = 'warehouse'))", chosen);
  if (!location || !canViewLocation(user, location.id)) return new Response('Not allowed', { status: 403 });

  const isWarehouse = location.type === 'warehouse';
  const v = search.get('view');
  const view: StockView = v === 'instock' || (v === 'low' && isWarehouse) ? v : 'all';
  const { from, params } = stockFilter(location.id, isWarehouse, (search.get('q') ?? '').trim(), view);
  const rows = await all<{ name: string; size: string; unit: string; qty: number; min_stock: number; active: number }>(
    `SELECT i.name, i.size, i.unit, COALESCE(s.qty, 0) AS qty, i.min_stock, i.active
     ${from} ORDER BY i.name, i.size LIMIT ?`, ...params, MAX_EXPORT_ROWS);

  const headers = ['Item', 'Size', 'Unit', 'In stock', ...(isWarehouse ? ['Min stock', 'Running low'] : []), 'Status'];
  const lines = rows.map((r) => [
    r.name, r.size, r.unit, r.qty,
    ...(isWarehouse ? [r.min_stock || null, r.min_stock > 0 && r.qty <= r.min_stock ? 'Yes' : ''] : []),
    r.active ? 'Active' : 'Inactive',
  ]);
  return xlsxResponse(`stock-${slug(location.name)}`, 'Stock', headers, lines);
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'location';
