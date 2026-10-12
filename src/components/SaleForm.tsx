'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { recordSaleAction } from '@/app/actions/stock';
import { ActionForm, SubmitButton } from './ActionForm';
import { Thumb } from './Thumb';

export interface SaleFormItem {
  id: number;
  name: string;
  size: string;
  unit: string;
  thumb: string;
  available: number;
}

interface Props {
  locationId: number;
  storeName: string;
  /** Items this store has in stock. */
  items: SaleFormItem[];
}

/** Mark items sold at a store: tick each item sold and type how many. */
export function SaleForm({ locationId, storeName, items }: Props) {
  const [qty, setQty] = useState<Record<number, string>>({});
  const [picked, setPicked] = useState<Set<number>>(() => new Set());
  const [search, setSearch] = useState('');
  const [billNo, setBillNo] = useState('');
  const [customer, setCustomer] = useState('');

  // A ticked item needs a whole number from 1 up to the stock on hand.
  const lines = useMemo(() => items.map((item) => {
    const on = picked.has(item.id);
    const text = qty[item.id] ?? '';
    const n = /^\d+$/.test(text) ? Number(text) : NaN;
    const invalid = on && text !== '' && (Number.isNaN(n) || n < 1 || n > item.available);
    return { item, on, text, n, invalid, ready: on && text !== '' && !invalid };
  }), [items, qty, picked]);

  const chosen = lines.filter((l) => l.on);
  const canSave = chosen.length > 0 && chosen.every((l) => l.ready) && billNo.trim() !== '' && customer.trim() !== '';
  const units = chosen.reduce((sum, l) => sum + (l.ready ? l.n : 0), 0);
  const needle = search.trim().toLowerCase();
  const visible = lines.filter((l) => !needle || `${l.item.name} ${l.item.size}`.toLowerCase().includes(needle));

  function toggle(id: number, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
    if (on) requestAnimationFrame(() => document.getElementById(`qty-${id}`)?.focus());
    else setQty((prev) => ({ ...prev, [id]: '' }));
  }

  return (
    <ActionForm action={recordSaleAction} className="stack" confirm={`Mark ${units} unit(s) as sold to ${customer.trim()} on bill ${billNo.trim()}? This takes them off ${storeName}'s stock.`}>
      <input type="hidden" name="location_id" value={locationId} />
      {/* Only ticked items are sent, whatever the search box is hiding. */}
      {chosen.map((l) => <input key={l.item.id} type="hidden" name={`qty_${l.item.id}`} value={l.text} />)}

      <div className="card">
        <div className="card-head">
          <h2 className="req">Items sold</h2>
          <span className="muted">Tick each item sold, then enter how many. {items.length} item(s) in stock at {storeName}</span>
        </div>
        <div className="toolbar">
          <input type="search" placeholder="Search name or size" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search items" />
        </div>
        {items.length === 0 ? (
          <div className="empty">This store has no stock to sell.</div>
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
                    {invalid && <span className="field-error" role="alert">Enter a whole number from 1 to {item.available}.</span>}
                  </span>
                </label>
                <input
                  id={`qty-${item.id}`}
                  type="number" inputMode="numeric" min={1} max={item.available} step={1} placeholder="Qty"
                  className={`qty-input${invalid ? ' invalid' : ''}`}
                  aria-label={`Quantity sold of ${item.name} ${item.size}`}
                  disabled={!on}
                  value={text}
                  onChange={(e) => setQty((prev) => ({ ...prev, [item.id]: e.target.value }))}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <div className="card-head"><h2>Bill and customer</h2></div>
        <div className="form-grid">
          <label className="field">
            <span>Bill / invoice no.</span>
            <input type="text" name="bill_no" required maxLength={60} value={billNo} onChange={(e) => setBillNo(e.target.value)} placeholder="Number on the sale invoice" />
          </label>
          <label className="field">
            <span>Customer name</span>
            <input type="text" name="customer_name" required maxLength={120} value={customer} onChange={(e) => setCustomer(e.target.value)} autoComplete="off" />
          </label>
          <label className="field">
            <span>Customer phone (optional)</span>
            <input type="tel" name="customer_phone" maxLength={20} inputMode="tel" pattern="[0-9+\- ]{6,20}" title="Digits, spaces, + or -" autoComplete="off" />
          </label>
          <label className="field">
            <span>Note (optional)</span>
            <input type="text" name="note" maxLength={300} />
          </label>
        </div>
      </div>

      <div className="sticky-bar">
        <div><strong>{chosen.length}</strong> item(s), <strong>{units}</strong> unit(s)</div>
        <div className="form-actions">
          <Link href={`/stock?location=${locationId}`} className="btn btn-ghost">Cancel</Link>
          <SubmitButton pendingLabel="Saving…" disabled={!canSave}>Mark sold</SubmitButton>
        </div>
      </div>
    </ActionForm>
  );
}
