import { AppError } from '@/lib/errors';
import { stagedThumb } from '@/lib/services/bulk';
import { getUser } from '@/lib/session';

/** Thumbnail of an image staged by a bulk upload preview. Only the uploader can see it. */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string; index: string }> }) {
  const user = await getUser();
  if (!user) return new Response('Sign in required', { status: 401 });
  const { token, index } = await params;
  try {
    const data = await stagedThumb(token, user, index);
    return new Response(new Uint8Array(data), {
      headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=600' },
    });
  } catch (err) {
    if (err instanceof AppError) return new Response('Not found', { status: 404 });
    throw err;
  }
}
