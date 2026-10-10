import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Everything lasting (data, pictures) is in the database. This folder only holds
// uploaded files while one request reads them. On Vercel only /tmp is writable.
// The folder is chosen at run time, so the bundler must not try to trace it.
const DEFAULT_DATA_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), 'packaging')
  : path.join(/* turbopackIgnore: true */ process.cwd(), 'data');
const DATA_DIR = path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR || DEFAULT_DATA_DIR);
const TMP_DIR = path.join(DATA_DIR, 'tmp');

let dirsReady = false;

/** Create the data folders on first use (not at import time, so builds stay side-effect free). */
export function ensureDataDirs(): void {
  if (dirsReady) return;
  for (const dir of [DATA_DIR, TMP_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  dirsReady = true;
}

export const config = {
  DATA_DIR,
  TMP_DIR,
  /** Postgres connection string: the Supabase "Session pooler" URI (Connect button in the dashboard). */
  DATABASE_URL: process.env.DATABASE_URL || '',
  /** Most connections the server keeps open to the database. */
  DATABASE_POOL_MAX: Number(process.env.DATABASE_POOL_MAX) || 10,
  /** Set COOKIE_SECURE=1 when the app is only served over HTTPS. */
  COOKIE_SECURE: process.env.COOKIE_SECURE === '1',
  MAX_IMAGE_BYTES: 2 * 1024 * 1024,
  MAX_SHEET_BYTES: 5 * 1024 * 1024,
  MAX_BULK_ROWS: 2000,
};

export const APP_NAME = 'Mayave Item Transfer';
