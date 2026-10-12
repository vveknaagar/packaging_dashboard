import Link from 'next/link';
import { saveLocationAction } from '@/app/actions/admin';
import type { LocationRow } from '@/lib/types';
import { ActionForm, SubmitButton } from './ActionForm';
import { NameInput } from './NameInput';

/**
 * Add a store (optionally with its Store Admin) or edit an existing location.
 * A location has no contact fields of its own: its contact person and phone
 * are taken from its admin.
 */
export function LocationForm({ location }: { location?: LocationRow }) {
  // A store needs its address and GSTIN; the warehouse may leave them blank.
  const isStore = location?.type !== 'warehouse';
  return (
    <ActionForm action={saveLocationAction} className="stack">
      {location && <input type="hidden" name="id" value={location.id} />}
      <div className="card stack">
        <div className="form-grid">
          <label className="field">
            <span>Name</span>
            <input name="name" type="text" required maxLength={80} defaultValue={location?.name} />
          </label>
          <label className="field">
            <span>Code</span>
            <input name="code" type="text" required maxLength={12} pattern="[A-Za-z0-9\-]+" defaultValue={location?.code} autoCapitalize="characters" />
            <span className="hint">A short unique code, e.g. SU for Surat. It starts this location&apos;s transfer numbers (SU2627-01).</span>
          </label>
          <label className="field">
            <span>GSTIN{isStore ? '' : ' (optional)'}</span>
            <input
              name="gstin" type="text" required={isStore} maxLength={15} minLength={15}
              pattern="[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z][1-9A-Za-z][Zz][0-9A-Za-z]"
              defaultValue={location?.gstin} autoCapitalize="characters" placeholder="24ABCDE1234F1Z5"
              title="15-character GSTIN, for example 24ABCDE1234F1Z5"
            />
            <span className="hint">Printed on delivery challans.</span>
          </label>
          <label className="field span-2">
            <span>Address{isStore ? '' : ' (optional)'}</span>
            <textarea name="address" rows={2} required={isStore} maxLength={300} defaultValue={location?.address} />
          </label>
        </div>
        <p className="hint">
          Contact person and phone are filled in automatically from the {location?.type === 'warehouse' ? 'Warehouse Admin' : 'Store Admin'}&apos;s details.
          {location && <> Change them from <Link href="/users">Users</Link>.</>}
        </p>
      </div>

      {!location && (
        <div className="card stack">
          <div className="card-head">
            <h2>Store Admin</h2>
            <span className="muted">Optional now. More admins can be added from Users.</span>
          </div>
          <div className="form-grid">
            <label className="field">
              <span>Full name</span>
              <NameInput name="admin_name" maxLength={80} autoComplete="off" />
            </label>
            <label className="field">
              <span>Phone number</span>
              <input name="admin_phone" type="tel" inputMode="tel" maxLength={30} autoComplete="off" />
            </label>
            <label className="field">
              <span>Username</span>
              <input name="admin_username" type="text" maxLength={40} autoComplete="off" autoCapitalize="none" />
            </label>
            <label className="field">
              <span>Password</span>
              <input name="admin_password" type="password" maxLength={72} autoComplete="new-password" />
            </label>
          </div>
        </div>
      )}

      <div className="form-actions">
        <Link href="/locations" className="btn btn-ghost">Cancel</Link>
        <SubmitButton pendingLabel="Saving…">{location ? 'Save changes' : 'Add store'}</SubmitButton>
      </div>
    </ActionForm>
  );
}
