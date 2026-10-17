import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Forbidden, PageHead } from '@/components/ui';
import { UserForm } from '@/components/UserForm';
import { all, get } from '@/lib/db';
import { isSuper } from '@/lib/permissions';
import { requireUser } from '@/lib/session';
import type { Access, Role } from '@/lib/types';
import { parseId } from '@/lib/util';

export const metadata: Metadata = { title: 'Edit user' };

interface EditableUser {
  id: number;
  name: string;
  username: string;
  phone: string;
  role: Role;
  access: Access;
  location_id: number | null;
  active: number;
}

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!isSuper(user)) return <Forbidden />;
  const id = parseId((await params).id);
  // The password hash is deliberately not selected: it must never reach the browser.
  const target = id ? await get<EditableUser>('SELECT id, name, username, phone, role, access, location_id, active FROM users WHERE id = ?', id) : undefined;
  if (!target) notFound();

  const stores = await all<{ id: number; name: string; code: string; active: number }>(
    "SELECT id, name, code, active FROM locations WHERE type = 'store' ORDER BY active DESC, name");

  return (
    <>
      <PageHead title="Edit user" sub={target.username} />
      <UserForm stores={stores} user={target} isSelf={target.id === user.id} />
    </>
  );
}
