import type { Role, SessionUser, TransferStatus } from './types';

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  warehouse_admin: 'Warehouse Admin',
  store_admin: 'Store Admin',
};

type Who = Pick<SessionUser, 'role' | 'location_id'>;
type Actor = Pick<SessionUser, 'role' | 'switched_from'>;
type TransferRoute = { source_id: number; dest_id: number; status: TransferStatus };

export const isSuper = (u: Who) => u.role === 'super_admin';
export const isWarehouse = (u: Who) => u.role === 'warehouse_admin';
export const isStore = (u: Who) => u.role === 'store_admin';

/** Super Admin and Warehouse Admin can see every location; a Store Admin only their own store. */
export function canViewLocation(user: Who, locationId: number): boolean {
  if (isSuper(user) || isWarehouse(user)) return true;
  return user.location_id === locationId;
}

/** Stock is edited by the admin of that exact location, or by the Super Admin anywhere. */
export function canEditStock(user: Who, locationId: number): boolean {
  return isSuper(user) || user.location_id === locationId;
}

/** Who may act for the sending and the receiving side of a transfer. The Super Admin may act for both. */
export const isSourceUser = (user: Who, t: TransferRoute) => isSuper(user) || user.location_id === t.source_id;
export const isDestUser = (user: Who, t: TransferRoute) => isSuper(user) || user.location_id === t.dest_id;

export function canViewTransfer(user: Who, t: TransferRoute): boolean {
  if (isSuper(user) || isWarehouse(user)) return true;
  if (user.location_id === t.source_id) return true;
  // The destination only learns about a transfer once it has been dispatched.
  return user.location_id === t.dest_id && !BEFORE_DISPATCH.has(t.status);
}

/** A transfer in one of these has not left its source: the destination does not see it yet. */
const BEFORE_DISPATCH = new Set<TransferStatus>(['draft', 'awaiting_approval', 'approved', 'declined']);

/** A Warehouse Admin approves the transfers stores send, before they are dispatched. So may the Super Admin. */
export const canApproveTransfers = (user: Who) => isSuper(user) || isWarehouse(user);

/** Only the Super Admin can use the app as another user. It stays possible while they are doing so. */
export const canSwitchUsers = (u: Actor) => !!u.switched_from || u.role === 'super_admin';

/** Added to records the Super Admin makes while using someone else's account, so history shows who really did it. */
export const onBehalfNote = (u: Pick<SessionUser, 'switched_from'>) =>
  u.switched_from ? `(done by Super Admin ${u.switched_from.name})` : '';

/** A Warehouse or Store Admin sends from their own location; the Super Admin chooses where to send from. */
export const canCreateTransfer = (user: Who) => isSuper(user) || user.location_id !== null;
