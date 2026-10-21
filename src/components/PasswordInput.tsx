'use client';

import { useState } from 'react';

/** A password box with an eye button that shows or hides what has been typed. */
export function PasswordInput(props: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [shown, setShown] = useState(false);
  return (
    <span className="password-wrap">
      <input {...props} type={shown ? 'text' : 'password'} autoCapitalize="none" spellCheck={false} />
      <button
        type="button" className="password-eye" onClick={() => setShown((s) => !s)}
        aria-label={shown ? 'Hide password' : 'Show password'} aria-pressed={shown} title={shown ? 'Hide password' : 'Show password'}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
          {shown && <path d="M3 3l18 18" />}
        </svg>
      </button>
    </span>
  );
}
