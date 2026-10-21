export type Role = 'super_admin' | 'warehouse_admin' | 'store_admin';
/** Edit can change what the role allows; View sees the same screens read-only. The Super Admin always has Edit. */
export type Access = 'edit' | 'view';
export type LocationType = 'warehouse' | 'store';
export type TransferStatus = 'draft' | 'awaiting_approval' | 'approved' | 'declined' | 'dispatched' | 'completed' | 'discrepancy' | 'rejected' | 'cancelled';
export type LedgerType = 'stock_in' | 'stock_out' | 'sale' | 'adjustment' | 'transfer_out' | 'transfer_in' | 'transfer_return';

/** The signed-in user, as loaded fresh from the database on every request. */
export interface SessionUser {
  id: number;
  name: string;
  username: string;
  role: Role;
  access: Access;
  location_id: number | null;
  location_name: string | null;
  location_type: LocationType | null;
  /** Present while a Super Admin is using the app as this user: the Super Admin's own account. */
  switched_from?: { id: number; name: string };
}

export interface LocationRow {
  id: number;
  type: LocationType;
  name: string;
  code: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  gstin: string;
  active: number;
  created_at: string;
}

export interface ItemRow {
  id: number;
  name: string;
  size: string;
  unit: string;
  image: string;
  thumb: string;
  hsn: string;
  /** Price per unit in paise. Null until the Super Admin sets one. */
  price_paise: number | null;
  /** Warehouse stock at or below this is Running low. 0 means no alert. */
  min_stock: number;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface UserRow {
  id: number;
  name: string;
  username: string;
  password_hash: string;
  role: Role;
  access: Access;
  location_id: number | null;
  phone: string;
  active: number;
  created_at: string;
}

export interface TransferRow {
  id: number;
  number: string;
  source_id: number;
  dest_id: number;
  status: TransferStatus;
  note: string;
  transport_mode: string;
  transport_ref: string;
  /** The courier or transport company it is sent with, chosen from the Super Admin's list. Optional. */
  logistics_partner_id: number | null;
  created_by: number;
  created_at: string;
  /** The Warehouse Admin (or Super Admin) who approved a transfer sent by a store. */
  approved_by: number | null;
  approved_at: string | null;
  dispatched_by: number | null;
  dispatched_at: string | null;
  received_by: number | null;
  received_at: string | null;
  receive_remark: string;
  closed_by: number | null;
  closed_at: string | null;
  closed_reason: string;
  /** Photo of the packed parcel, required at dispatch. Empty on older transfers. */
  parcel_image: string;
  parcel_thumb: string;
  /** The amount and quantity printed on the delivery challan, set by the sender when the challan is made. */
  challan_amount_paise: number | null;
  challan_qty: number | null;
}

export interface TransferDetail extends TransferRow {
  source_name: string;
  source_code: string;
  source_type: string;
  source_address: string;
  source_gstin: string;
  /** Name and phone of the source location's first active admin. */
  source_contact: string | null;
  source_phone: string | null;
  dest_name: string;
  dest_code: string;
  dest_type: string;
  dest_address: string;
  dest_city: string;
  dest_state: string;
  dest_pincode: string;
  dest_gstin: string;
  dest_contact: string | null;
  dest_phone: string | null;
  created_by_name: string;
  approved_by_name: string | null;
  dispatched_by_name: string | null;
  received_by_name: string | null;
  closed_by_name: string | null;
  partner_name: string | null;
  partner_phone: string | null;
}

export interface LogisticsPartnerRow {
  id: number;
  name: string;
  contact: string;
  phone: string;
  active: number;
  created_at: string;
}

export interface TransferLine {
  id: number;
  item_id: number;
  qty_sent: number;
  qty_received: number | null;
  /** HSN and price per unit (paise) copied from the item at dispatch. Null on drafts and older transfers. */
  hsn: string | null;
  rate_paise: number | null;
  name: string;
  size: string;
  unit: string;
  thumb: string;
  image: string;
}

export interface TransferEvent {
  id: number;
  transfer_id: number;
  user_id: number;
  ts: string;
  event: string;
  detail: string;
  user_name: string;
}

/** What a server action sends back to the form that called it. */
export interface ActionResult {
  error?: string;
  ok?: string;
}
