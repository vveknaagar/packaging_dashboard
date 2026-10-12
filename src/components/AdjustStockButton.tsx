'use client';

import { useState } from 'react';
import { adjustStockAction } from '@/app/actions/stock';
import { ActionForm, SubmitButton } from './ActionForm';
import { Modal } from './Modal';

type Mode = 'in' | 'out' | 'set';

interface Props {
  itemId: number;
  itemName: string;
  itemSize: string;
  unit: string;
  qty: number;
  locationId: number;
  /** Deactivated items can be reduced or corrected but not added to. */
  itemActive: boolean;
}

const MODES: { value: Mode; label: string; qtyLabel: string }[] = [
  { value: 'in', label: 'Stock In', qtyLabel: 'Quantity to add' },
  { value: 'out', label: 'Stock Out', qtyLabel: 'Quantity to remove' },
  { value: 'set', label: 'Adjustment', qtyLabel: 'Counted quantity' },
];

const REASONS: Record<Mode, string[]> = {
  in: ['Purchase received', 'Returned by customer', 'Opening stock'],
  out: ['Used for orders', 'Damaged', 'Lost or missing'],
  set: ['Stock count correction'],
};

/** Opens the Stock In / Stock Out / Adjustment dialog for one item. */
export function AdjustStockButton({ itemId, itemName, itemSize, unit, qty, locationId, itemActive }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>(itemActive ? 'in' : 'out');
  const [amount, setAmount] = useState('');

  const n = /^\d+$/.test(amount) ? Number(amount) : null;
  const result = n === null ? null : mode === 'in' ? qty + n : mode === 'out' ? qty - n : n;
  const tooMuch = result !== null && result < 0;
  const current = MODES.find((m) => m.value === mode)!;

  function close() {
    setOpen(false);
    setAmount('');
  }

  return (
    <>
      <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>Update</button>
      <Modal open={open} onClose={close} title="Update stock">
        <p className="modal-item"><strong>{itemName}</strong> · {itemSize}<br /><span className="muted">Current stock: {qty} {unit}</span></p>
        <ActionForm action={adjustStockAction} onSuccess={close} className="stack">
          <input type="hidden" name="item_id" value={itemId} />
          <input type="hidden" name="location_id" value={locationId} />
          <input type="hidden" name="mode" value={mode} />
          <div className="segmented" role="radiogroup" aria-label="Type of change">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={mode === m.value}
                className={mode === m.value ? 'active' : undefined}
                disabled={m.value === 'in' && !itemActive}
                onClick={() => setMode(m.value)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <label className="field">
            <span>{current.qtyLabel}</span>
            <input
              name="qty" type="number" inputMode="numeric" min={mode === 'set' ? 0 : 1} step={1} required autoFocus
              value={amount} onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          {result !== null && (
            <p className={tooMuch ? 'field-error' : 'hint'} role={tooMuch ? 'alert' : undefined}>
              {tooMuch ? `Only ${qty} in stock. Stock cannot go below zero.` : `Stock after this change: ${result} ${unit}`}
            </p>
          )}
          <label className="field">
            <span>Reason</span>
            <input name="reason" type="text" required maxLength={300} list={`reasons-${mode}`} placeholder="Why is the stock changing?" />
            <datalist id={`reasons-${mode}`}>
              {REASONS[mode].map((r) => <option key={r} value={r} />)}
            </datalist>
          </label>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={close}>Cancel</button>
            <SubmitButton pendingLabel="Saving…" disabled={tooMuch}>Save</SubmitButton>
          </div>
        </ActionForm>
      </Modal>
    </>
  );
}
