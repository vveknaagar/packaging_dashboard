'use client';

import { useMemo, useState } from 'react';
import { bulkStockInAction } from '@/app/actions/stock';
import { ActionForm, SubmitButton } from './ActionForm';
import { Thumb } from './Thumb';
import type { TransferFormItem } from './TransferForm';

interface Props {
  warehouseName: string;
  /** Every active item with the warehouse's stock of it. */
  items: TransferFormItem[];
}

const REASONS = ['Purchase received', 'Returned by customer', 'Opening stock'];

/** Stock In for many items at once: tick each item and type how many to add to the warehouse. */
export function BulkStockForm({ warehouseName, items }: Props) {
  const [qty, setQty] = useState<Record<number, string>>({});
  const [picked, setPicked] = useState<Set<number>>(() => new Set());
  const [search, setSearch] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [reason, setReason] = useState('');

  // A ticked item needs a whole number of 1 or more.
  const lines = useMemo(() => items.map((item) => {
    const on = picked.has(item.id);
    const text = qty[item.id] ?? '';
    const n = /^\d+$/.test(text) ? Number(text) : NaN;
    const invalid = on && text !== '' && (Number.isNaN(n) || n < 1);
    return { item, on, text, n, invalid, ready: on && text !== '' && !invalid };
  }), [items, qty, picked]);

  const chosen = lines.filter((l) => l.on);
  const canSave = chosen.length > 0 && chosen.every((l) => l.ready) && reason.trim() !== '';
  const units = chosen.reduce((sum, l) => sum + (l.ready ? l.n : 0), 0);
  const needle = search.trim().toLowerCase();
  const visible = lines.filter((l) =>
    (!selectedOnly || l.on) &&
    (!needle || `${l.item.name} ${l.item.size}`.toLowerCase().includes(needle)));

  function toggle(id: number, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
    if (on) requestAnimationFrame(() => document.getElementById(`qty-${id}`)?.focus());
    else setQty((prev) => ({ ...prev, [id]: '' }));
  }

  function reset() {
    setPicked(new Set());
    setQty({});
    setReason('');
    setSelectedOnly(false);
  }

  return (
    <ActionForm
      action={bulkStockInAction} className="stack" onSuccess={reset}
      confirm={`Add ${units} unit(s) across ${chosen.length} item(s) to ${warehouseName}?`}
    >
      {/* Only ticked items are sent, whatever the search box is hiding. */}
      {chosen.map((l) => <input key={l.item.id} type="hidden" name={`qty_${l.item.id}`} value={l.text} />)}

      <div className="card">
        <div className="card-head">
          <h2 className="req">Add stock to existing items</h2>
          <span className="muted">Tick an item, then enter the quantity to add to {warehouseName}.</span>
        </div>
        <div className="toolbar">
          <input type="search" placeholder="Search name or size" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search items" />
          <label className="check">
            <input type="checkbox" checked={selectedOnly} onChange={(e) => setSelectedOnly(e.target.checked)} />
            Selected only
          </label>
        </div>
        {items.length === 0 ? (
          <div className="empty">No items have been added yet.</div>
        ) : visible.length === 0 ? (
          <div className="empty">No items match.</div>
        ) : (
          <ul className="pick-list">
            {visible.map(({ item, on, text, invalid }) => (
              <li key={item.id} className={on ? 'picked' : undefined}>
                <label className="pick-label">
                  <input type="checkbox" className="pick-check" checked={on} onChange={(e) => toggle(item.id, e.target.checked)} />
                  <Thumb src={item.thumb} size={48} />
                  <span className="pick-info">
                    <span className="item-name">{item.name}</span>
                    <span className="item-size">{item.size}</span>
                    <span className="muted">In stock: <strong>{item.available}</strong> {item.unit}</span>
                    {invalid && <span className="field-error" role="alert">Enter a whole number of 1 or more.</span>}
                  </span>
                </label>
                <input
                  id={`qty-${item.id}`}
                  type="number" inputMode="numeric" min={1} step={1} placeholder="Qty"
                  className={`qty-input${invalid ? ' invalid' : ''}`}
                  aria-label={`Quantity to add of ${item.name} ${item.size}`}
                  disabled={!on}
                  value={text}
                  onChange={(e) => setQty((prev) => ({ ...prev, [item.id]: e.target.value }))}
                />
              </li>
            ))}
          </ul>
        )}
        <label className="field">
          <span>Reason</span>
          <input
            name="reason" type="text" required maxLength={300} list="bulk-stock-reasons" placeholder="Why is the stock changing?"
            value={reason} onChange={(e) => setReason(e.target.value)}
          />
          <datalist id="bulk-stock-reasons">
            {REASONS.map((r) => <option key={r} value={r} />)}
          </datalist>
        </label>
      </div>

      <div className="sticky-bar">
        <div><strong>{chosen.length}</strong> item(s), <strong>{units}</strong> unit(s)</div>
        <div className="form-actions">
          <SubmitButton pendingLabel="Saving…" disabled={!canSave}>Add stock</SubmitButton>
        </div>
      </div>
    </ActionForm>
  );
}
