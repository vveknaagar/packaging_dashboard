import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DownloadChallan } from '@/components/DownloadChallan';
import { PrintButton } from '@/components/PrintButton';
import { canViewTransfer } from '@/lib/permissions';
import { getLines, getTransfer, STATUS_LABELS } from '@/lib/services/transfers';
import { requireUser } from '@/lib/session';
import { fmtDate, fmtMoney, fmtNum, parseId } from '@/lib/util';

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

/** "Gift box Large (EVA 4+5) (Sleeve + Card)" shows as "Gift box Large" over "EVA 4+5 · Sleeve + Card". */
function splitName(name: string): { main: string; sub: string } {
  const parts = [...name.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim()).filter(Boolean);
  return { main: name.replace(/\s*\([^)]*\)/g, '').trim() || name, sub: parts.join(' · ') };
}

/**
 * The delivery challan, to print or download as a PDF.
 * Opened with ?download=1 (in a hidden frame on the transfer page), it saves the PDF straight away.
 */
export default async function TransferSlipPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = parseId((await params).id);
  const t = id ? await getTransfer(id) : undefined;
  if (!t || !canViewTransfer(user, t) || !t.dispatched_at) notFound();

  const lines = await getLines(t.id);
  const received = t.status === 'completed' || t.status === 'discrepancy';
  const totalSent = lines.reduce((n, l) => n + l.qty_sent, 0);
  const totalReceived = lines.reduce((n, l) => n + (l.qty_received ?? 0), 0);
  // Value of the goods sent, at the prices frozen on dispatch.
  const totalValue = lines.reduce((n, l) => n + (l.rate_paise ?? 0) * l.qty_sent, 0);
  const unpriced = lines.filter((l) => l.rate_paise === null).length;
  const units = new Set(lines.map((l) => l.unit.toLowerCase()));
  const totalUnit = units.size === 1 ? [...units][0] : '';
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
              <th>Item</th>
              <th>Size</th>
              <th>HSN</th>
              <th className="num">Sent</th>
              <th className="num">Rate ₹</th>
              <th className="num">Amount ₹</th>
              <th className="num">Received</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, index) => {
              const { main, sub } = splitName(l.name);
              const short = received && l.qty_received !== l.qty_sent;
              return (
                <tr key={l.id}>
                  <td className="slip-index">{index + 1}</td>
                  <td>
                    <div>{main}</div>
                    {sub && <div className="slip-sub">{sub}</div>}
                  </td>
                  <td className="slip-code">{l.size}</td>
                  <td className="slip-code">{l.hsn || '—'}</td>
                  <td className="num">{fmtNum(l.qty_sent)} <span className="slip-unit">{l.unit.toLowerCase()}</span></td>
                  <td className="num">{l.rate_paise === null ? '—' : amount(l.rate_paise)}</td>
                  <td className="num">{l.rate_paise === null ? '—' : amount(l.rate_paise * l.qty_sent)}</td>
                  <td className={`num slip-received${short ? ' differs' : ''}`}>{received ? <>{fmtNum(l.qty_received)}{short ? '' : ' ✓'}</> : ''}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td />
              <td colSpan={3}>Total · {lines.length} {lines.length === 1 ? 'item' : 'items'}</td>
              <td className="num">{fmtNum(totalSent)} <span className="slip-unit">{totalUnit}</span></td>
              <td />
              <td className="num">{amount(totalValue)}{unpriced ? ' *' : ''}</td>
              <td className={`num slip-received${received && totalReceived !== totalSent ? ' differs' : ''}`}>
                {received ? <>{fmtNum(totalReceived)}{totalReceived === totalSent ? ' ✓' : ''}</> : ''}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="slip-value">
        <span>Consignment value</span>
        <strong>{fmtMoney(totalValue)}</strong>
      </div>

      {unpriced > 0 && <p className="slip-small">* {unpriced} item(s) had no price when dispatched and are not included in the total.</p>}

      {/* Declaration, remarks and signatures stay together on one page. */}
      <div className="slip-closing">
        <section className="slip-declaration">
          <h3>We Further Declare That</h3>
          <ol>
            <li>The above material is being sent solely for product packaging purposes and is not intended for sale, resale, or any commercial transaction.</li>
            <li>The material is being sent on a sample basis.</li>
            <li>The value declared above is for transit, insurance, and record purposes only, and there is no commercial invoice value involved.</li>
            <li>All particulars stated above are true and correct to the best of our knowledge.</li>
          </ol>
          <p>
            We therefore request the concerned authorities, security, and gate personnel to kindly permit the movement and entry of the
            above-mentioned material. For any clarification, please contact the undersigned.
          </p>
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
