'use client';

import { useEffect } from 'react';

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Something went wrong</h1>
        <p className="sub">The page could not be shown. Nothing was changed. Please try again.</p>
        <button type="button" className="btn btn-primary" onClick={() => retry()}>Try again</button>
      </div>
    </div>
  );
}
