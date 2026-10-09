import { readStored } from '@/lib/services/images';
import { getUser } from '@/lib/session';

/** Serves item images to signed-in users only. */
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (!(await getUser())) return new Response('Sign in required', { status: 401 });
  // Only names the app generated itself are ever looked up.
  const data = await readStored((await params).path.join('/'));
  if (!data) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': 'image/webp',
      // Names are random and never reused, so the browser can keep them.
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
}
