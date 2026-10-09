import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { loginAction } from '@/app/actions/auth';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { getUser, hasAnyUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage() {
  await connection(); // the answer depends on live data, so never prerender this page
  if (!await hasAnyUser()) redirect('/setup');
  if (await getUser()) redirect('/');

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="brand brand-dark">
          <span className="brand-mark" aria-hidden="true">P</span>
          <span>Packaging Inventory<br /><small>&amp; Stock Transfer</small></span>
        </div>
        <h1>Sign in</h1>
        <ActionForm action={loginAction} className="stack">
          <label className="field">
            <span>Username</span>
            <input name="username" type="text" required autoFocus autoComplete="username" autoCapitalize="none" spellCheck={false} />
          </label>
          <label className="field">
            <span>Password</span>
            <input name="password" type="password" required autoComplete="current-password" />
          </label>
          <SubmitButton className="btn btn-primary btn-block" pendingLabel="Signing in…">Sign in</SubmitButton>
        </ActionForm>
        <p className="hint">Forgot your password? Ask the Super Admin to reset it.</p>
      </div>
    </div>
  );
}
