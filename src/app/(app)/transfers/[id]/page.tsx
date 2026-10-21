import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  approveTransferAction, cancelTransferAction, declineTransferAction, dispatchTransferAction, rejectTransferAction, sendForApprovalAction,
} from '@/app/actions/stock';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { ChallanButtons } from '@/components/ChallanButtons';
import { ReasonDialogButton } from '@/components/ReasonDialogButton';
import { ReceiveForm } from '@/components/ReceiveForm';
import { ParcelPhotoInput } from '@/components/ParcelPhotoInput';
import { ItemCell, PageHead, StatusBadge } from '@/components/ui';
import { now, run } from '@/lib/db';
import { canApproveTransfers, canViewTransfer, isDestUser, isSourceUser } from '@/lib/permissions';
import { EVENT_LABELS, getEvents, getLines, getTransfer } from '@/lib/services/transfers';
import { requireUser } from '@/lib/session';
import { TRANSPORT_MODES } from '@/lib/transport';
import { fmtDateTime, fmtNum, parseId, priceInput } from '@/lib/util';

export const metadata: Metadata = { title: 'Transfer' };

export default async function TransferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = parseId((await params).id);
  const t = id ? await getTransfer(id) : undefined;
  // A transfer the user may not see is reported exactly like one that does not exist.
  if (!t || !canViewTransfer(user, t)) notFound();

  // A Super Admin looking through someone else's account must not use up that person's unread notifications.
  // Independent lookups go to the database together rather than one after another.
  const [, lines, events] = await Promise.all([
    user.switched_from ? undefined
      : run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND transfer_id = ? AND read_at IS NULL', now(), user.id, t.id),
    getLines(t.id),
    getEvents(t.id),
  ]);
  const asSource = isSourceUser(user, t);
  const asDest = isDestUser(user, t);
  const received = t.status === 'completed' || t.status === 'discrepancy';
  const unitsSent = lines.reduce((n, l) => n + l.qty_sent, 0);
  const unitsReceived = lines.reduce((n, l) => n + (l.qty_received ?? 0), 0);
  const canReceive = asDest && t.status === 'dispatched';
  // A store's transfer is approved by the warehouse before it can be dispatched.
  const fromStore = t.source_type === 'store';
  const canApprove = canApproveTransfers(user) && t.status === 'awaiting_approval';

  return (
    <>
      <PageHead title={t.number} sub={<>{t.source_name} → {t.dest_name}</>}>
        <StatusBadge status={t.status} />
        {t.dispatched_at && <ChallanButtons transferId={t.id} initialAmount={priceInput(t.challan_amount_paise)} initialQty={t.challan_qty ? String(t.challan_qty) : ''} canSetAmount={asSource} />}
      </PageHead>

      {t.status === 'awaiting_approval' && (
        <div className={canApprove ? 'alert alert-warn' : 'alert alert-info'} role="status">
          <strong>Awaiting warehouse approval.</strong> Nothing has left {t.source_name} yet.
          {canApprove ? ' Check the items below, then approve or decline it.' : ' It can be dispatched once the warehouse approves it.'}
        </div>
      )}
      {t.status === 'approved' && (
        <div className="alert alert-info" role="status">
          <strong>Approved by the warehouse</strong>{t.approved_by_name ? ` (${t.approved_by_name})` : ''}.
          {' '}{t.source_name} can now pack it and dispatch it with a photo of the parcel.
        </div>
      )}
      {t.status === 'declined' && (
        <div className="alert alert-info" role="status">
          <strong>Declined by the warehouse.</strong> No stock had been moved.{t.closed_reason ? ` Reason: ${t.closed_reason}` : ''}
        </div>
      )}
      {t.status === 'dispatched' && (
        <div className={canReceive ? 'alert alert-warn' : 'alert alert-info'} role="status">
          <strong>Pending approval.</strong> {fmtNum(unitsSent)} unit(s) were deducted from {t.source_name} and will be added
          to {t.dest_name} only when it checks and approves them.
          {canReceive && ' Count what arrived below, then approve, or reject the transfer if it is wrong.'}
        </div>
      )}
      {t.status === 'discrepancy' && (
        <div className="alert alert-warn" role="status">
          <strong>Received with discrepancy.</strong> Sent {fmtNum(unitsSent)}, received {fmtNum(unitsReceived)}.
          Only the received quantities were added to {t.dest_name}. Remark: {t.receive_remark}
        </div>
      )}
      {(t.status === 'rejected' || t.status === 'cancelled') && (
        <div className="alert alert-info" role="status">
          <strong>{t.status === 'rejected' ? `Rejected by ${t.dest_name}.` : 'Cancelled.'}</strong>{' '}
          {t.dispatched_at ? `The stock was returned to ${t.source_name}.` : 'No stock had been moved.'}
          {t.closed_reason ? ` Reason: ${t.closed_reason}` : ''}
        </div>
      )}

      <div className="grid-2 detail-grid">
        <div className="stack">
          {canReceive ? (
            <section className="card">
              <div className="card-head">
                <h2>Check and approve</h2>
                <span className="muted">Count what arrived, then approve</span>
              </div>
              <ReceiveForm
                transferId={t.id}
                lines={lines.map((l) => ({ id: l.id, name: l.name, size: l.size, unit: l.unit, thumb: l.thumb, qty_sent: l.qty_sent }))}
              />
              <div className="card-foot">
                <span className="muted">Wrong delivery? Reject it and the stock returns to {t.source_name}.</span>
                <ReasonDialogButton
                  action={rejectTransferAction} id={t.id}
                  buttonLabel="Reject transfer" buttonClass="btn btn-danger-ghost"
                  title={`Reject ${t.number}`}
                  description={`Nothing will be added to your stock. All ${fmtNum(unitsSent)} unit(s) return to ${t.source_name}.`}
                  submitLabel="Reject transfer"
                />
              </div>
            </section>
          ) : (
            <section className="card">
              <div className="card-head"><h2>Items</h2><span className="muted">{lines.length} item(s), {fmtNum(unitsSent)} unit(s) sent</span></div>
              <div className="table-wrap">
                <table className="table cards">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="num">Sent</th>
                      {received && <th className="num">Received</th>}
                      {received && <th className="num">Difference</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => {
                      const diff = (l.qty_received ?? 0) - l.qty_sent;
                      return (
                        <tr key={l.id}>
                          <td className="cell-main"><ItemCell name={l.name} size={l.size} thumb={l.thumb} image={l.image} /></td>
                          <td data-label="Sent" className="num">{fmtNum(l.qty_sent)} <span className="muted">{l.unit}</span></td>
                          {received && <td data-label="Received" className="num"><strong>{fmtNum(l.qty_received)}</strong></td>}
                          {received && (
                            <td data-label="Difference" className={`num${diff ? ' differs-text' : ''}`}>
                              {diff === 0 ? <span className="muted">—</span> : <strong>{diff > 0 ? '+' : '−'}{fmtNum(Math.abs(diff))} {diff < 0 ? 'short' : 'excess'}</strong>}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {canApprove && (
            <section className="card card-pending">
              <div className="card-head">
                <h2>Warehouse approval</h2>
                <span className="muted">{t.source_name} → {t.dest_name}</span>
              </div>
              <p className="sub">
                Approve and {t.source_name} can dispatch these {fmtNum(unitsSent)} unit(s). Decline and the transfer closes; nothing moves.
              </p>
              <div className="form-actions start">
                <ActionForm action={approveTransferAction} className="inline-form" confirm={`Approve ${t.number}?`}>
                  <input type="hidden" name="id" value={t.id} />
                  <SubmitButton pendingLabel="Approving…">Approve</SubmitButton>
                </ActionForm>
                <ReasonDialogButton
                  action={declineTransferAction} id={t.id}
                  buttonLabel="Decline" buttonClass="btn btn-danger-ghost"
                  title={`Decline ${t.number}`}
                  description={`${t.source_name} will be told why. No stock is affected.`}
                  submitLabel="Decline transfer"
                />
              </div>
            </section>
          )}

          {asSource && t.status === 'draft' && (
            <section className="card">
              <div className="card-head"><h2>Draft</h2><span className="muted">No stock has moved yet</span></div>
              <div className="form-actions start">
                <Link href={`/transfers/${t.id}/edit`} className="btn">Edit draft</Link>
                <ReasonDialogButton
                  action={cancelTransferAction} id={t.id}
                  buttonLabel="Cancel draft" buttonClass="btn btn-danger-ghost"
                  title={`Cancel ${t.number}`} description="This draft will be closed. No stock is affected."
                  reasonRequired={false} submitLabel="Cancel draft"
                />
              </div>
              {fromStore ? (
                <ActionForm
                  action={sendForApprovalAction} className="stack"
                  confirm={`Send ${t.number} for warehouse approval? Nothing leaves ${t.source_name} until it is approved and dispatched.`}
                >
                  <input type="hidden" name="id" value={t.id} />
                  <h3>Send for approval</h3>
                  <p className="sub">The warehouse approves transfers from stores before they are dispatched.</p>
                  <div className="form-actions start">
                    <SubmitButton pendingLabel="Sending…">Send for approval</SubmitButton>
                  </div>
                </ActionForm>
              ) : <DispatchForm id={t.id} number={t.number} units={unitsSent} sourceName={t.source_name} />}
            </section>
          )}

          {asSource && (t.status === 'awaiting_approval' || t.status === 'approved') && (
            <section className="card">
              <div className="card-head">
                <h2>{t.status === 'approved' ? 'Ready to dispatch' : 'Waiting for the warehouse'}</h2>
                <span className="muted">No stock has moved yet</span>
              </div>
              {t.status === 'approved' && <DispatchForm id={t.id} number={t.number} units={unitsSent} sourceName={t.source_name} />}
              <div className="form-actions start">
                <ReasonDialogButton
                  action={cancelTransferAction} id={t.id}
                  buttonLabel="Cancel transfer" buttonClass="btn btn-danger-ghost"
                  title={`Cancel ${t.number}`} description="The transfer will be closed. No stock is affected."
                  reasonRequired={false} submitLabel="Cancel transfer"
                />
              </div>
            </section>
          )}
          {asSource && t.status === 'dispatched' && (
            <section className="card">
              <div className="card-head"><h2>Cancel before receipt</h2></div>
              <p className="sub">Until {t.dest_name} receives it, you can cancel this transfer and the stock returns to {t.source_name}.</p>
              <ReasonDialogButton
                action={cancelTransferAction} id={t.id}
                buttonLabel="Cancel transfer" buttonClass="btn btn-danger-ghost"
                title={`Cancel ${t.number}`}
                description={`All ${fmtNum(unitsSent)} unit(s) will be returned to ${t.source_name}.`}
                submitLabel="Cancel transfer"
              />
            </section>
          )}
        </div>

        <div className="stack">
          <section className="card">
            <div className="card-head"><h2>Details</h2></div>
            <dl className="details">
              <dt>From</dt><dd>{t.source_name} ({t.source_code})</dd>
              <dt>To</dt><dd>{t.dest_name} ({t.dest_code})</dd>
              {t.transport_mode && (
                <><dt>Transport</dt><dd>{TRANSPORT_MODES[t.transport_mode] ?? t.transport_mode}{t.transport_ref ? ` · ${t.transport_ref}` : ''}</dd></>
              )}
              {t.partner_name && (
                <><dt>Logistic partner</dt><dd>{t.partner_name}{t.partner_phone ? ` · ${t.partner_phone}` : ''}</dd></>
              )}
              <dt>Created</dt><dd>{fmtDateTime(t.created_at)} by {t.created_by_name}</dd>
              {t.approved_at && <><dt>Approved</dt><dd>{fmtDateTime(t.approved_at)} by {t.approved_by_name}</dd></>}
              {t.dispatched_at && <><dt>Dispatched</dt><dd>{fmtDateTime(t.dispatched_at)} by {t.dispatched_by_name}</dd></>}
              {t.parcel_image && (
                <><dt>Parcel photo</dt><dd>
                  <a href={`/uploads/${t.parcel_image}`} target="_blank" rel="noopener" title="Open the full photo">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="parcel-photo" src={`/uploads/${t.parcel_image}`} alt={`Parcel for ${t.number}`} loading="lazy" />
                  </a>
                </dd></>
              )}
              {t.received_at && <><dt>Received</dt><dd>{fmtDateTime(t.received_at)} by {t.received_by_name}</dd></>}
              {t.closed_at && <><dt>{t.status === 'rejected' ? 'Rejected' : t.status === 'declined' ? 'Declined' : 'Cancelled'}</dt><dd>{fmtDateTime(t.closed_at)} by {t.closed_by_name}</dd></>}
              {t.note && <><dt>Note</dt><dd>{t.note}</dd></>}
              {t.receive_remark && <><dt>Receiver remark</dt><dd>{t.receive_remark}</dd></>}
              {t.closed_reason && <><dt>Reason</dt><dd>{t.closed_reason}</dd></>}
            </dl>
          </section>

          <section className="card">
            <div className="card-head"><h2>Timeline</h2></div>
            <ol className="timeline">
              {events.map((e) => (
                <li key={e.id}>
                  <div className="timeline-title">{EVENT_LABELS[e.event] ?? e.event}</div>
                  <div className="muted">{fmtDateTime(e.ts)} · {e.user_name}</div>
                  {e.detail && <div className="timeline-detail">{e.detail}</div>}
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </>
  );
}

/** The sender photographs the packed parcel and dispatches it: the stock leaves the source and is in transit. */
function DispatchForm({ id, number, units, sourceName }: { id: number; number: string; units: number; sourceName: string }) {
  return (
    <ActionForm
      action={dispatchTransferAction} className="stack"
      confirm={`Dispatch ${number}? ${fmtNum(units)} unit(s) will be deducted from ${sourceName} and shown as in transit.`}
    >
      <input type="hidden" name="id" value={id} />
      <h3>Dispatch</h3>
      <div className="field">
        <span>Parcel photo</span>
        <ParcelPhotoInput required />
      </div>
      <div className="form-actions start">
        <SubmitButton pendingLabel="Dispatching…">Dispatch</SubmitButton>
      </div>
    </ActionForm>
  );
}
