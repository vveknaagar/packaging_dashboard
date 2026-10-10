import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PrintButton } from '@/components/PrintButton';
import { canViewTransfer } from '@/lib/permissions';
import { getLines, getTransfer, STATUS_LABELS } from '@/lib/services/transfers';
import { requireUser } from '@/lib/session';
import { TRANSPORT_MODES } from '@/lib/transport';
import { fmtDateTime, fmtMoney, fmtNum, parseId } from '@/lib/util';

export const metadata: Metadata = { title: 'Transfer slip' };

/** A print-ready page. "Print / Save as PDF" in the browser produces the slip. */
export default async function TransferSlipPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = parseId((await params).id);
  const t = id ? await getTransfer(id) : undefined;
  if (!t || !canViewTransfer(user, t) || t.status === 'draft') notFound();

  const lines = await getLines(t.id);
  const received = t.status === 'completed' || t.status === 'discrepancy';
  const totalSent = lines.reduce((n, l) => n + l.qty_sent, 0);
  const totalReceived = lines.reduce((n, l) => n + (l.qty_received ?? 0), 0);
  // Value of the goods sent, at the prices frozen on dispatch.
  const totalValue = lines.reduce((n, l) => n + (l.rate_paise ?? 0) * l.qty_sent, 0);
  const unpriced = lines.filter((l) => l.rate_paise === null).length;

  return (
    <div className="slip">
      <div className="slip-actions no-print">
        <Link href={`/transfers/${t.id}`} className="btn btn-ghost">Back to transfer</Link>
        <PrintButton />
      </div>

      <header className="slip-head">
        <div className="slip-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="slip-logo" src="/slip-logo.png" alt="Mayavé" />
          <div>
            <div className="slip-app">Mayave Item Transfer</div>
            <h1>Stock Transfer Slip</h1>
          </div>
        </div>
        <div className="slip-number">
          <strong>{t.number}</strong>
          <span>{STATUS_LABELS[t.status]}</span>
        </div>
      </header>

      <section className="slip-parties">
        <div>
          <h2>Sender</h2>
          <strong>{t.source_name} ({t.source_code})</strong>
          <div className="slip-address">{t.source_address || '—'}</div>
          <div>GSTIN: {t.source_gstin || '—'}</div>
          {(t.source_contact || t.source_phone) && <div>{[t.source_contact, t.source_phone].filter(Boolean).join(' · ')}</div>}
        </div>
        <div>
          <h2>Deliver to</h2>
          <strong>{t.dest_name} ({t.dest_code})</strong>
          <div className="slip-address">{t.dest_address || '—'}</div>
          <div>GSTIN: {t.dest_gstin || '—'}</div>
          {(t.dest_contact || t.dest_phone) && <div>{[t.dest_contact, t.dest_phone].filter(Boolean).join(' · ')}</div>}
        </div>
        <div>
          <h2>Transport</h2>
          <div>Mode: {TRANSPORT_MODES[t.transport_mode] ?? '—'}</div>
          {t.partner_name && <div>Logistic partner: {t.partner_name}{t.partner_phone ? ` · ${t.partner_phone}` : ''}</div>}
          {t.transport_ref && <div>Vehicle / LR / docket: {t.transport_ref}</div>}
          <div>Dispatched: {fmtDateTime(t.dispatched_at) || '—'}</div>
          <div>Received: {fmtDateTime(t.received_at) || '—'}</div>
        </div>
      </section>

      <div className="slip-table-wrap">
        <table className="slip-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Item</th>
              <th>Size</th>
              <th>HSN</th>
              <th className="num">Qty sent</th>
              <th className="num">Rate (₹)</th>
              <th className="num">Amount (₹)</th>
              <th className="num">Qty received</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, index) => (
              <tr key={l.id}>
                <td>{index + 1}</td>
                <td>{l.name}</td>
                <td>{l.size}</td>
                <td>{l.hsn || '—'}</td>
                <td className="num">{fmtNum(l.qty_sent)} {l.unit}</td>
                <td className="num">{l.rate_paise === null ? '—' : fmtMoney(l.rate_paise)}</td>
                <td className="num">{l.rate_paise === null ? '—' : fmtMoney(l.rate_paise * l.qty_sent)}</td>
                <td className="num">{received ? fmtNum(l.qty_received) : ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>Total ({lines.length} item(s))</td>
              <td className="num">{fmtNum(totalSent)}</td>
              <td />
              <td className="num">{fmtMoney(totalValue)}{unpriced ? ' *' : ''}</td>
              <td className="num">{received ? fmtNum(totalReceived) : ''}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {unpriced > 0 && <p className="slip-small">* {unpriced} item(s) had no price when dispatched and are not included in the total.</p>}
      {t.note && <p><strong>Note:</strong> {t.note}</p>}
      {t.receive_remark && <p><strong>Receiver remark:</strong> {t.receive_remark}</p>}
      {t.closed_reason && <p><strong>{t.status === 'rejected' ? 'Rejection' : 'Cancellation'} reason:</strong> {t.closed_reason}</p>}

      <section className="slip-signs">
        <div>
          <div className="sign-line" />
          Dispatched by{t.dispatched_by_name ? `: ${t.dispatched_by_name}` : ''}
        </div>
        <div>
          <div className="sign-line" />
          Carried by
        </div>
        <div>
          <div className="sign-line" />
          Received by{t.received_by_name ? `: ${t.received_by_name}` : ''}
        </div>
      </section>
      {/* An image rather than a CSS background, which browsers leave out when printing. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="slip-watermark" src="/slip-watermark.png" alt="" aria-hidden="true" />
    </div>
  );
}
