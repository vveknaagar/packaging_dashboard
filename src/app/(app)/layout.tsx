import { Shell, type NavItem } from '@/components/Shell';
import { all, get } from '@/lib/db';
import { canSwitchUsers, ROLE_LABELS } from '@/lib/permissions';
import { pendingApprovals } from '@/lib/services/transfers';
import { requireUser } from '@/lib/session';
import type { Role } from '@/lib/types';

const NAV: Record<Role, NavItem[]> = {
  super_admin: [
    { href: '/', label: 'Dashboard' },
    { href: '/items', label: 'Items', section: 'Inventory' },
    { href: '/stock', label: 'Stock', section: 'Inventory' },
    { href: '/stock/matrix', label: 'Stock matrix', section: 'Inventory' },
    { href: '/stock/ledger', label: 'Stock ledger', section: 'Inventory' },
    { href: '/pricing', label: 'Price & HSN', section: 'Inventory' },
    { href: '/transfers', label: 'Transfers', section: 'Transfers' },
    { href: '/transfers/new', label: 'New transfer', section: 'Transfers' },
    { href: '/locations', label: 'Locations', section: 'Setup' },
    { href: '/users', label: 'Users', section: 'Setup' },
  ],
  warehouse_admin: [
    { href: '/', label: 'Dashboard' },
    { href: '/stock', label: 'Stock', section: 'Inventory' },
    { href: '/stock/matrix', label: 'Stock matrix', section: 'Inventory' },
    { href: '/stock/ledger', label: 'Stock ledger', section: 'Inventory' },
    { href: '/items', label: 'Items', section: 'Inventory' },
    { href: '/transfers', label: 'Transfers', section: 'Transfers' },
    { href: '/transfers/new', label: 'New transfer', section: 'Transfers' },
    { href: '/locations', label: 'Locations', section: 'Setup' },
  ],
  store_admin: [
    { href: '/', label: 'Dashboard' },
    { href: '/stock', label: 'Stock', section: 'Inventory' },
    { href: '/stock/ledger', label: 'Stock ledger', section: 'Inventory' },
    { href: '/items', label: 'Items', section: 'Inventory' },
    { href: '/transfers', label: 'Transfers', section: 'Transfers' },
    { href: '/transfers/new', label: 'New transfer', section: 'Transfers' },
  ],
};

/** Everything inside this layout requires a signed-in user. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Independent lookups go to the database together rather than one after another.
  const [unreadRow, switchable, pending] = await Promise.all([
    get<{ n: number }>('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', user.id),
    canSwitchUsers(user) ? all<{ id: number; name: string; role: Role; location_name: string | null }>(
      `SELECT u.id, u.name, u.role, l.name AS location_name
       FROM users u LEFT JOIN locations l ON l.id = u.location_id
       WHERE u.active = 1
       ORDER BY CASE u.role WHEN 'super_admin' THEN 0 WHEN 'warehouse_admin' THEN 1 ELSE 2 END, u.name`) : null,
    pendingApprovals(user),
  ]);
  const unread = unreadRow!.n;

  return (
    <Shell
      nav={NAV[user.role]}
      userName={user.name}
      roleLabel={ROLE_LABELS[user.role]}
      locationName={user.location_name}
      unread={unread}
      pending={pending.length}
      switcher={switchable ? {
        users: switchable.map((u) => ({ id: u.id, label: `${u.name} · ${u.location_name ?? ROLE_LABELS[u.role]}` })),
        currentId: user.id,
        ownerName: user.switched_from?.name ?? null,
      } : undefined}
    >
      {children}
    </Shell>
  );
}
