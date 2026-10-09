import type { Metadata } from 'next';
import { ItemForm } from '@/components/ItemForm';
import { Forbidden, PageHead } from '@/components/ui';
import { all } from '@/lib/db';
import { isSuper } from '@/lib/permissions';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Add item' };

export default async function NewItemPage() {
  const user = await requireUser();
  if (!isSuper(user)) return <Forbidden />;
  // Units already in use are offered as suggestions.
  const units = (await all<{ v: string }>("SELECT DISTINCT unit AS v FROM items WHERE unit <> '' ORDER BY v")).map((r) => r.v);
  return (
    <>
      <PageHead title="Add item" sub="Every item needs an image, a name and a size." />
      <ItemForm units={units} />
    </>
  );
}
