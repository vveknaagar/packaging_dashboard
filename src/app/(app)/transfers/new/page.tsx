import type { Metadata } from 'next';
import Link from 'next/link';
import { TransferForm } from '@/components/TransferForm';
import { Forbidden, PageHead } from '@/components/ui';
import { all } from '@/lib/db';
import { canCreateTransfer, isSuper } from '@/lib/permissions';
import { listPartners } from '@/lib/services/logistics';
import { requireUser } from '@/lib/session';
import { destinationsFor, transferableItems } from '@/lib/transfer-form-data';
import { param, parseId } from '@/lib/util';

export const metadata: Metadata = { title: 'New transfer' };

export default async function NewTransferPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (!canCreateTransfer(user)) return <Forbidden />;

  // The Super Admin has no location of their own, so they choose where to send from (the warehouse first).
  const sources = isSuper(user)
    ? await all<{ id: number; name: string }>("SELECT id, name FROM locations WHERE active = 1 ORDER BY (type = 'warehouse') DESC, name")
    : undefined;
  const from = parseId(param((await searchParams).from));
  const source = sources ? sources.find((s) => s.id === from) ?? sources.at(0) : { id: user.location_id!, name: user.location_name ?? '' };
  if (!source) return <Forbidden />;
  const sourceId = source.id;
  const destinations = await destinationsFor(sourceId);

  return (
    <>
      <PageHead title="New transfer" sub={`Send stock from ${source.name} to a store.`} />
      {destinations.length === 0 ? (
        <div className="card notice">
          <p>There are no active stores to send to yet.</p>
          <Link href="/transfers" className="btn">Back to transfers</Link>
        </div>
      ) : (
        <TransferForm
          key={sourceId}
          sourceName={source.name} sources={sources} sourceId={sourceId} stockLabel={sources ? 'In stock' : undefined}
          destinations={destinations} items={await transferableItems(sourceId)} partners={await listPartners(true)}
        />
      )}
    </>
  );
}
