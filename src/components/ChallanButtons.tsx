'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CHALLAN_DONE } from './DownloadChallan';

/**
 * "Preview" opens the delivery challan in a new tab. "Download" loads it in a hidden frame,
 * which saves the PDF and reports back, so the user stays on the transfer.
 */
export function ChallanButtons({ transferId }: { transferId: number }) {
  const href = `/transfers/${transferId}/slip`;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!busy) return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== CHALLAN_DONE) return;
      setBusy(false);
      setFailed(!e.data.ok);
    };
    window.addEventListener('message', onMessage);
    // Never leave the button stuck if the frame fails to load.
    const timer = setTimeout(() => { setBusy(false); setFailed(true); }, 60_000);
    return () => { window.removeEventListener('message', onMessage); clearTimeout(timer); };
  }, [busy]);

  return (
    <>
      <Link href={href} className="btn" target="_blank">Preview Delivery Challan</Link>
      <button type="button" className="btn" onClick={() => { setFailed(false); setBusy(true); }} disabled={busy} title={failed ? 'The download failed. Try again, or use Preview.' : undefined}>
        {busy ? 'Preparing PDF…' : failed ? 'Download failed — retry' : 'Download Delivery Challan'}
      </button>
      {busy && (
        <iframe
          src={`${href}?download=1`}
          title="Delivery challan download"
          aria-hidden="true"
          tabIndex={-1}
          style={{ position: 'fixed', left: -10000, top: 0, width: 1000, height: 1400, border: 0 }}
        />
      )}
    </>
  );
}
