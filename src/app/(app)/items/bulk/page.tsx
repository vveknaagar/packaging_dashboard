import type { Metadata } from 'next';
import Link from 'next/link';
import { BulkUploadForm } from '@/components/BulkUploadForm';
import { Forbidden, PageHead } from '@/components/ui';
import { isSuper } from '@/lib/permissions';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Bulk upload items' };

export default async function BulkUploadPage() {
  const user = await requireUser();
  if (!isSuper(user)) return <Forbidden />;

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
            <li><strong>Name</strong>, <strong>Size</strong> and <strong>Image</strong> are required on every row.</li>
            <li>Unit and Stock are optional. <strong>Stock</strong> is the quantity you have now: it is added to the warehouse and shows as In stock.</li>
            <li>Image is either a file name (for example <code>kraft-box-small.jpg</code>) or a web address starting with <code>https://</code>.</li>
            <li>For file names, put the pictures in one ZIP and upload it with the sheet.</li>
            <li>Images: JPG, PNG, WebP or GIF, up to 2 MB each. Up to 2,000 rows per sheet.</li>
            <li>Name + Size must be unique.</li>
          </ul>
        </section>
        <section className="card">
          <div className="card-head"><h2>2. Upload and preview</h2></div>
          <BulkUploadForm />
          <p className="hint">Nothing is imported at this step. You will see every row with any errors, then choose to import the valid rows.</p>
        </section>
      </div>
    </>
  );
}
