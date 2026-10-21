import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DownloadChallan } from '@/components/DownloadChallan';
import { PrintButton } from '@/components/PrintButton';
import { canViewTransfer } from '@/lib/permissions';
import { getTransfer, STATUS_LABELS } from '@/lib/services/transfers';
import { requireUser } from '@/lib/session';
import { fmtDate, fmtMoney, parseId } from '@/lib/util';

export const metadata: Metadata = { title: 'Delivery Challan' };

/** The company that owns every location, named on the challan and in its certificate line. */
const COMPANY = 'Dholakia Retail Private Limited';

/** "Dholakia Retail Private Limited - Central IKON - Noida" reads "Central IKON, Noida": the company has its own line. */
function placeName(name: string): string {
  const prefix = new RegExp(`^${COMPANY}\\s*[-–—]\\s*`, 'i');
  return name.replace(prefix, '').replace(/\s*[–—]\s*|\s+-\s*|\s*-\s+/g, ', ');
}

/** Rupees without the sign, for columns headed "Rate ₹" and "Amount ₹". */
const amount = (paise: number) => fmtMoney(paise).replace('₹', '');

/**
 * The delivery challan, to print or download as a PDF.
 * Opened with ?download=1 (in a hidden frame on the transfer page), it saves the PDF straight away.
 */
export default async function TransferSlipPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = parseId((await params).id);
  const t = id ? await getTransfer(id) : undefined;
  if (!t || !canViewTransfer(user, t) || !t.dispatched_at) notFound();

  // The challan names no individual items: one line, for the amount the sender chose.
  const challanValue = t.challan_amount_paise;
  const challanDate = fmtDate(t.dispatched_at) || '—';

  const party = (role: string, name: string, code: string, address: string, gstin: string, contact: string | null, phone: string | null) => (
    <div className="slip-party">
      <h2>{role}</h2>
      {/* The sender is named exactly as its location is set up; the receiver by its place. */}
      <div className="slip-party-name"><strong>{role === 'From' ? name : placeName(name)}</strong> <span className="slip-code">{code}</span></div>
      <div className="slip-address">{address || '—'}</div>
      {gstin && <div className="slip-code slip-gstin">GSTIN {gstin}</div>}
      {(contact || phone) && <div className="slip-contact">{[contact, phone].filter(Boolean).join(' · ')}</div>}
    </div>
  );

  return (
    <div className="slip">
      <div className="slip-actions no-print">
        <Link href={`/transfers/${t.id}`} className="btn btn-ghost">Back to transfer</Link>
        <div className="slip-actions-end">
          <PrintButton />
          <DownloadChallan fileName={`Delivery Challan ${t.number}.pdf`} />
        </div>
      </div>

      <header className="slip-head">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="slip-logo" src="/slip-logo.png" alt="Dholakia Retail" />
          <h1>Delivery Challan</h1>
        </div>
        <div className="slip-meta">
          <span className={`slip-status slip-status-${t.status}`}>{STATUS_LABELS[t.status]}</span>
          <div className="slip-meta-row">
            <div><span>Challan no.</span><strong className="slip-code">{t.number}</strong></div>
            <div><span>Date</span><strong>{challanDate}</strong></div>
          </div>
        </div>
      </header>

      <section className="slip-parties">
        {party('From', t.source_name, t.source_code, t.source_address, t.source_gstin, t.source_contact, t.source_phone)}
        {party('Deliver to', t.dest_name, t.dest_code, t.dest_address, t.dest_gstin, t.dest_contact, t.dest_phone)}
      </section>

      <div className="slip-table-wrap">
        <table className="slip-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Description of goods</th>
              <th className="num">Amount ₹</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="slip-index">1</td>
              <td>Packaging material</td>
              <td className="num">{challanValue === null ? '—' : amount(challanValue)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="slip-value">
        <span>Consignment value</span>
        <strong>{challanValue === null ? '—' : fmtMoney(challanValue)}</strong>
      </div>

      {challanValue === null && (
        <p className="slip-small no-print">
          No amount has been set yet. Use Preview or Download Delivery Challan on the transfer page and enter the amount (up to ₹49,000).
        </p>
      )}

      {/* Declaration, remarks and signatures stay together on one page. */}
      <div className="slip-closing">
        <section className="slip-declaration">
          <h3>Declaration and Terms – Packing Materials</h3>
          <ol>
            <li>Materials are for internal product packaging use only and not for separate sale or resale.</li>
            <li>Item details, quantities and values are true and correct to the best of our knowledge. Declared values are for inventory, transit and insurance purposes.</li>
            <li>The recipient shall verify quantities and condition upon receipt and report any shortage, damage or discrepancy within 24 hours, with photographs where applicable.</li>
            <li>Receipt shall be acknowledged with the recipient’s name, signature and date. An acknowledged copy shall be shared with the dispatching team.</li>
            <li>Receipts and consumption shall be recorded in the inventory system, and stock balances reconciled periodically with physical stock.</li>
            <li>Indian laws shall apply. Disputes shall be subject to the exclusive jurisdiction of the competent courts at Surat, Gujarat.</li>
          </ol>
        </section>
        {t.note && <p className="slip-remark"><strong>Note:</strong> {t.note}</p>}
        {t.receive_remark && <p className="slip-remark"><strong>Receiver remark:</strong> {t.receive_remark}</p>}
        {t.closed_reason && <p className="slip-remark"><strong>{t.status === 'rejected' ? 'Rejection' : 'Cancellation'} reason:</strong> {t.closed_reason}</p>}

        <section className="slip-signs">
          <div>
            <h2>Dispatched by</h2>
            <div>{t.dispatched_by_name ?? ''}</div>
          </div>
          <div>
            <h2>Received by</h2>
            <div>{t.received_by_name ?? ''}</div>
          </div>
        </section>
      </div>
      {/* An image rather than a CSS background, which browsers leave out when printing. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="slip-watermark" src="/slip-watermark.png" alt="" aria-hidden="true" />
    </div>
  );
}
