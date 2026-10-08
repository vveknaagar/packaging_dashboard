'use client';

import { unstable_rethrow } from 'next/navigation';
import { createContext, useContext, useState, useTransition } from 'react';
import type { ActionResult } from '@/lib/types';
import { flash } from './Flash';

const PendingContext = createContext(false);

/** True while the surrounding ActionForm is waiting for the server. */
export const useFormPending = () => useContext(PendingContext);

interface Props {
  action: (formData: FormData) => Promise<ActionResult | void>;
  children: React.ReactNode;
  className?: string;
  /** Ask this question before submitting. A submit button can override it with data-confirm. */
  confirm?: string;
  onSuccess?: () => void;
  /** Show a refusal as a pop-up message instead of inside the form. For one-button forms in tables. */
  toastErrors?: boolean;
}

/**
 * A form that calls a server action and shows what came back. If the server
 * refuses the change, the reason appears at the top and everything the user
 * typed stays in place.
 */
export function ActionForm({ action, children, className, confirm, onSuccess, toastErrors }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fail = (message: string) => (toastErrors ? flash(message, 'error') : setError(message));

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const question = submitter?.dataset.confirm ?? confirm;
    if (question && !window.confirm(question)) return;
    const data = new FormData(event.currentTarget, submitter);
    setError(null);
    startTransition(async () => {
      let result: ActionResult | void;
      try {
        result = await action(data);
      } catch (err) {
        unstable_rethrow(err); // lets redirects issued by the action go through
        fail('Could not reach the server. Check your connection and try again.');
        return;
      }
      if (result?.error) {
        fail(result.error);
        return;
      }
      if (result?.ok) flash(result.ok);
      onSuccess?.();
    });
  }

  return (
    <form onSubmit={handleSubmit} className={className}>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      <PendingContext.Provider value={pending}>{children}</PendingContext.Provider>
    </form>
  );
}

interface SubmitProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Text shown while the form is being submitted. */
  pendingLabel?: string;
}

export function SubmitButton({ children, pendingLabel, className = 'btn btn-primary', disabled, ...rest }: SubmitProps) {
  const pending = useFormPending();
  return (
    <button type="submit" className={className} disabled={pending || disabled} {...rest}>
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
