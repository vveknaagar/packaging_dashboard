'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Uploads the item sheet. The server checks every row and answers with a
 * preview; nothing is imported at this step.
 */
export function BulkUploadForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/items/bulk', { method: 'POST', body: data });
      const body = await res.json().catch(() => null) as { token?: string; error?: string } | null;
      if (!res.ok || !body?.token) {
        setError(body?.error ?? 'The upload failed. Please try again.');
        setBusy(false);
        return;
      }
      router.push(`/items/bulk/${body.token}`);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="stack">
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      <label className="field">
        <span>Item sheet (.xlsx or .csv)</span>
        <input type="file" name="sheet" accept=".xlsx,.csv" required />
      </label>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Checking rows…' : 'Upload and preview'}
        </button>
      </div>
    </form>
  );
}
