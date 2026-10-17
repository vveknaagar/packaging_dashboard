import type { Metadata } from 'next';
import Link from 'next/link';
import { switchUserAction } from '@/app/actions/auth';
import { ActiveBadge, Forbidden, PageHead } from '@/components/ui';
import { all } from '@/lib/db';
import { ACCESS_LABELS, isSuper, ROLE_LABELS } from '@/lib/permissions';
import { requireUser } from '@/lib/session';
import type { Access, Role } from '@/lib/types';
import { fmtDate } from '@/lib/util';

export const metadata: Metadata = { title: 'Users' };

interface UserListRow {
  id: number;
  name: string;
  username: string;
  phone: string;
  role: Role;
  access: Access;
  active: number;
  created_at: string;
  location_name: string | null;
}

export default async function UsersPage() {
  const user = await requireUser();
  if (!isSuper(user)) return <Forbidden />;

  const users = await all<UserListRow>(
    `SELECT u.id, u.name, u.username, u.phone, u.role, u.access, u.active, u.created_at, l.name AS location_name
     FROM users u LEFT JOIN locations l ON l.id = u.location_id
     ORDER BY u.active DESC, CASE u.role WHEN 'super_admin' THEN 0 WHEN 'warehouse_admin' THEN 1 ELSE 2 END, u.name`);

  return (
    <>
      <PageHead title="Users" sub="Who can sign in, and what each person can do.">
        <Link href="/users/new" className="btn btn-primary">Add user</Link>
      </PageHead>
      <div className="card">
        <div className="table-wrap">
          <table className="table cards cards-wide">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Role</th>
                <th>Access</th>
                <th>Location</th>
                <th>Added</th>
                <th>Status</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={u.active ? undefined : 'inactive'}>
                  <td className="cell-main">
                    <div className="item-name">{u.name}{u.id === user.id ? ' (you)' : ''}</div>
                    <div className="item-size">{u.username}</div>
                  </td>
                  <td data-label="Phone">{u.phone || <span className="muted">—</span>}</td>
                  <td data-label="Role">{ROLE_LABELS[u.role]}</td>
                  <td data-label="Access">{u.role === 'super_admin' || u.access === 'edit' ? ACCESS_LABELS.edit : <span className="badge badge-off">{ACCESS_LABELS.view}</span>}</td>
                  <td data-label="Location">{u.location_name ?? <span className="muted">All locations</span>}</td>
                  <td data-label="Added">{fmtDate(u.created_at)}</td>
                  <td data-label="Status"><ActiveBadge active={u.active} /></td>
                  <td className="cell-actions">
                    {!!u.active && u.id !== user.id && (
                      <form action={switchUserAction} className="inline-form">
                        <input type="hidden" name="user_id" value={u.id} />
                        <button type="submit" className="btn btn-sm btn-ghost" title={`Use the app as ${u.name}`}>Switch to</button>
                      </form>
                    )}
                    <Link href={`/users/${u.id}/edit`} className="btn btn-sm">Edit</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
