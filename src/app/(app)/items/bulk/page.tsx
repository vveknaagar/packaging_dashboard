import type { Metadata } from 'next';
import Link from 'next/link';
import { BulkStockForm } from '@/components/BulkStockForm';
import { BulkUploadForm } from '@/components/BulkUploadForm';
import { Forbidden, PageHead } from '@/components/ui';
import { get } from '@/lib/db';
import { isSuper } from '@/lib/permissions';
import { requireUser } from '@/lib/session';
import { transferableItems } from '@/lib/transfer-form-data';

export const metadata: Metadata = { title: 'Bulk upload items' };

export default async function BulkUploadPage() {
  const user = await requireUser();
  if (!isSuper(user)) return <Forbidden />;
  const warehouse = (await get<{ id: number; name: string }>("SELECT id, name FROM locations WHERE type = 'warehouse'"))!;
  const items = await transferableItems(warehouse.id);

  return (
    <>
      <PageHead title="Bulk upload items" sub="Add many items at once from an Excel or CSV sheet.">
        <Link href="/items" className="btn btn-ghost">Back to items</Link>
      </PageHead>
      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>1. Fill the template</h2></div>
          <p>
            <a className="btn" href="/api/items/bulk/template?format=xlsx" download>Download Excel template</a>{' '}
            <a className="btn btn-ghost" href="/api/items/bulk/template?format=csv" download>CSV template</a>
          </p>
          <ul className="notes">
            <li><strong>Name</strong> and <strong>Size</strong> are required on every row.</li>
            <li>Unit and Stock are optional. <strong>Stock</strong> is the quantity you have now: it is added to the warehouse and shows as In stock.</li>
            <li>Pictures are not part of the sheet. Add each item&apos;s picture afterwards with <strong>Edit item</strong>.</li>
            <li>Up to 2,000 rows per sheet.</li>
            <li>Name + Size must be unique.</li>
          </ul>
        </section>
        <section className="card">
          <div className="card-head"><h2>2. Upload and preview</h2></div>
          <BulkUploadForm />
          <p className="hint">Nothing is imported at this step. You will see every row with any errors, then choose to import the valid rows.</p>
        </section>
      </div>
      <BulkStockForm warehouseName={warehouse.name} items={items} />
    </>
  );
}
