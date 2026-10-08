import fs from 'node:fs';
import path from 'node:path';

// The data folder is chosen at run time, so the bundler must not try to trace it.
const DATA_DIR = path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const ITEM_IMG_DIR = path.join(UPLOAD_DIR, 'items');
const TMP_DIR = path.join(DATA_DIR, 'tmp');
const BULK_DIR = path.join(TMP_DIR, 'bulk');

let dirsReady = false;

/** Create the data folders on first use (not at import time, so builds stay side-effect free). */
export function ensureDataDirs(): void {
  if (dirsReady) return;
  for (const dir of [DATA_DIR, UPLOAD_DIR, ITEM_IMG_DIR, TMP_DIR, BULK_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  dirsReady = true;
}

export const config = {
  DATA_DIR,
  UPLOAD_DIR,
  ITEM_IMG_DIR,
  TMP_DIR,
  BULK_DIR,
  DB_FILE: path.join(DATA_DIR, 'packaging.db'),
  /** Set COOKIE_SECURE=1 when the app is only served over HTTPS. */
  COOKIE_SECURE: process.env.COOKIE_SECURE === '1',
  MAX_IMAGE_BYTES: 2 * 1024 * 1024,
  MAX_SHEET_BYTES: 5 * 1024 * 1024,
  MAX_ZIP_BYTES: 200 * 1024 * 1024,
  MAX_BULK_ROWS: 2000,
};

export const APP_NAME = 'Packaging Inventory & Stock Transfer';
