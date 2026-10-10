/**
 * Run the app on this computer without a cloud database: starts a local
 * Postgres (PGlite, stored in data/pglite) and then the app against it.
 *
 *   npm run start:local   fast: builds once, then serves (use this to try the app)
 *   npm run dev:local     live reload while editing code; each page is slow the first time
 *   npm run seed:local    add demo data to the local database (stop the app first)
 *
 * Stop with Ctrl+C. Data stays in data/pglite between runs. To use Supabase
 * or another hosted Postgres instead, set DATABASE_URL in .env and use `npm run dev`.
 */
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const mode = ['start', 'seed'].includes(process.argv[2]) ? process.argv[2] : 'dev';
const nextBin = path.resolve('node_modules/next/dist/bin/next');
if (mode === 'start') {
  // The build needs no database, so it runs before the database is opened.
  const build = spawnSync(process.execPath, [nextBin, 'build'], { stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const dataDir = path.resolve(process.env.DATA_DIR || 'data', 'pglite');
const db = await PGlite.create({ dataDir, extensions: { citext } });
// PGlite runs one query at a time; the server queues queries from every connection
// (the app may open several, plus scripts such as seed:demo).
const server = new PGLiteSocketServer({ db, port: Number(process.env.LOCAL_DB_PORT) || 54329, host: '127.0.0.1', maxConnections: 10 });
await server.start();
console.log(`Local database: ${dataDir}`);

const env = { ...process.env, DATABASE_URL: `postgres://postgres@${server.getServerConn()}/postgres`, DATABASE_POOL_MAX: '1' };
const next = mode === 'seed'
  ? spawn(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), 'scripts/seed-demo.ts'], { stdio: 'inherit', env })
  : spawn(process.execPath, [nextBin, mode, ...process.argv.slice(3)], { stdio: 'inherit', env });

let stopping = false;
async function stop(code) {
  if (stopping) return;
  stopping = true;
  next.kill();
  await server.stop().catch(() => {});
  await db.close().catch(() => {});
  process.exit(code);
}
next.on('exit', (code) => stop(code ?? 0));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
