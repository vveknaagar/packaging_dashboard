import type { TransferFormItem } from '@/components/TransferForm';
import { all } from './db';

/**
 * Where a location can send to: the warehouse sends to every active store; a store
 * sends to the other active stores or back to the warehouse (listed first).
 */
export function destinationsFor(sourceId: number) {
  return all<{ id: number; name: string; code: string }>(
    `SELECT id, name, code FROM locations
     WHERE active = 1 AND id <> ?
       AND (type = 'store' OR (SELECT type FROM locations WHERE id = ?) = 'store')
     ORDER BY (type = 'warehouse') DESC, name`,
    sourceId, sourceId);
}

/**
 * Every active item with the stock this location has of it. Items with no
 * stock are listed too, so the sender can see what they hold of everything.
 */
export function transferableItems(sourceId: number): Promise<TransferFormItem[]> {
  return all<TransferFormItem>(
    `SELECT i.id, i.name, i.size, i.unit, i.thumb, COALESCE(s.qty, 0) AS available
     FROM items i LEFT JOIN stock s ON s.item_id = i.id AND s.location_id = ?
     WHERE i.active = 1
     ORDER BY i.name, i.size`,
    sourceId);
}
