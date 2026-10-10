import type { Metadata } from 'next';
import Link from 'next/link';
import { savePartnerAction, setPartnerStatusAction } from '@/app/actions/admin';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { ActiveBadge, Empty, Forbidden, PageHead } from '@/components/ui';
import { all } from '@/lib/db';
import { isSuper } from '@/lib/permissions';
import { listPartners } from '@/lib/services/logistics';
import { requireUser } from '@/lib/session';
import { param, parseId } from '@/lib/util';

export const metadata: Metadata = { title: 'Logistic partners' };

/** The courier and transport companies senders choose from on a transfer. Only the Super Admin changes this list. */
export default async function LogisticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (!isSuper(user)) return <Forbidden />;
  const editId = parseId(param((await searchParams).edit));

  const [partners, usage] = await Promise.all([
    listPartners(),
    all<{ id: number; n: number }>('SELECT logistics_partner_id AS id, COUNT(*) AS n FROM transfers WHERE logistics_partner_id IS NOT NULL GROUP BY logistics_partner_id'),
  ]);
  const used = new Map(usage.map((u) => [u.id, u.n]));
  const editing = editId ? partners.find((p) => p.id === editId) : undefined;

  return (
    <>
      <PageHead title="Logistic partners" sub="Courier and transport companies. Senders pick one when they create a transfer; only you can change this list." />

      <section className="card">
        <div className="card-head">
          <h2>{editing ? `Edit ${editing.name}` : 'Add a logistic partner'}</h2>
          {editing && <Link href="/logistics">Cancel</Link>}
        </div>
        {/* Keyed so the boxes refill when another partner is chosen for editing. */}
        <ActionForm key={editing?.id ?? 'new'} action={savePartnerAction} className="stack">
          {editing && <input type="hidden" name="id" value={editing.id} />}
          <div className="form-grid">
          <label className="field">
            <span>Name</span>
            <input type="text" name="name" required maxLength={80} defaultValue={editing?.name} placeholder="e.g. Blue Dart" />
          </label>
          <label className="field">
            <span>Contact person (optional)</span>
            <input type="text" name="contact" maxLength={80} defaultValue={editing?.contact} />
          </label>
          <label className="field">
            <span>Phone (optional)</span>
            <input name="phone" type="tel" maxLength={30} defaultValue={editing?.phone} />
          </label>
          </div>
          <div className="form-actions start">
            <SubmitButton pendingLabel="Saving…">{editing ? 'Save changes' : 'Add partner'}</SubmitButton>
          </div>
        </ActionForm>
      </section>

      <div className="card">
        {partners.length === 0 ? <Empty>No logistic partners yet. Add the companies you send parcels with.</Empty> : (
          <div className="table-wrap">
            <table className="table cards">
              <thead>
                <tr>
                  <th>Partner</th>
                  <th>Contact</th>
                  <th className="num">Transfers</th>
                  <th>Status</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {partners.map((p) => (
                  <tr key={p.id} className={p.active ? undefined : 'inactive'}>
                    <td className="cell-main"><div className="item-name">{p.name}</div></td>
                    <td data-label="Contact">
                      {[p.contact, p.phone].filter(Boolean).join(' · ') || <span className="muted">—</span>}
                    </td>
                    <td data-label="Transfers" className="num">{used.get(p.id) ?? 0}</td>
                    <td data-label="Status"><ActiveBadge active={p.active} /></td>
                    <td className="cell-actions">
                      <Link href={`/logistics?edit=${p.id}`} className="btn btn-sm">Edit</Link>
                      <ActionForm
                        action={setPartnerStatusAction} className="inline-form" toastErrors
                        confirm={p.active ? `Deactivate ${p.name}? Senders will no longer be able to choose it. Past transfers keep it.` : undefined}
                      >
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="active" value={p.active ? '0' : '1'} />
                        <SubmitButton className="btn btn-sm btn-ghost">{p.active ? 'Deactivate' : 'Activate'}</SubmitButton>
                      </ActionForm>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
