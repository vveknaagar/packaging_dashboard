import Link from 'next/link';
import { STATUS_LABELS } from '@/lib/services/transfers';
import type { TransferStatus } from '@/lib/types';
import { fmtNum, queryString, type Pager as PagerInfo } from '@/lib/util';

/** Shared, non-interactive building blocks used by the pages. */

export function PageHead({ title, sub, children }: { title: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}

export function StatusBadge({ status }: { status: TransferStatus }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABELS[status]}</span>;
}

export function ActiveBadge({ active }: { active: number | boolean }) {
  return active ? <span className="badge badge-ok">Active</span> : <span className="badge badge-off">Inactive</span>;
}

export function Thumb({ src, alt = '', size = 44, href }: { src: string; alt?: string; size?: number; href?: string }) {
  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="thumb" src={`/uploads/${src}`} alt={alt} width={size} height={size} loading="lazy" />
  );
  return href ? <a href={`/uploads/${href}`} target="_blank" rel="noreferrer" title="Open full image">{img}</a> : img;
}

export function ItemCell({ name, size, thumb, image }: { name: string; size: string; thumb: string; image?: string }) {
  return (
    <div className="item-cell">
      <Thumb src={thumb} href={image} />
      <div>
        <div className="item-name">{name}</div>
        <div className="item-size">{size}</div>
      </div>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Forbidden() {
  return (
    <div className="card notice">
      <h1>Not allowed</h1>
      <p className="sub">Your role does not have access to this screen.</p>
      <Link href="/" className="btn btn-primary">Back to dashboard</Link>
    </div>
  );
}

interface PagerProps {
  pager: PagerInfo;
  path: string;
  query: Record<string, string | number | null | undefined>;
  noun?: string;
}

export function Pager({ pager, path, query, noun = 'rows' }: PagerProps) {
  const link = (page: number) => `${path}${queryString({ ...query, page: page > 1 ? page : undefined })}`;
  return (
    <div className="pager">
      <span className="muted">{fmtNum(pager.total)} {noun}</span>
      {pager.pages > 1 && (
        <span className="pager-links">
          {pager.page > 1 ? <Link href={link(pager.page - 1)} className="btn btn-ghost btn-sm">Previous</Link> : <span className="btn btn-ghost btn-sm disabled">Previous</span>}
          <span className="muted">Page {pager.page} of {pager.pages}</span>
          {pager.page < pager.pages ? <Link href={link(pager.page + 1)} className="btn btn-ghost btn-sm">Next</Link> : <span className="btn btn-ghost btn-sm disabled">Next</span>}
        </span>
      )}
    </div>
  );
}

interface Tab {
  href: string;
  label: string;
  active: boolean;
  count?: number;
}

export function Tabs({ tabs }: { tabs: Tab[] }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <Link key={tab.href} href={tab.href} className={tab.active ? 'active' : undefined} role="tab" aria-selected={tab.active}>
          {tab.label}
          {tab.count ? <span className="tab-count">{tab.count}</span> : null}
        </Link>
      ))}
    </div>
  );
}
