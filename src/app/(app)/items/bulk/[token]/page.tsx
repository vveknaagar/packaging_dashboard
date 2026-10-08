import type { Metadata } from 'next';
import Link from 'next/link';
import { discardBulkAction, importBulkAction } from '@/app/actions/items';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Forbidden, PageHead } from '@/components/ui';
import { get } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { isSuper } from '@/lib/permissions';
import { loadPreview, type PreviewManifest } from '@/lib/services/bulk';
import { requireUser } from '@/lib/session';
import { fmtNum } from '@/lib/util';

export const metadata: Metadata = { title: 'Bulk upload preview' };

export default async function BulkPreviewPage({ params }: { params: Promise<{ token: string }> }) {
  const user = await requireUser();
  if (!isSuper(user)) return <Forbidden />;
  const { token } = await params;

  let manifest: PreviewManifest;
  try {
    manifest = loadPreview(token, user);
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    return (
      <div className="card notice">
        <h1>Upload not available</h1>
        <p className="sub">{err.message}</p>
        <Link href="/items/bulk" className="btn btn-primary">Upload again</Link>
      </div>
    );
  }

  const valid = manifest.rows.filter((r) => !r.errors.length);
  const invalid = manifest.rows.length - valid.length;
  const openingUnits = valid.reduce((sum, r) => sum + (r.stock || 0), 0);
  const warehouseName = get<{ name: string }>("SELECT name FROM locations WHERE type = 'warehouse'")!.name;

  return (
    <>
      <PageHead title="Bulk upload preview" sub={`${manifest.sheetName} · nothing has been imported yet.`} />
      <div className="tiles">
        <div className="tile"><div className="tile-label">Rows in sheet</div><div className="tile-value">{fmtNum(manifest.rows.length)}</div></div>
        <div className="tile"><div className="tile-label">Ready to import</div><div className="tile-value">{fmtNum(valid.length)}</div></div>
        <div className="tile"><div className="tile-label">Rows with errors</div><div className="tile-value">{fmtNum(invalid)}</div><div className="tile-note">{invalid ? 'These will be left out' : 'None'}</div></div>
      </div>

      {invalid > 0 && (
        <div className="alert alert-warn">
          {invalid} row(s) have errors and will not be imported. Fix them in the sheet and upload again, or import the {valid.length} valid row(s) now.
        </div>
      )}
      {openingUnits > 0 && (
        <div className="alert alert-info">
          Importing will also add {fmtNum(openingUnits)} unit(s) of opening stock to {warehouseName}, from the Stock column.
        </div>
      )}

      <div className="card">
        <div className="table-wrap">
          <table className="table cards">
            <thead>
              <tr>
                <th>Row</th>
                <th>Item</th>
                <th>Unit</th>
                <th className="num">Stock</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {manifest.rows.map((row) => (
                <tr key={row.rowNo} className={row.errors.length ? 'row-error' : undefined}>
                  <td data-label="Row">{row.rowNo}</td>
                  <td className="cell-main">
                    <div className="item-cell">
                      {row.staged !== null
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img className="thumb" src={`/api/items/bulk/${token}/thumb/${row.staged}`} alt="" width={44} height={44} loading="lazy" />
                        : <span className="thumb thumb-missing" aria-hidden="true">?</span>}
                      <div>
                        <div className="item-name">{row.name || <span className="muted">(no name)</span>}</div>
                        <div className="item-size">{row.size || '(no size)'}</div>
                        <div className="muted clip">{row.imageRef}</div>
                      </div>
                    </div>
                  </td>
                  <td data-label="Unit">{row.unit || <span className="muted">—</span>}</td>
                  <td data-label="Stock" className="num">{row.stock ? fmtNum(row.stock) : <span className="muted">—</span>}</td>
                  <td data-label="Result">
                    {row.errors.length === 0
                      ? <span className="badge badge-ok">✓ Valid</span>
                      : (
                        <>
                          <span className="badge badge-rejected">✕ Error</span>
                          <ul className="error-list">{row.errors.map((e) => <li key={e}>{e}</li>)}</ul>
                        </>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="sticky-bar">
        <div><strong>{valid.length}</strong> valid, <strong>{invalid}</strong> with errors</div>
        <div className="form-actions">
          <ActionForm action={discardBulkAction} className="inline-form" toastErrors>
            <input type="hidden" name="token" value={token} />
            <SubmitButton className="btn btn-ghost">Discard</SubmitButton>
          </ActionForm>
          <ActionForm action={importBulkAction} className="inline-form" toastErrors>
            <input type="hidden" name="token" value={token} />
            <SubmitButton disabled={valid.length === 0} pendingLabel="Importing…">
              Import {valid.length} valid row(s)
            </SubmitButton>
          </ActionForm>
        </div>
      </div>
    </>
  );
}
