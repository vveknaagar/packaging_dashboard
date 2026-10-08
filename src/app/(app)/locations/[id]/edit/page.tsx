import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LocationForm } from '@/components/LocationForm';
import { Forbidden, PageHead } from '@/components/ui';
import { get } from '@/lib/db';
import { isSuper } from '@/lib/permissions';
import { requireUser } from '@/lib/session';
import type { LocationRow } from '@/lib/types';
import { parseId } from '@/lib/util';

export const metadata: Metadata = { title: 'Edit location' };

export default async function EditLocationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!isSuper(user)) return <Forbidden />;
  const id = parseId((await params).id);
  const location = id ? get<LocationRow>('SELECT * FROM locations WHERE id = ?', id) : undefined;
  if (!location) notFound();
  return (
    <>
      <PageHead title={`Edit ${location.type === 'warehouse' ? 'warehouse' : 'store'}`} sub={location.name} />
      <LocationForm location={location} />
    </>
  );
}
