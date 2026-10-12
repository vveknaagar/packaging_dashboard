import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SaleForm, type SaleFormItem } from '@/components/SaleForm';
import { Forbidden, PageHead } from '@/components/ui';
import { all, get } from '@/lib/db';
import { canEditStock, isStore } from '@/lib/permissions';
import { requireUser } from '@/lib/session';
import type { LocationRow } from '@/lib/types';
import { param, parseId } from '@/lib/util';

export const metadata: Metadata = { title: 'Mark sold' };

/** A store marks the items it sold, which takes them off its stock. */
export default async function SellPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  // A Store Admin always sells from their own store, whatever the URL says.
  const locationId = isStore(user) ? user.location_id : parseId(param((await searchParams).location));
  if (!locationId) notFound();
  const location = await get<LocationRow>('SELECT * FROM locations WHERE id = ?', locationId);
  if (!location || location.type !== 'store') notFound();
  if (!canEditStock(user, location.id) || !location.active) return <Forbidden />;

  const items = await all<SaleFormItem>(
    `SELECT i.id, i.name, i.size, i.unit, i.thumb, s.qty AS available
     FROM stock s JOIN items i ON i.id = s.item_id
     WHERE s.location_id = ? AND s.qty > 0
     ORDER BY i.name, i.size`, location.id);

  return (
    <>
      <PageHead title={`Mark sold · ${location.name}`} sub="Record what the store sold. The quantities come off its stock and show as Sold in the stock ledger." />
      <SaleForm locationId={location.id} storeName={location.name} items={items} />
    </>
  );
}
