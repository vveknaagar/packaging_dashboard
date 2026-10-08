import type { Metadata } from 'next';
import Form from 'next/form';
import Link from 'next/link';
import { savePricingAction } from '@/app/actions/items';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Empty, Forbidden, ItemCell, PageHead, Pager } from '@/components/ui';
import { all, get } from '@/lib/db';
import { isSuper } from '@/lib/permissions';
import { requireUser } from '@/lib/session';
import type { ItemRow } from '@/lib/types';
import { likePattern, paginate, param, priceInput } from '@/lib/util';

export const metadata: Metadata = { title: 'Price & HSN' };

const PAGE_SIZE = 50;

/**
 * The Super Admin's price list. Prices and HSN codes are seen and changed only
 * here; each dispatched transfer copies them onto its slip.
 */
export default async function PricingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (!isSuper(user)) return <Forbidden />;
  const sp = await searchParams;
  const q = param(sp.q).trim();
  const missing = param(sp.missing) === '1';

  const where = ['i.active = 1'];
  const params: string[] = [];
  if (q) {
    where.push("(i.name LIKE ? ESCAPE '\\' OR i.size LIKE ? ESCAPE '\\' OR i.hsn LIKE ? ESCAPE '\\')");
    params.push(likePattern(q), likePattern(q), likePattern(q));
  }
  if (missing) where.push("(i.hsn = '' OR i.price_paise IS NULL)");
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const total = get<{ n: number }>(`SELECT COUNT(*) AS n FROM items i ${whereSql}`, ...params)!.n;
  const incomplete = get<{ n: number }>("SELECT COUNT(*) AS n FROM items WHERE active = 1 AND (hsn = '' OR price_paise IS NULL)")!.n;
  const pager = paginate(total, param(sp.page), PAGE_SIZE);
  const items = all<ItemRow>(
    `SELECT i.* FROM items i ${whereSql}
     ORDER BY i.name COLLATE NOCASE, i.size COLLATE NOCASE LIMIT ? OFFSET ?`,
    ...params, pager.pageSize, pager.offset);
  const filtered = !!q || missing;

  return (
    <>
      <PageHead
        title="Price & HSN"
        sub={incomplete
          ? `Only you can see this page. ${incomplete} active item(s) still need a price or HSN code.`
          : 'Only you can see this page. Every active item has a price and HSN code.'}
      />

      <Form action="/pricing" className="toolbar card">
        <input type="search" name="q" defaultValue={q} placeholder="Search name, size or HSN" aria-label="Search items" />
        <select name="missing" defaultValue={missing ? '1' : ''} aria-label="Show">
          <option value="">All active items</option>
          <option value="1">Missing price or HSN</option>
        </select>
        <button type="submit" className="btn">Filter</button>
        {filtered && <Link href="/pricing" className="btn btn-ghost">Clear</Link>}
      </Form>

      <ActionForm action={savePricingAction} className="card stack">
        {items.length === 0 ? (
          <Empty>{filtered ? 'No items match these filters.' : 'No active items yet.'}</Empty>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table cards">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>HSN code</th>
                    <th>Price per unit (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    // Keyed on the saved values so a fresh page load shows what was stored.
                    <tr key={`${item.id}-${item.hsn}-${item.price_paise}`}>
                      <td className="cell-main">
                        <ItemCell name={item.name} size={item.size} thumb={item.thumb} image={item.image} />
                      </td>
                      <td data-label="HSN code">
                        <input
                          name={`hsn_${item.id}`} type="text" inputMode="numeric" maxLength={8} pattern="[0-9]{4}([0-9]{2}){0,2}"
                          defaultValue={item.hsn} placeholder="e.g. 4819" className="price-input"
                          aria-label={`HSN code for ${item.name} ${item.size}`} title="4, 6 or 8 digits"
                        />
                      </td>
                      <td data-label={`Price per ${item.unit || 'unit'} (₹)`}>
                        <input
                          name={`price_${item.id}`} type="text" inputMode="decimal" maxLength={13} pattern="[0-9]+(\.[0-9]{1,2})?"
                          defaultValue={priceInput(item.price_paise)} placeholder="0.00" className="price-input"
                          aria-label={`Price for ${item.name} ${item.size}`} title="Rupees, for example 12.50"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="form-actions">
              <span className="muted">Changes apply to transfers dispatched from now on. Slips already dispatched keep their price.</span>
              <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
            </div>
          </>
        )}
        <Pager pager={pager} path="/pricing" query={{ q, missing: missing ? '1' : '' }} noun="item(s)" />
      </ActionForm>
    </>
  );
}
