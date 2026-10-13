'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { logoutAction, switchUserAction } from '@/app/actions/auth';
import { Flash } from './Flash';
import { LiveRefresh } from './LiveRefresh';
import { ThemeToggle } from './ThemeToggle';
import { Tour } from './Tour';
import type { TourStep } from '@/lib/guide';

export interface NavItem {
  href: string;
  label: string;
  section?: string;
}

interface Props {
  nav: NavItem[];
  userName: string;
  roleLabel: string;
  locationName: string | null;
  unread: number;
  /** Incoming transfers waiting for this user's location to approve. */
  pending: number;
  /** Transfers from stores waiting for this Warehouse Admin (or Super Admin) to approve. */
  toApprove?: number;
  /** Only for a Super Admin: the users they can switch to, and their own name while they act as someone else. */
  switcher?: { users: { id: number; label: string }[]; currentId: number; ownerName: string | null };
  /** The guided tour of this user's menu; it opens by itself on their first visit. */
  tour: { steps: TourStep[]; autoStart: boolean };
  children: React.ReactNode;
}

/** Pick the nav entry whose path is the longest prefix of the current page. */
function activeHref(nav: NavItem[], pathname: string): string {
  let best = '';
  for (const item of nav) {
    const matches = item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (matches && item.href.length > best.length) best = item.href;
  }
  return best;
}

export function Shell({ nav, userName, roleLabel, locationName, unread, pending, toApprove = 0, switcher, tour, children }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const active = activeHref(nav, pathname);

  // Close the slide-in menu after navigating on a phone.
  useEffect(() => { setOpen(false); }, [pathname]);

  let lastSection: string | undefined;
  return (
    <div className="shell">
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/monogram-white.png" alt="" width={22} height={22} />
          </span>
          <span>Mayave<br /><small>Item Transfer</small></span>
        </div>
        <nav className="nav" aria-label="Main">
          {nav.map((item) => {
            const heading = item.section && item.section !== lastSection ? item.section : null;
            lastSection = item.section;
            return (
              <div key={item.href}>
                {heading && <div className="nav-section">{heading}</div>}
                <Link href={item.href} data-tour={item.href} className={item.href === active ? 'active' : undefined} aria-current={item.href === active ? 'page' : undefined}>
                  {item.label}
                </Link>
              </div>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <div className="who">
            <strong>{userName}</strong>
            <span>{roleLabel}{locationName ? ` · ${locationName}` : ''}</span>
          </div>
          {switcher && (
            // Remounted after each switch so the list goes back to its "Switch user" prompt.
            <form action={switchUserAction} className="switcher" key={switcher.currentId} data-tour="switcher">
              <select
                name="user_id" defaultValue="" aria-label="Switch user"
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
              >
                <option value="" disabled>Switch user…</option>
                {switcher.users.map((u) => <option key={u.id} value={u.id} disabled={u.id === switcher.currentId}>{u.label}</option>)}
              </select>
            </form>
          )}
          <Link href="/account" className="btn btn-ghost btn-sm" data-tour="account">My account</Link>
          <form action={logoutAction}>
            <button type="submit" className="btn btn-ghost btn-sm">Sign out</button>
          </form>
        </div>
      </aside>
      {open && <button type="button" className="backdrop" aria-label="Close menu" onClick={() => setOpen(false)} />}

      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="Open menu">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="topbar-title">{locationName ?? 'All locations'}</div>
          <ThemeToggle />
          {toApprove > 0 && (
            <Link href="/transfers?view=all&status=awaiting_approval" className="pending-pill">
              {toApprove} to approve
            </Link>
          )}
          {pending > 0 && (
            <Link href="/transfers?view=incoming&status=dispatched" className="pending-pill">
              {pending} pending approval
            </Link>
          )}
          <Link
            href="/notifications"
            className={`bell${pending > 0 ? ' bell-pending' : ''}`}
            data-tour="bell"
            aria-label={[unread ? `${unread} unread notifications` : 'Notifications', pending ? `${pending} pending approval` : '']
              .filter(Boolean).join(', ')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
            {unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
          </Link>
        </header>
        {switcher?.ownerName && (
          <div className="acting-bar" role="status">
            <span>You are using the app as <strong>{userName}</strong> ({roleLabel}{locationName ? ` · ${locationName}` : ''}).</span>
            <form action={switchUserAction}>
              <button type="submit" className="btn btn-sm">Back to {switcher.ownerName}</button>
            </form>
          </div>
        )}
        <main className="content">{children}</main>
      </div>
      <Tour steps={tour.steps} autoStart={tour.autoStart} setMenuOpen={setOpen} />
      <Flash />
      <LiveRefresh />
    </div>
  );
}
