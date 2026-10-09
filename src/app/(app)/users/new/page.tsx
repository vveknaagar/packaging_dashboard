import type { Metadata } from 'next';
import { Forbidden, PageHead } from '@/components/ui';
import { UserForm } from '@/components/UserForm';
import { all } from '@/lib/db';
import { isSuper } from '@/lib/permissions';
import { requireUser } from '@/lib/session';
import type { Role } from '@/lib/types';
import { param, parseId } from '@/lib/util';

export const metadata: Metadata = { title: 'Add user' };

export default async function NewUserPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (!isSuper(user)) return <Forbidden />;
  const sp = await searchParams;
  const stores = await all<{ id: number; name: string; code: string; active: number }>(
    "SELECT id, name, code, active FROM locations WHERE type = 'store' ORDER BY active DESC, name");
  // Links such as "Add one" on the Locations screen arrive with the role or the store already chosen.
  const role = param(sp.role);
  const storeId = parseId(param(sp.store)) ?? undefined;
  const defaultRole: Role | undefined = role === 'warehouse_admin' || role === 'super_admin' || role === 'store_admin'
    ? role : storeId ? 'store_admin' : undefined;

  return (
    <>
      <PageHead title="Add user" sub="The role decides what this person can see and change." />
      <UserForm stores={stores} defaultRole={defaultRole} defaultStoreId={storeId} />
    </>
  );
}
