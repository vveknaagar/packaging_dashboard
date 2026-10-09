import type { Metadata } from 'next';
import { changePasswordAction } from '@/app/actions/auth';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { PageHead } from '@/components/ui';
import { get } from '@/lib/db';
import { ROLE_LABELS } from '@/lib/permissions';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'My account' };

export default async function AccountPage() {
  const user = await requireUser();
  const phone = (await get<{ phone: string }>('SELECT phone FROM users WHERE id = ?', user.id))?.phone;
  return (
    <>
      <PageHead title="My account" />
      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>Profile</h2></div>
          <dl className="details">
            <dt>Name</dt><dd>{user.name}</dd>
            <dt>Username</dt><dd>{user.username}</dd>
            <dt>Phone</dt><dd>{phone || '—'}</dd>
            <dt>Role</dt><dd>{ROLE_LABELS[user.role]}</dd>
            <dt>Location</dt><dd>{user.location_name ?? 'All locations'}</dd>
          </dl>
          <p className="hint">To change your name, phone, role or location, ask the Super Admin.</p>
        </section>
        <section className="card">
          <div className="card-head"><h2>Change password</h2></div>
          <ActionForm action={changePasswordAction} className="stack">
            <label className="field">
              <span>Current password</span>
              <input name="current" type="password" required autoComplete="current-password" />
            </label>
            <label className="field">
              <span>New password</span>
              <input name="password" type="password" required maxLength={72} autoComplete="new-password" />
              <span className="hint">Other devices will be signed out.</span>
            </label>
            <label className="field">
              <span>Confirm new password</span>
              <input name="confirm" type="password" required maxLength={72} autoComplete="new-password" />
            </label>
            <div className="form-actions">
              <SubmitButton pendingLabel="Saving…">Change password</SubmitButton>
            </div>
          </ActionForm>
        </section>
      </div>
    </>
  );
}
