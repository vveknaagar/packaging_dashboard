import { all } from '@/lib/db';
import { isStore } from '@/lib/permissions';
import { getUser } from '@/lib/session';
import { MATRIX_LOCATIONS_SQL, matrixFilter } from '@/lib/stock-queries';
import type { LocationRow } from '@/lib/types';
import { MAX_EXPORT_ROWS, xlsxResponse } from '@/lib/xlsx';

/** Every item against every location, as an Excel file. Warehouse Admin and Super Admin only. */
export async function GET(request: Request) {
  const user = await getUser();
  if (!user) return new Response('Not signed in', { status: 401 });
  if (isStore(user)) return new Response('Not allowed', { status: 403 });
  const { whereSql, params } = matrixFilter((new URL(request.url).searchParams.get('q') ?? '').trim());

  const [locations, items, cells] = await Promise.all([
    all<LocationRow>(MATRIX_LOCATIONS_SQL),
    all<{ id: number; name: string; size: string; unit: string; active: number }>(
      `SELECT i.id, i.name, i.size, i.unit, i.active FROM items i ${whereSql} ORDER BY i.name, i.size LIMIT ?`, ...params, MAX_EXPORT_ROWS),
    all<{ item_id: number; location_id: number; qty: number }>('SELECT item_id, location_id, qty FROM stock'),
  ]);
  const qty = new Map(cells.map((c) => [`${c.item_id}:${c.location_id}`, c.qty]));

  const headers = ['Item', 'Size', 'Unit', ...locations.map((l) => l.name), 'Total', 'Status'];
  const lines = items.map((i) => {
    const perLocation = locations.map((l) => qty.get(`${i.id}:${l.id}`) ?? 0);
    return [i.name, i.size, i.unit, ...perLocation, perLocation.reduce((a, b) => a + b, 0), i.active ? 'Active' : 'Inactive'];
  });
  return xlsxResponse('stock-matrix', 'Stock matrix', headers, lines);
}
