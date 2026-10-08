import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { AppError } from './errors';
import { getUser, setFlash } from './session';
import type { ActionResult, Role, SessionUser } from './types';

interface Outcome {
  /** Success message to show. */
  ok?: string;
  /** Where to go next. Without it the current page is refreshed in place. */
  redirectTo?: string;
}

/**
 * Wrapper every server action goes through. A server action is a public
 * endpoint, so this is where the caller is identified and their role checked
 * before any work happens. Expected problems (AppError) come back as a
 * message for the form; anything unexpected is logged and reported generically.
 */
export async function runAction(
  roles: Role[] | null,
  work: (user: SessionUser) => Promise<Outcome | void> | Outcome | void,
): Promise<ActionResult> {
  let outcome: Outcome | void;
  try {
    const user = await getUser();
    if (!user) return { error: 'Your session has ended. Please sign in again.' };
    if (roles && !roles.includes(user.role)) return { error: 'You do not have permission to do that.' };
    outcome = await work(user);
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    console.error(err);
    return { error: 'Something went wrong. Please try again.' };
  }
  // Every screen shows live stock, so drop anything the browser has cached.
  revalidatePath('/', 'layout');
  if (outcome?.redirectTo) {
    if (outcome.ok) await setFlash(outcome.ok);
    redirect(outcome.redirectTo);
  }
  return { ok: outcome?.ok ?? '' };
}
