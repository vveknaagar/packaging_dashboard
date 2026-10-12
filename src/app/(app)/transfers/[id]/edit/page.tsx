import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TransferForm } from '@/components/TransferForm';
import { PageHead } from '@/components/ui';
import { isSourceUser, isSuper } from '@/lib/permissions';
import { listPartners } from '@/lib/services/logistics';
import { getLines, getTransfer } from '@/lib/services/transfers';
import { requireUser } from '@/lib/session';
import { destinationsFor, transferableItems } from '@/lib/transfer-form-data';
import { parseId } from '@/lib/util';

export const metadata: Metadata = { title: 'Edit draft transfer' };

/** Only the source location can edit, and only while the transfer is still a draft. */
export default async function EditTransferPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = parseId((await params).id);
  const transfer = id ? await getTransfer(id) : undefined;
  if (!transfer || !isSourceUser(user, transfer) || transfer.status !== 'draft') notFound();

  const lines = await getLines(transfer.id);
  return (
    <>
      <PageHead title={`Edit draft ${transfer.number}`} sub={`From ${transfer.source_name}`} />
      <TransferForm
        sourceName={transfer.source_name}
        stockLabel={isSuper(user) ? 'In stock' : undefined}
        destinations={await destinationsFor(transfer.source_id)}
        partners={await listPartners(true)}
        items={await transferableItems(transfer.source_id)}
        transferId={transfer.id}
        needsApproval={transfer.source_type === 'store'}
        initialDestId={transfer.dest_id}
        initialNote={transfer.note}
        initialTransportMode={transfer.transport_mode}
        initialTransportRef={transfer.transport_ref}
        initialPartnerId={transfer.logistics_partner_id}
        initialQty={Object.fromEntries(lines.map((l) => [l.item_id, l.qty_sent]))}
      />
    </>
  );
}
