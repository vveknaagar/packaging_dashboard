'use client';

import { useState } from 'react';
import { receiveTransferAction } from '@/app/actions/stock';
import { ActionForm, SubmitButton } from './ActionForm';
import { Thumb } from './Thumb';

interface Line {
  id: number;
  name: string;
  size: string;
  unit: string;
  thumb: string;
  qty_sent: number;
}

/**
 * Inward entry. The sent quantities are fixed; the receiver only confirms how
 * many of each item actually arrived. Any difference needs a remark.
 */
export function ReceiveForm({ transferId, lines }: { transferId: number; lines: Line[] }) {
  const [received, setReceived] = useState<Record<number, string>>(
    () => Object.fromEntries(lines.map((l) => [l.id, String(l.qty_sent)])),
  );

  const parsed = lines.map((line) => {
    const text = received[line.id] ?? '';
    const n = /^\d+$/.test(text) ? Number(text) : null;
    return { line, text, n, differs: n !== null && n !== line.qty_sent };
  });
  const hasInvalid = parsed.some((p) => p.n === null);
  const hasDiscrepancy = parsed.some((p) => p.differs);

  return (
    <ActionForm action={receiveTransferAction} className="stack">
      <input type="hidden" name="id" value={transferId} />
      <ul className="pick-list">
        {parsed.map(({ line, text, n, differs }) => (
          <li key={line.id} className={differs ? 'differs' : undefined}>
            <Thumb src={line.thumb} size={48} />
            <div className="pick-info">
              <div className="item-name">{line.name}</div>
              <div className="item-size">{line.size}</div>
              <div className="muted">Sent: <strong>{line.qty_sent}</strong> {line.unit}</div>
              {differs && n !== null && (
                <div className="diff-note">
                  {n < line.qty_sent ? `Short by ${line.qty_sent - n}` : `Excess of ${n - line.qty_sent}`}
                </div>
              )}
              {n === null && <div className="field-error" role="alert">Enter a whole number, zero or more.</div>}
            </div>
            <label className="recv-field">
              <span>Received</span>
              <input
                type="number" inputMode="numeric" min={0} step={1} required
                name={`recv_${line.id}`}
                className={`qty-input${n === null ? ' invalid' : ''}`}
                value={text}
                onChange={(e) => setReceived((prev) => ({ ...prev, [line.id]: e.target.value }))}
              />
            </label>
          </li>
        ))}
      </ul>

      {hasDiscrepancy && (
        <div className="alert alert-warn" role="status">
          <strong>Quantities differ from what was sent.</strong> The transfer will be marked “Received with Discrepancy”,
          only the received quantities will be added to your stock, and the Warehouse Admin will be notified.
        </div>
      )}
      <label className="field">
        <span>{hasDiscrepancy ? 'Remark (required)' : 'Remark (optional)'}</span>
        <textarea name="remark" rows={2} maxLength={500} required={hasDiscrepancy}
          placeholder={hasDiscrepancy ? 'Explain the difference, for example: 2 boxes damaged in transit' : ''} />
      </label>
      <div className="form-actions">
        <SubmitButton
          disabled={hasInvalid} pendingLabel="Saving…"
          data-confirm={hasDiscrepancy
            ? 'Approve with a discrepancy? Only the received quantities will be added to stock.'
            : 'Approve? Everything was received as sent and the stock will be added now.'}
        >
          {hasDiscrepancy ? 'Approve with discrepancy' : 'Approve receipt'}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
