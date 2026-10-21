import type { LedgerType } from './types';
import { likePattern } from './util';

/**
 * The filters behind the Stock, Stock ledger and Stock matrix screens, shared with
 * their Excel downloads so a download always holds what the screen shows.
 */

export type StockView = 'all' | 'instock' | 'low';

/** One location's items. "low" only applies at the warehouse, where minimum stock is kept. */
export function stockFilter(locationId: number, isWarehouse: boolean, q: string, view: StockView) {
  const where = ['(i.active = 1 OR COALESCE(s.qty, 0) > 0)'];
  const params: (string | number)[] = [locationId];
  if (q) {
    where.push("(i.name LIKE ? ESCAPE '\\' OR i.size LIKE ? ESCAPE '\\')");
    params.push(likePattern(q), likePattern(q));
  }
  if (view === 'instock') where.push('COALESCE(s.qty, 0) > 0');
  if (view === 'low' && isWarehouse) where.push('i.active = 1 AND i.min_stock > 0 AND COALESCE(s.qty, 0) <= i.min_stock');
  const from = `FROM items i LEFT JOIN stock s ON s.item_id = i.id AND s.location_id = ? WHERE ${where.join(' AND ')}`;
  return { from, params };
}

export function ledgerFilter(locationId: number | null, type: LedgerType | '', q: string) {
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
  return { from, params };
}

export function matrixFilter(q: string) {
  const where = ['(i.active = 1 OR EXISTS (SELECT 1 FROM stock s WHERE s.item_id = i.id AND s.qty > 0))'];
  const params: (string | number)[] = [];
  if (q) {
    where.push("(i.name LIKE ? ESCAPE '\\' OR i.size LIKE ? ESCAPE '\\')");
    params.push(likePattern(q), likePattern(q));
  }
  return { whereSql: `WHERE ${where.join(' AND ')}`, params };
}

/** Locations shown as matrix columns: active ones, and inactive ones still holding stock. */
export const MATRIX_LOCATIONS_SQL = `
  SELECT l.* FROM locations l
  WHERE l.active = 1 OR EXISTS (SELECT 1 FROM stock s WHERE s.location_id = l.id AND s.qty > 0)
  ORDER BY (l.type = 'warehouse') DESC, l.name`;
