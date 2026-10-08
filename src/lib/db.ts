import Database from 'better-sqlite3';
import { config, ensureDataDirs } from './config';

type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS locations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL CHECK (type IN ('warehouse','store')),
  name       TEXT NOT NULL,
  code       TEXT NOT NULL COLLATE NOCASE UNIQUE,
  address    TEXT NOT NULL DEFAULT '',
  gstin      TEXT NOT NULL DEFAULT '',
  contact    TEXT NOT NULL DEFAULT '',
  phone      TEXT NOT NULL DEFAULT '',
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
-- Exactly one warehouse can ever exist.
CREATE UNIQUE INDEX IF NOT EXISTS locations_one_warehouse ON locations(type) WHERE type = 'warehouse';

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  username      TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('super_admin','warehouse_admin','store_admin')),
  location_id   INTEGER REFERENCES locations(id),
  phone         TEXT NOT NULL DEFAULT '',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  CHECK (role = 'super_admin' OR location_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires    INTEGER NOT NULL,
  -- Set while a Super Admin is using the app as another user. user_id stays the Super Admin.
  acting_as  INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  size       TEXT NOT NULL,
  sku        TEXT NOT NULL DEFAULT '',
  category   TEXT NOT NULL DEFAULT '',
  unit       TEXT NOT NULL DEFAULT '',
  min_stock  INTEGER NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  image      TEXT NOT NULL,
  thumb      TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS items_name_size ON items(name COLLATE NOCASE, size COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS stock (
  item_id     INTEGER NOT NULL REFERENCES items(id),
  location_id INTEGER NOT NULL REFERENCES locations(id),
  qty         INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),
  PRIMARY KEY (item_id, location_id)
);

CREATE TABLE IF NOT EXISTS transfers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  number         TEXT UNIQUE,
  source_id      INTEGER NOT NULL REFERENCES locations(id),
  dest_id        INTEGER NOT NULL REFERENCES locations(id),
  status         TEXT NOT NULL CHECK (status IN ('draft','dispatched','completed','discrepancy','rejected','cancelled')),
  note           TEXT NOT NULL DEFAULT '',
  transport_mode TEXT NOT NULL DEFAULT '',
  transport_ref  TEXT NOT NULL DEFAULT '',
  created_by     INTEGER NOT NULL REFERENCES users(id),
  created_at     TEXT NOT NULL,
  dispatched_by  INTEGER REFERENCES users(id),
  dispatched_at  TEXT,
  received_by    INTEGER REFERENCES users(id),
  received_at    TEXT,
  receive_remark TEXT NOT NULL DEFAULT '',
  closed_by      INTEGER REFERENCES users(id),
  closed_at      TEXT,
  closed_reason  TEXT NOT NULL DEFAULT '',
  CHECK (source_id <> dest_id)
);
CREATE INDEX IF NOT EXISTS transfers_source ON transfers(source_id, status);
CREATE INDEX IF NOT EXISTS transfers_dest ON transfers(dest_id, status);

CREATE TABLE IF NOT EXISTS transfer_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id  INTEGER NOT NULL REFERENCES transfers(id),
  item_id      INTEGER NOT NULL REFERENCES items(id),
  qty_sent     INTEGER NOT NULL CHECK (qty_sent > 0),
  qty_received INTEGER CHECK (qty_received IS NULL OR qty_received >= 0),
  UNIQUE (transfer_id, item_id)
);

CREATE TABLE IF NOT EXISTS transfer_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id INTEGER NOT NULL REFERENCES transfers(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  ts          TEXT NOT NULL,
  event       TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS transfer_events_transfer ON transfer_events(transfer_id);

CREATE TABLE IF NOT EXISTS stock_ledger (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL,
  item_id     INTEGER NOT NULL REFERENCES items(id),
  location_id INTEGER NOT NULL REFERENCES locations(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  type        TEXT NOT NULL CHECK (type IN ('stock_in','stock_out','adjustment','transfer_out','transfer_in','transfer_return')),
  qty_change  INTEGER NOT NULL,
  qty_before  INTEGER NOT NULL,
  qty_after   INTEGER NOT NULL CHECK (qty_after >= 0),
  reason      TEXT NOT NULL,
  transfer_id INTEGER REFERENCES transfers(id)
);
CREATE INDEX IF NOT EXISTS ledger_location ON stock_ledger(location_id, id);
CREATE INDEX IF NOT EXISTS ledger_item ON stock_ledger(item_id, id);

-- The ledger is permanent: rows can be added but never changed or removed.
CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON stock_ledger
BEGIN SELECT RAISE(ABORT, 'stock ledger entries are permanent'); END;
CREATE TRIGGER IF NOT EXISTS ledger_no_delete BEFORE DELETE ON stock_ledger
BEGIN SELECT RAISE(ABORT, 'stock ledger entries are permanent'); END;
-- Items are deactivated, never deleted.
CREATE TRIGGER IF NOT EXISTS items_no_delete BEFORE DELETE ON items
BEGIN SELECT RAISE(ABORT, 'items cannot be deleted, deactivate them instead'); END;

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  ts          TEXT NOT NULL,
  message     TEXT NOT NULL,
  transfer_id INTEGER REFERENCES transfers(id),
  read_at     TEXT
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, read_at);
`;

export const now = (): string => new Date().toISOString();

function open(): DB {
  ensureDataDirs();
  const conn = new Database(config.DB_FILE);
  conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');
  conn.pragma('busy_timeout = 5000');
  return conn;
}

/** Create missing tables and add columns that older databases lack. Safe to run more than once. */
function migrate(conn: DB): void {
  conn.exec(SCHEMA);
  // Databases created before users had a phone number get the column added here.
  const userColumns = conn.prepare('PRAGMA table_info(users)').all() as { name: string }[];
  if (!userColumns.some((c) => c.name === 'phone')) conn.exec("ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT ''");
  // Databases created before the Super Admin could switch users get the column added here.
  const sessionColumns = conn.prepare('PRAGMA table_info(sessions)').all() as { name: string }[];
  if (!sessionColumns.some((c) => c.name === 'acting_as')) conn.exec('ALTER TABLE sessions ADD COLUMN acting_as INTEGER REFERENCES users(id)');
  // Databases created before locations had a GSTIN and transfers a transport mode get the columns added here.
  const locationColumns = conn.prepare('PRAGMA table_info(locations)').all() as { name: string }[];
  if (!locationColumns.some((c) => c.name === 'gstin')) conn.exec("ALTER TABLE locations ADD COLUMN gstin TEXT NOT NULL DEFAULT ''");
  const transferColumns = conn.prepare('PRAGMA table_info(transfers)').all() as { name: string }[];
  if (!transferColumns.some((c) => c.name === 'transport_mode')) {
    conn.exec("ALTER TABLE transfers ADD COLUMN transport_mode TEXT NOT NULL DEFAULT ''");
    conn.exec("ALTER TABLE transfers ADD COLUMN transport_ref TEXT NOT NULL DEFAULT ''");
  }
  // Price and HSN code: set on the item by the Super Admin, copied onto each transfer line at dispatch.
  const itemColumns = conn.prepare('PRAGMA table_info(items)').all() as { name: string }[];
  if (!itemColumns.some((c) => c.name === 'hsn')) {
    conn.exec("ALTER TABLE items ADD COLUMN hsn TEXT NOT NULL DEFAULT ''");
    conn.exec('ALTER TABLE items ADD COLUMN price_paise INTEGER CHECK (price_paise IS NULL OR price_paise >= 0)');
  }
  const lineColumns = conn.prepare('PRAGMA table_info(transfer_items)').all() as { name: string }[];
  if (!lineColumns.some((c) => c.name === 'hsn')) {
    conn.exec('ALTER TABLE transfer_items ADD COLUMN hsn TEXT');
    conn.exec('ALTER TABLE transfer_items ADD COLUMN rate_paise INTEGER');
  }
  // The single warehouse always exists; the Super Admin can rename it later.
  conn.prepare(`
    INSERT INTO locations (type, name, code, created_at)
    SELECT 'warehouse', 'Central Warehouse', 'WH', ?
    WHERE NOT EXISTS (SELECT 1 FROM locations WHERE type = 'warehouse')`).run(now());
}

// One connection per server process. Kept on globalThis so that hot reloads
// in development reuse it instead of opening a new one each time.
const holder = globalThis as unknown as { __packagingDb?: DB };
// Module state, so it resets on every hot reload: new code migrates the reused
// connection once, instead of hitting columns the old code never added.
let migrated = false;

export function db(): DB {
  if (!holder.__packagingDb) holder.__packagingDb = open();
  if (!migrated) {
    migrate(holder.__packagingDb);
    migrated = true;
  }
  return holder.__packagingDb;
}

type Param = string | number | bigint | null;

export function get<T>(sql: string, ...params: Param[]): T | undefined {
  return db().prepare(sql).get(...params) as T | undefined;
}

export function all<T>(sql: string, ...params: Param[]): T[] {
  return db().prepare(sql).all(...params) as T[];
}

export function run(sql: string, ...params: Param[]): Database.RunResult {
  return db().prepare(sql).run(...params);
}

/**
 * Run fn inside one database transaction. Either everything fn does is saved
 * or, if it throws, nothing is. BEGIN IMMEDIATE takes the write lock up front
 * so two requests can never interleave their stock updates.
 * fn must be synchronous: no awaits between the first and last statement.
 */
export function tx<T>(fn: () => T): T {
  const conn = db();
  if (conn.inTransaction) return fn();
  conn.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    conn.exec('COMMIT');
    return result;
  } catch (err) {
    if (conn.inTransaction) conn.exec('ROLLBACK');
    throw err;
  }
}

export function warehouseId(): number {
  return get<{ id: number }>("SELECT id FROM locations WHERE type = 'warehouse'")!.id;
}
