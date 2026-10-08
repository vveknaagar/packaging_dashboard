import type { Metadata } from 'next';
import { LocationForm } from '@/components/LocationForm';
import { Forbidden, PageHead } from '@/components/ui';
import { isSuper } from '@/lib/permissions';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Add store' };

export default async function NewLocationPage() {
  const user = await requireUser();
  if (!isSuper(user)) return <Forbidden />;
  return (
    <>
      <PageHead title="Add store" sub="There is exactly one warehouse, so every new location is a store." />
      <LocationForm />
    </>
  );
}
