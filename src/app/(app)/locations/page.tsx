import type { Metadata } from 'next';
import Link from 'next/link';
import { setLocationStatusAction } from '@/app/actions/admin';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { ActiveBadge, Forbidden, PageHead } from '@/components/ui';
import { all } from '@/lib/db';
import { isStore, isSuper } from '@/lib/permissions';
import { allContacts } from '@/lib/services/locations';
import { requireUser } from '@/lib/session';
import type { LocationRow } from '@/lib/types';
import { fmtNum } from '@/lib/util';

export const metadata: Metadata = { title: 'Locations' };

interface LocationListRow extends LocationRow {
  units: number;
}

export default async function LocationsPage() {
  const user = await requireUser();
  if (isStore(user)) return <Forbidden />;
  const canManage = isSuper(user);

  const locations = await all<LocationListRow>(
    `SELECT l.*, (SELECT COALESCE(SUM(qty), 0) FROM stock s WHERE s.location_id = l.id) AS units
     FROM locations l
     ORDER BY (l.type = 'warehouse') DESC, l.active DESC, l.name`);
  // Contact person and phone come from each location's admin, not from the location itself.
  const contacts = await allContacts();

  return (
    <>
      <PageHead title="Locations" sub="One central warehouse and the stores it supplies.">
        {canManage && <Link href="/locations/new" className="btn btn-primary">Add store</Link>}
      </PageHead>
      <div className="card">
        <div className="table-wrap">
          <table className="table cards cards-wide">
            <thead>
              <tr>
                <th>Location</th>
                <th>Address</th>
                <th>Contact (admin)</th>
                <th className="num">Stock (units)</th>
                <th>Status</th>
                {canManage && <th><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {locations.map((l) => {
                const people = contacts.get(l.id) ?? [];
                return (
                  <tr key={l.id} className={l.active ? undefined : 'inactive'}>
                    <td className="cell-main">
                      <div className="item-name">{l.name}</div>
                      <div className="item-size">{l.code} · {l.type === 'warehouse' ? 'Warehouse' : 'Store'}</div>
                    </td>
                    <td data-label="Address">
                      {l.address || <span className="muted">—</span>}
                      {l.gstin ? <div className="muted">GSTIN {l.gstin}</div> : l.type === 'store' && <div className="warn-text">! GSTIN missing</div>}
                    </td>
                    <td data-label="Contact (admin)">
                      {people.length ? people.map((p) => (
                        <div key={`${p.name}-${p.phone}`}>
                          {p.name}
                          {p.phone ? <> · <a href={`tel:${p.phone.replace(/[^0-9+]/g, '')}`}>{p.phone}</a></> : <span className="muted"> · no phone</span>}
                        </div>
                      )) : (
                        <span className="warn-text">
                          ! No admin assigned
                          {canManage && l.type === 'store' && <> · <Link href={`/users/new?store=${l.id}`}>Add one</Link></>}
                          {canManage && l.type === 'warehouse' && <> · <Link href="/users/new?role=warehouse_admin">Add one</Link></>}
                        </span>
                      )}
                    </td>
                    <td data-label="Stock (units)" className="num"><Link href={`/stock?location=${l.id}`}>{fmtNum(l.units)}</Link></td>
                    <td data-label="Status"><ActiveBadge active={l.active} /></td>
                    {canManage && (
                      <td className="cell-actions">
                        <Link href={`/locations/${l.id}/edit`} className="btn btn-sm">Edit</Link>
                        {l.type === 'store' && (
                          <ActionForm
                            action={setLocationStatusAction}
                            className="inline-form" toastErrors
                            confirm={l.active ? `Deactivate ${l.name}? It will no longer be able to send or receive transfers.` : undefined}
                          >
                            <input type="hidden" name="id" value={l.id} />
                            <input type="hidden" name="active" value={l.active ? '0' : '1'} />
                            <SubmitButton className="btn btn-sm btn-ghost">{l.active ? 'Deactivate' : 'Activate'}</SubmitButton>
                          </ActionForm>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
