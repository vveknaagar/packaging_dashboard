import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ItemForm } from '@/components/ItemForm';
import { Forbidden, PageHead } from '@/components/ui';
import { all, get } from '@/lib/db';
import { isSuper } from '@/lib/permissions';
import { requireUser } from '@/lib/session';
import type { ItemRow } from '@/lib/types';
import { parseId } from '@/lib/util';

export const metadata: Metadata = { title: 'Edit item' };

export default async function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!isSuper(user)) return <Forbidden />;
  const id = parseId((await params).id);
  const item = id ? get<ItemRow>('SELECT * FROM items WHERE id = ?', id) : undefined;
  if (!item) notFound();

  const units = all<{ v: string }>("SELECT DISTINCT unit AS v FROM items WHERE unit <> '' ORDER BY v COLLATE NOCASE").map((r) => r.v);

  return (
    <>
      <PageHead title="Edit item" sub={`${item.name} · ${item.size}`} />
      <ItemForm item={item} units={units} />
    </>
  );
}
