'use client';

import Link from 'next/link';
import { useState } from 'react';
import { saveUserAction } from '@/app/actions/admin';
import type { Role } from '@/lib/types';
import { ActionForm, SubmitButton } from './ActionForm';
import { NameInput } from './NameInput';

interface Props {
  stores: { id: number; name: string; code: string; active: number }[];
  /** Present when editing. */
  user?: { id: number; name: string; username: string; phone: string; role: Role; location_id: number | null; active: number };
  /** Editing your own account: role and status are locked. */
  isSelf?: boolean;
  /** A new user starts with no role chosen unless the link that opened the form asked for one. */
  defaultRole?: Role;
  defaultStoreId?: number;
}

const ROLES: { value: Role; label: string; help: string }[] = [
  { value: 'store_admin', label: 'Store Admin', help: 'Edits stock of one store, receives transfers and sends stock to other stores.' },
  { value: 'warehouse_admin', label: 'Warehouse Admin', help: 'Edits warehouse stock, creates transfers and views all stores read-only.' },
  { value: 'super_admin', label: 'Super Admin', help: 'Creates stores and users, manages items and views everything.' },
];

export function UserForm({ stores, user, isSelf, defaultRole, defaultStoreId }: Props) {
  const [role, setRole] = useState<Role | ''>(user?.role ?? defaultRole ?? '');
  const help = ROLES.find((r) => r.value === role)?.help;

  return (
    <ActionForm action={saveUserAction} className="card stack">
      {user && <input type="hidden" name="id" value={user.id} />}
      <div className="form-grid">
        <label className="field">
          <span>Full name</span>
          <NameInput name="name" required maxLength={80} defaultValue={user?.name} autoComplete="off" />
        </label>
        <label className="field">
          <span>Username</span>
          {user
            ? <input type="text" value={user.username} readOnly disabled />
            : <input name="username" type="text" required minLength={3} maxLength={40} pattern="[A-Za-z0-9._\-]+" autoComplete="off" autoCapitalize="none" />}
        </label>
        <label className="field">
          <span>Phone number</span>
          <input name="phone" type="tel" inputMode="tel" maxLength={30} defaultValue={user?.phone} autoComplete="off" />
          <span className="hint">Shown as the contact number of this person&apos;s store or warehouse.</span>
        </label>
        <label className="field">
          <span>Role</span>
          <select name="role" required value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={isSelf}>
            <option value="" disabled>Select a role…</option>
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          {isSelf && <input type="hidden" name="role" value={role} />}
          {help && <span className="hint">{help}</span>}
        </label>
        {role === 'store_admin' && (
          <label className="field">
            <span>Store</span>
            <select name="location_id" required defaultValue={user?.location_id ?? defaultStoreId ?? ''}>
              <option value="" disabled>Select a store…</option>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code}){s.active ? '' : ' (inactive)'}</option>)}
            </select>
            {stores.length === 0 && <span className="hint">No stores yet. Add a store first.</span>}
          </label>
        )}
        <label className="field">
          <span>{user ? 'New password (leave empty to keep the current one)' : 'Password'}</span>
          <input name="password" type="password" required={!user} maxLength={72} autoComplete="new-password" />
          <span className="hint">Stored only as a hash.</span>
        </label>
        {user && (
          <label className="field">
            <span>Status</span>
            <select name="active" defaultValue={user.active ? '1' : '0'} disabled={isSelf}>
              <option value="1">Active</option>
              <option value="0">Inactive (cannot sign in)</option>
            </select>
            {isSelf && <input type="hidden" name="active" value="1" />}
          </label>
        )}
      </div>
      <div className="form-actions">
        <Link href="/users" className="btn btn-ghost">Cancel</Link>
        <SubmitButton pendingLabel="Saving…">{user ? 'Save changes' : 'Create user'}</SubmitButton>
      </div>
    </ActionForm>
  );
}
