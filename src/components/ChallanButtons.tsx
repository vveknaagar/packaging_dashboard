'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { setChallanAmountAction } from '@/app/actions/stock';
import { ActionForm, SubmitButton } from './ActionForm';
import { CHALLAN_DONE } from './DownloadChallan';
import { Modal } from './Modal';

interface Props {
  transferId: number;
  /** The amount and quantity already on the challan, as text for the inputs. Empty until first set. */
  initialAmount: string;
  initialQty: string;
  /** Only the sending side is asked for the amount; everyone else goes straight to the challan. */
  canSetAmount: boolean;
}

type Intent = 'preview' | 'download';

/**
 * "Preview" and "Download" for the delivery challan. The sender is first asked what amount
 * the challan is for (at most ₹49,000); it is saved on the transfer, then the challan opens.
 * Downloading loads the challan in a hidden frame, which saves the PDF and reports back.
 */
export function ChallanButtons({ transferId, initialAmount, initialQty, canSetAmount }: Props) {
  const router = useRouter();
  const href = `/transfers/${transferId}/slip`;
  const [intent, setIntent] = useState<Intent | null>(null);
  const [amount, setAmount] = useState(initialAmount);
  const [qty, setQty] = useState(initialQty);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // Rupees, optionally with paise, from 1 up to 49,000; the quantity a whole number of 1 or more.
  const n = /^\d+(\.\d{1,2})?$/.test(amount.trim()) ? Number(amount.trim()) : NaN;
  const invalid = amount.trim() !== '' && (Number.isNaN(n) || n <= 0 || n > 49_000);
  const qtyInvalid = qty.trim() !== '' && !/^[1-9]\d*$/.test(qty.trim());
  const ready = amount.trim() !== '' && !invalid && qty.trim() !== '' && !qtyInvalid;

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

  function open(which: Intent) {
    if (canSetAmount) setIntent(which);
    else proceed(which);
  }

  function proceed(which: Intent) {
    if (which === 'preview') {
      router.push(href);
    } else {
      setFailed(false);
      setBusy(true);
    }
  }

  return (
    <>
      <button type="button" className="btn" onClick={() => open('preview')}>Preview Delivery Challan</button>
      <button
        type="button" className="btn" onClick={() => open('download')} disabled={busy}
        title={failed ? 'The download failed. Try again, or use Preview.' : undefined}
      >
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
      <Modal open={intent !== null} onClose={() => setIntent(null)} title="Challan amount">
        <ActionForm
          action={setChallanAmountAction} className="stack"
          onSuccess={() => { const which = intent!; setIntent(null); proceed(which); }}
        >
          <input type="hidden" name="id" value={transferId} />
          <label className="field">
            <span>What amount should the challan be made for? (₹)</span>
            <input
              name="amount" type="text" inputMode="decimal" required maxLength={9} autoFocus
              value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 45000"
            />
            {invalid && <span className="field-error" role="alert">Enter rupees from 1 up to 49,000.</span>}
          </label>
          <label className="field">
            <span>Quantity on the challan</span>
            <input
              name="qty" type="number" inputMode="numeric" required min={1} step={1} maxLength={9}
              value={qty} onChange={(e) => setQty(e.target.value)} placeholder="e.g. 500"
            />
            {qtyInvalid && <span className="field-error" role="alert">Enter a whole number of 1 or more.</span>}
          </label>
          <p className="hint">Printed as one line, &ldquo;Store Packaging Material&rdquo;, with this quantity and amount. The amount cannot exceed ₹49,000.</p>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setIntent(null)}>Cancel</button>
            <SubmitButton pendingLabel="Saving…" disabled={!ready}>
              {intent === 'download' ? 'Save & download' : 'Save & preview'}
            </SubmitButton>
          </div>
        </ActionForm>
      </Modal>
    </>
  );
}
