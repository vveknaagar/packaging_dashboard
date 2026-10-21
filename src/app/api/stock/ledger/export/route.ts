import { all } from '@/lib/db';
import { isStore } from '@/lib/permissions';
import { LEDGER_LABELS } from '@/lib/services/stock';
import { getUser } from '@/lib/session';
import { ledgerFilter } from '@/lib/stock-queries';
import type { LedgerType } from '@/lib/types';
import { fmtDateTime, parseId } from '@/lib/util';
import { MAX_EXPORT_ROWS, xlsxResponse } from '@/lib/xlsx';

/** The Stock ledger, with the same filters as the screen, as an Excel file. */
export async function GET(request: Request) {
  const user = await getUser();
  if (!user) return new Response('Not signed in', { status: 401 });
  const search = new URL(request.url).searchParams;

  // A Store Admin only ever gets their own store's entries.
  const locationId = isStore(user) ? user.location_id : parseId(search.get('location'));
  const t = search.get('type') ?? '';
  const type = t in LEDGER_LABELS ? (t as LedgerType) : '';
  const { from, params } = ledgerFilter(locationId, type, (search.get('q') ?? '').trim());
  const rows = await all<{
    ts: string; type: LedgerType; qty_change: number; qty_before: number; qty_after: number; reason: string;
    transfer_number: string | null; item_name: string; item_size: string; location_name: string; user_name: string;
  }>(
    `SELECT g.ts, g.type, g.qty_change, g.qty_before, g.qty_after, g.reason,
            t.number AS transfer_number, i.name AS item_name, i.size AS item_size,
            l.name AS location_name, u.name AS user_name
     ${from} ORDER BY g.id DESC LIMIT ?`, ...params, MAX_EXPORT_ROWS);

  const headers = ['When', 'Item', 'Size', 'Location', 'Type', 'Change', 'Before', 'After', 'Reason', 'Transfer', 'By'];
  const lines = rows.map((r) => [
    fmtDateTime(r.ts), r.item_name, r.item_size, r.location_name, LEDGER_LABELS[r.type],
    r.qty_change, r.qty_before, r.qty_after, r.reason, r.transfer_number ?? '', r.user_name,
  ]);
  return xlsxResponse('stock-ledger', 'Ledger', headers, lines);
}
