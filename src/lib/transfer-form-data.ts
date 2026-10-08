import type { TransferFormItem } from '@/components/TransferForm';
import { all } from './db';

/** Active stores a location can send to (every active store except itself). */
export function destinationsFor(sourceId: number) {
  return all<{ id: number; name: string; code: string }>(
    "SELECT id, name, code FROM locations WHERE type = 'store' AND active = 1 AND id <> ? ORDER BY name COLLATE NOCASE",
    sourceId);
}

/**
 * Every active item with the stock this location has of it. Items with no
 * stock are listed too, so the sender can see what they hold of everything.
 */
export function transferableItems(sourceId: number): TransferFormItem[] {
  return all<TransferFormItem>(
    `SELECT i.id, i.name, i.size, i.unit, i.thumb, COALESCE(s.qty, 0) AS available
     FROM items i LEFT JOIN stock s ON s.item_id = i.id AND s.location_id = ?
     WHERE i.active = 1
     ORDER BY i.name COLLATE NOCASE, i.size COLLATE NOCASE`,
    sourceId);
}
