import type { Metadata } from 'next';
import Link from 'next/link';
import { markNotificationsReadAction } from '@/app/actions/admin';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Empty, PageHead, StatusBadge } from '@/components/ui';
import { all } from '@/lib/db';
import { pendingApprovals } from '@/lib/services/transfers';
import { requireUser } from '@/lib/session';
import { fmtDateTime, fmtNum } from '@/lib/util';

export const metadata: Metadata = { title: 'Notifications' };

interface NotificationRow {
  id: number;
  ts: string;
  message: string;
  transfer_id: number | null;
  read_at: string | null;
  /** 1 while the linked transfer still waits for this user's location to approve it. */
  awaiting: number;
}

export default async function NotificationsPage() {
  const user = await requireUser();
  const pending = pendingApprovals(user);
  const rows = all<NotificationRow>(
    `SELECT n.id, n.ts, n.message, n.transfer_id, n.read_at,
            (t.status = 'dispatched' AND t.dest_id = ?) AS awaiting
     FROM notifications n LEFT JOIN transfers t ON t.id = n.transfer_id
     WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 100`, user.location_id ?? -1, user.id);
  const unread = rows.filter((r) => !r.read_at).length;
  const sub = [
    pending.length ? `${pending.length} pending approval` : '',
    unread ? `${unread} unread` : '',
  ].filter(Boolean).join(' · ') || 'You are up to date.';

  return (
    <>
      <PageHead title="Notifications" sub={sub}>
        {unread > 0 && (
          <ActionForm action={markNotificationsReadAction} className="inline-form" toastErrors>
            <SubmitButton className="btn">Mark all as read</SubmitButton>
          </ActionForm>
        )}
      </PageHead>

      {pending.length > 0 && (
        <section className="card card-pending">
          <div className="card-head">
            <h2>Pending your approval</h2>
            <span className="muted">Not added to your stock until you approve</span>
          </div>
          <ul className="row-list">
            {pending.map((t) => (
              <li key={t.id}>
                <Link href={`/transfers/${t.id}`} className="row-link">
                  <div>
                    <div className="row-title">{t.number} <StatusBadge status="dispatched" /></div>
                    <div className="muted">From {t.source_name} · {t.line_count} item(s), {fmtNum(t.units)} unit(s)</div>
                    <div className="muted">Sent {fmtDateTime(t.dispatched_at)}</div>
                  </div>
                  <span className="btn btn-primary btn-sm">Check &amp; approve</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="card">
        {rows.length === 0 ? <Empty>No notifications yet. Transfer updates will appear here.</Empty> : (
          <ul className="row-list">
            {rows.map((n) => (
              <li key={n.id} className={[n.read_at ? 'read' : 'unread', n.awaiting ? 'awaiting' : ''].filter(Boolean).join(' ')}>
                <div className="row-link static">
                  <div>
                    <div className="row-title">
                      {!n.read_at && <span className="dot" aria-label="Unread" />}
                      {n.awaiting ? <><StatusBadge status="dispatched" />{' '}</> : null}
                      {n.message}
                    </div>
                    <div className="muted">{fmtDateTime(n.ts)}</div>
                  </div>
                  {n.transfer_id && (
                    <Link href={`/transfers/${n.transfer_id}`} className={n.awaiting ? 'btn btn-sm btn-primary' : 'btn btn-sm'}>
                      {n.awaiting ? 'Check & approve' : 'Open transfer'}
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
