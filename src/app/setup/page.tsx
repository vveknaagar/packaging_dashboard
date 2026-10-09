import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { setupAction } from '@/app/actions/auth';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { NameInput } from '@/components/NameInput';
import { hasAnyUser } from '@/lib/session';

export const metadata: Metadata = { title: 'First-time setup' };

/** Shown only while the system has no users: creates the Super Admin account. */
export default async function SetupPage() {
  await connection(); // the answer depends on live data, so never prerender this page
  if (await hasAnyUser()) redirect('/login');

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="brand brand-dark">
          <span className="brand-mark" aria-hidden="true">P</span>
          <span>Mayave<br /><small>Item Transfer</small></span>
        </div>
        <h1>First-time setup</h1>
        <p className="sub">Create the Super Admin account. This person adds stores, users and items.</p>
        <ActionForm action={setupAction} className="stack">
          <label className="field">
            <span>Your name</span>
            <NameInput name="name" required maxLength={80} autoFocus autoComplete="name" />
          </label>
          <label className="field">
            <span>Username</span>
            <input name="username" type="text" required minLength={3} maxLength={40} autoComplete="username" autoCapitalize="none" spellCheck={false} />
          </label>
          <label className="field">
            <span>Password</span>
            <input name="password" type="password" required maxLength={72} autoComplete="new-password" />
          </label>
          <label className="field">
            <span>Confirm password</span>
            <input name="confirm" type="password" required maxLength={72} autoComplete="new-password" />
          </label>
          <SubmitButton className="btn btn-primary btn-block" pendingLabel="Creating…">Create Super Admin</SubmitButton>
        </ActionForm>
      </div>
    </div>
  );
}
