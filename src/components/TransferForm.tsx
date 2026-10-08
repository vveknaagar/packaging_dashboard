'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { saveTransferAction } from '@/app/actions/stock';
import { TRANSPORT_MODES } from '@/lib/transport';
import { ActionForm, SubmitButton } from './ActionForm';

export interface TransferFormItem {
  id: number;
  name: string;
  size: string;
  unit: string;
  thumb: string;
  available: number;
}

interface Props {
  sourceName: string;
  /** Only for the Super Admin on a new transfer: the locations they can send from, and the one chosen. */
  sources?: { id: number; name: string }[];
  sourceId?: number;
  /** Whose stock the numbers are: "Your stock" unless the Super Admin is sending from a location. */
  stockLabel?: string;
  destinations: { id: number; name: string; code: string }[];
  items: TransferFormItem[];
  /** Present when editing a draft. */
  transferId?: number;
  initialDestId?: number;
  initialNote?: string;
  initialTransportMode?: string;
  initialTransportRef?: string;
  initialQty?: Record<number, number>;
}

/** Create a transfer or edit a draft: choose the destination, tick the items to send and type a quantity for each. */
export function TransferForm({
  sourceName, sources, sourceId, stockLabel = 'Your stock', destinations, items, transferId, initialDestId, initialNote = '',
  initialTransportMode = '', initialTransportRef = '', initialQty = {},
}: Props) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<number, string>>(
    () => Object.fromEntries(Object.entries(initialQty).map(([id, n]) => [id, String(n)])),
  );
  const [picked, setPicked] = useState<Set<number>>(() => new Set(Object.keys(initialQty).map(Number)));
  const [search, setSearch] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);

  // A ticked item needs a whole number from 1 up to the stock on hand.
  const lines = useMemo(() => items.map((item) => {
    const on = picked.has(item.id);
    const text = qty[item.id] ?? '';
    const n = /^\d+$/.test(text) ? Number(text) : NaN;
    const invalid = on && text !== '' && (Number.isNaN(n) || n < 1 || n > item.available);
    return { item, on, text, n, invalid, ready: on && text !== '' && !invalid };
  }), [items, qty, picked]);

  const chosen = lines.filter((l) => l.on);
  const canSend = chosen.length > 0 && chosen.every((l) => l.ready);
  const units = chosen.reduce((sum, l) => sum + (l.ready ? l.n : 0), 0);
  const inStock = items.filter((item) => item.available > 0).length;
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

  return (
    <ActionForm action={saveTransferAction} className="stack">
      {transferId && <input type="hidden" name="id" value={transferId} />}
      {/* Only ticked items are sent, whatever the search box is hiding. */}
      {chosen.map((l) => <input key={l.item.id} type="hidden" name={`qty_${l.item.id}`} value={l.text} />)}

      <div className="card">
        <div className="form-grid">
          <label className="field">
            <span>From</span>
            {sources ? (
              // The item list shows the stock of this location, so choosing another one reloads the page.
              <select name="source_id" value={sourceId} onChange={(e) => router.push(`/transfers/new?from=${e.target.value}`)}>
                {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            ) : <input type="text" value={sourceName} readOnly disabled />}
            {sources && <span className="hint">Changing this starts the item list again.</span>}
          </label>
          <label className="field">
            <span>To (destination store)</span>
            <select name="dest_id" required defaultValue={initialDestId ?? ''}>
              <option value="" disabled>Select a store…</option>
              {destinations.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.code})</option>)}
            </select>
          </label>
          <label className="field">
            <span>Mode of transport</span>
            <select name="transport_mode" required defaultValue={initialTransportMode}>
              <option value="" disabled>Select…</option>
              {Object.entries(TRANSPORT_MODES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Vehicle / LR / docket no. (optional)</span>
            <input type="text" name="transport_ref" maxLength={60} defaultValue={initialTransportRef} placeholder="e.g. GJ05AB1234" autoCapitalize="characters" />
          </label>
          <label className="field span-2">
            <span>Note (optional)</span>
            <input type="text" name="note" maxLength={500} defaultValue={initialNote} placeholder="Anything the receiver should know" />
          </label>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Items to send</h2>
          <span className="muted">Tick an item, then enter its quantity. {inStock} of {items.length} item(s) in stock at {sourceName}</span>
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
              <li key={item.id} className={on ? 'picked' : item.available ? undefined : 'out'}>
                <label className="pick-label">
                  <input
                    type="checkbox" className="pick-check" checked={on} disabled={!on && item.available === 0}
                    onChange={(e) => toggle(item.id, e.target.checked)}
                  />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="thumb" src={`/uploads/${item.thumb}`} alt="" width={48} height={48} loading="lazy" />
                  <span className="pick-info">
                    <span className="item-name">{item.name}</span>
                    <span className="item-size">{item.size}</span>
                    <span className="muted">{stockLabel}: <strong>{item.available}</strong> {item.unit}</span>
                    {invalid && (
                      <span className="field-error" role="alert">
                        {item.available ? `Enter a whole number from 1 to ${item.available}.` : 'No stock left here. Untick this item.'}
                      </span>
                    )}
                  </span>
                </label>
                <input
                  id={`qty-${item.id}`}
                  type="number" inputMode="numeric" min={1} max={item.available} step={1} placeholder="Qty"
                  className={`qty-input${invalid ? ' invalid' : ''}`}
                  aria-label={`Quantity of ${item.name} ${item.size}`}
                  disabled={!on}
                  value={text}
                  onChange={(e) => setQty((prev) => ({ ...prev, [item.id]: e.target.value }))}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="sticky-bar">
        <div><strong>{chosen.length}</strong> item(s), <strong>{units}</strong> unit(s)</div>
        <div className="form-actions">
          <Link href={transferId ? `/transfers/${transferId}` : '/transfers'} className="btn btn-ghost">Cancel</Link>
          <SubmitButton className="btn" name="intent" value="draft" disabled={!canSend}>Save draft</SubmitButton>
          <SubmitButton
            name="intent" value="dispatch" disabled={!canSend} pendingLabel="Working…"
            data-confirm={`Dispatch now? ${units} unit(s) will be deducted from ${sourceName} and shown as in transit.`}
          >
            Dispatch
          </SubmitButton>
        </div>
      </div>
    </ActionForm>
  );
}
