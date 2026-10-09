import { get } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Is the app configured and can it reach its database? For checking a
 * deployment. Never shows the connection string or password.
 */
export async function GET() {
  const url = process.env.DATABASE_URL ?? '';
  let database: { host: string; port: string } | null = null;
  try {
    const parsed = new URL(url);
    database = { host: parsed.hostname, port: parsed.port };
  } catch { /* not set, or not a URL */ }

  const report: Record<string, unknown> = {
    databaseUrlSet: url !== '',
    database,
    onVercel: !!process.env.VERCEL,
  };
  const started = Date.now();
  try {
    await get('SELECT 1');
    report.database_ok = true;
  } catch (err) {
    report.database_ok = false;
    report.error = err instanceof Error ? err.message : String(err);
  }
  report.ms = Date.now() - started;
  return Response.json(report, { status: report.database_ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
