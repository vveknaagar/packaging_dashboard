import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config, ensureDataDirs } from '@/lib/config';
import { AppError } from '@/lib/errors';
import { isSuper } from '@/lib/permissions';
import { buildPreview } from '@/lib/services/bulk';
import { getUser } from '@/lib/session';

const json = (body: unknown, status = 200) => Response.json(body, { status });

/** The request must come from a page of this app (same check server actions get automatically). */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function saveUpload(file: File, extension: string): Promise<string> {
  ensureDataDirs();
  const target = path.join(config.TMP_DIR, `${crypto.randomBytes(12).toString('hex')}${extension}`);
  await pipeline(Readable.fromWeb(file.stream() as import('node:stream/web').ReadableStream), fs.createWriteStream(target));
  return target;
}

/**
 * Bulk upload, step 1: receive the sheet, validate every row and answer with
 * a preview token. This is a plain upload endpoint with its own checks.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: 'Request blocked: it did not come from this application.' }, 403);
  const user = await getUser();
  if (!user) return json({ error: 'Your session has ended. Please sign in again.' }, 401);
  if (!isSuper(user)) return json({ error: 'Only the Super Admin can upload items.' }, 403);

  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > config.MAX_SHEET_BYTES + 64 * 1024) {
    return json({ error: 'The upload is too large. Split the import into smaller batches.' }, 413);
  }

  const temp: string[] = [];
  try {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new AppError('The upload could not be read. Please try again.');
    }
    const sheet = form.get('sheet');
    if (!(sheet instanceof File) || sheet.size === 0) throw new AppError('Choose the item sheet (.xlsx or .csv).');
    if (sheet.size > config.MAX_SHEET_BYTES) throw new AppError('The sheet is larger than 5 MB.');
    const sheetExt = path.extname(sheet.name).toLowerCase();
    if (sheetExt !== '.xlsx' && sheetExt !== '.csv') throw new AppError('Upload the item sheet as an .xlsx or .csv file.');

    const sheetPath = await saveUpload(sheet, sheetExt);
    temp.push(sheetPath);

    const token = await buildPreview({ user, sheetPath, sheetName: sheet.name });
    return json({ token });
  } catch (err) {
    if (err instanceof AppError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: 'Something went wrong while reading the upload.' }, 500);
  } finally {
    for (const file of temp) fs.rm(file, { force: true }, () => {});
  }
}
