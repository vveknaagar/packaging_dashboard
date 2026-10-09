/**
 * Asks for the Supabase database password, checks it works, and writes
 * DATABASE_URL into .env. The password is never shown on screen.
 *
 *   npm run db:password
 */
import fs from 'node:fs';
import readline from 'node:readline';
import pg from 'pg';

const PROJECT_REF = 'cmwsnzutjqlxotmhfnxs';
const HOST = 'aws-0-ap-southeast-2.pooler.supabase.com';
const ENV_FILE = '.env';

function askHidden(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let muted = false;
  rl._writeToOutput = (text) => { if (!muted) rl.output.write(text); };
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.output.write('\n'); rl.close(); resolve(answer.trim()); });
    muted = true;
  });
}

const password = await askHidden('Supabase database password (typing is hidden), then Enter: ');
if (!password) {
  console.error('No password entered. Nothing was changed.');
  process.exit(1);
}

const url = `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(password)}@${HOST}:5432/postgres`;
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
try {
  await client.connect();
  await client.query('SELECT 1');
} catch (err) {
  console.error(`Could not connect: ${err.message}`);
  console.error('Check the password (Supabase: Project Settings > Database) and try again. Nothing was changed.');
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}

const line = `DATABASE_URL=${url}`;
let env = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
env = /^DATABASE_URL=.*$/m.test(env) ? env.replace(/^DATABASE_URL=.*$/m, () => line) : `${env.trimEnd()}\n${line}\n`;
fs.writeFileSync(ENV_FILE, env);
console.log('Connected to Supabase. DATABASE_URL is saved in .env. Restart the app to use it.');
