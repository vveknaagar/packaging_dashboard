import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '@/lib/config';
import { STORED_IMAGE_PATTERN } from '@/lib/services/images';
import { getUser } from '@/lib/session';

/** Serves item images to signed-in users only. */
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (!(await getUser())) return new Response('Sign in required', { status: 401 });
  const relative = (await params).path.join('/');
  // Only names the app generated itself are ever read from disk.
  if (!STORED_IMAGE_PATTERN.test(relative)) return new Response('Not found', { status: 404 });
  try {
    const data = await fs.readFile(path.join(config.UPLOAD_DIR, relative));
    return new Response(new Uint8Array(data), {
      headers: {
        'Content-Type': 'image/webp',
        // File names are random and never reused, so the browser can keep them.
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
