import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cancelTransferAction, dispatchTransferAction, rejectTransferAction } from '@/app/actions/stock';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { ReasonDialogButton } from '@/components/ReasonDialogButton';
import { ReceiveForm } from '@/components/ReceiveForm';
import { ItemCell, PageHead, StatusBadge } from '@/components/ui';
import { now, run } from '@/lib/db';
import { canViewTransfer, isDestUser, isSourceUser } from '@/lib/permissions';
import { EVENT_LABELS, getEvents, getLines, getTransfer } from '@/lib/services/transfers';
import { requireUser } from '@/lib/session';
import { TRANSPORT_MODES } from '@/lib/transport';
import { fmtDateTime, fmtNum, parseId } from '@/lib/util';

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

  return (
    <>
      <PageHead title={t.number} sub={<>{t.source_name} → {t.dest_name}</>}>
        <StatusBadge status={t.status} />
        {t.status !== 'draft' && <Link href={`/transfers/${t.id}/slip`} className="btn" target="_blank">Transfer slip</Link>}
      </PageHead>

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

          {asSource && t.status === 'draft' && (
            <section className="card">
              <div className="card-head"><h2>Draft</h2><span className="muted">No stock has moved yet</span></div>
              <div className="form-actions start">
                <ActionForm
                  action={dispatchTransferAction} className="inline-form" toastErrors
                  confirm={`Dispatch ${t.number}? ${fmtNum(unitsSent)} unit(s) will be deducted from ${t.source_name} and shown as in transit.`}
                >
                  <input type="hidden" name="id" value={t.id} />
                  <SubmitButton pendingLabel="Dispatching…">Dispatch</SubmitButton>
                </ActionForm>
                <Link href={`/transfers/${t.id}/edit`} className="btn">Edit draft</Link>
                <ReasonDialogButton
                  action={cancelTransferAction} id={t.id}
                  buttonLabel="Cancel draft" buttonClass="btn btn-danger-ghost"
                  title={`Cancel ${t.number}`} description="This draft will be closed. No stock is affected."
                  reasonRequired={false} submitLabel="Cancel draft"
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
              <dt>Created</dt><dd>{fmtDateTime(t.created_at)} by {t.created_by_name}</dd>
              {t.dispatched_at && <><dt>Dispatched</dt><dd>{fmtDateTime(t.dispatched_at)} by {t.dispatched_by_name}</dd></>}
              {t.received_at && <><dt>Received</dt><dd>{fmtDateTime(t.received_at)} by {t.received_by_name}</dd></>}
              {t.closed_at && <><dt>{t.status === 'rejected' ? 'Rejected' : 'Cancelled'}</dt><dd>{fmtDateTime(t.closed_at)} by {t.closed_by_name}</dd></>}
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
