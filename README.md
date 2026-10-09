# Mayave Item Transfer

A web dashboard for managing packaging material across one central warehouse and multiple stores.
Built with Next.js (App Router), React and Postgres (hosted on Supabase). Works on desktop and on phones.

This is the MVP: login and roles, items (single and bulk), locations, users, stock with a permanent
ledger, transfers with inward (receive), and role-based dashboards.

## Run it

Requires Node.js 20.9 or newer and a Postgres database (a free Supabase project works).

1. In the Supabase dashboard, open your project, click **Connect**, and copy the **Session pooler**
   connection string. Put it in `.env` as `DATABASE_URL`, with your database password in place of
   `[YOUR-PASSWORD]`.
2. Install and start:

```bash
npm install
npm run build
npm start
```

The app creates its tables on first start; there is no SQL to run by hand.
Open http://localhost:3000. The first visit asks you to create the Super Admin account.
`npm start` also prints a Network address (for example `http://192.168.1.20:3000`) that phones on
the same Wi-Fi can open.

For development with live reload use `npm run dev` instead of build and start.

**No cloud database yet?** `npm run start:local` runs everything on this computer: it starts a
local Postgres (PGlite, kept in `data/pglite`), builds the app and serves it. `npm run dev:local`
does the same with live reload (each page is slow the first time it is opened).

### Try it with demo data

On an empty database, this adds three stores, one user per role, eight items with placeholder
pictures, opening stock and transfers in different states:

```bash
npm run seed:demo
```

It prints the demo usernames and the shared password. It refuses to run once the database has stores,
items or transfers; a Super Admin account you already created is kept.
Do not keep demo data for real stock: to start clean, drop the app's tables in Supabase
(Table Editor) and delete the `data` folder.

## Roles

| Role | Can do |
| --- | --- |
| Super Admin | Creates stores and users, manages the item list, views everything. Can also edit stock at any location and create, dispatch, receive, reject or cancel any transfer. |
| Warehouse Admin | Edits warehouse stock, creates transfers from the warehouse, views every store's stock and every transfer (including store to store) read-only. |
| Store Admin | Edits only their own store's stock, sees only their own store's data, receives or rejects incoming transfers, sends stock to another store. A store can have several. |

Permissions are enforced on the server, in `src/lib/services` and `src/lib/action.ts`, not only by
hiding buttons. The tests cover this.

**Switching users.** The Super Admin can use the app as any active user without that user's
password: pick a name under "Switch user" in the menu, or press "Switch to" on the Users screen.
A yellow bar shows whose account is in use, with a button to go back. While switched, the Super
Admin can do exactly what that user can do. Stock changes and transfer steps made this way are
recorded under that user with "(done by Super Admin NAME)" added, so the history shows who really
did it. Nobody else can switch.

## How the main flows work

**Locations.** A store has a name, a code and an address. Its contact person and phone are not typed
in: they are taken from its Store Admin (the name and phone number on that user). The warehouse
works the same way with the Warehouse Admin.

**Items.** Image, Name and Size are required. Name + Size is unique (ignoring capitals and extra
spaces). Images up to 2 MB are re-encoded and a thumbnail is generated. Items are deactivated,
never deleted.

**Bulk upload.** Download the Excel or CSV template, fill it, and upload it with an optional ZIP of
images matched by file name (an image column value can also be an `https://` address). A preview
lists every row with its errors: missing fields, duplicates, missing or oversized images. Only the
valid rows are imported, and only when you confirm. The sheet has five columns: Name, Size, Image, Unit and Stock.
Stock is the quantity on hand: on import it is added to the warehouse as opening stock, with a
ledger entry.

**Stock.** One quantity per item per location, never below zero. Stock In, Stock Out and Adjustment
each need a reason. Every change writes a ledger entry (user, time, before, after, reason, linked
transfer). Ledger entries cannot be edited or deleted; the database itself blocks it.

**Transfers** (warehouse to store, and store to store):

1. The source creates a transfer: destination, items, quantities (not more than available). It gets
   a number from the sending location's own series: its code, the financial year and a running count, e.g. `SU2627-01`. It can be saved as a Draft first.
2. **Dispatch** deducts the stock from the source. It now shows as In Transit.
3. The destination sees it under Incoming with the exact items and quantities sent, read-only.
4. **Receive**: the destination confirms the received quantity per item. Only then is stock added.
   - Same as sent: status Completed.
   - Different: status Received with Discrepancy, a remark is mandatory, only the received quantity
     is added, and the Warehouse Admin is notified.
5. The destination can **Reject** with a reason; the source can **Cancel** before receipt. In both
   cases the stock returns to the source.

Each of these steps runs in a single database transaction, so stock is never half-updated.
The transfer page has a timeline and a printable slip (use the browser's Print, then Save as PDF).

## Data and backups

Everything, including item pictures and bulk-upload previews, is stored in the database (Supabase),
so the app itself keeps nothing on disk. Supabase backs the database up daily (Database > Backups
in the dashboard). To move the app to another machine, copy the project and `.env`.

Row level security is switched on for every table with no policies, so Supabase's public REST API
(the anon key) cannot read or change anything. Only the app, connecting with `DATABASE_URL`, can.

## Put it online (Vercel)

1. Push the project to GitHub, then on vercel.com choose **Add New > Project** and import the repository.
2. Under **Environment Variables**, add `DATABASE_URL` (the Supabase **Transaction pooler** string,
   port 6543), `DATABASE_POOL_MAX=3` and `COOKIE_SECURE=1`. Then deploy.

`vercel.json` runs the app in Sydney (`syd1`), next to the Supabase database; if your database is
in another region, change it to the closest Vercel region. On Vercel one upload can be at most
4.5 MB, so a bulk upload's ZIP of pictures must stay under that (split bigger imports, or use
image URLs in the sheet).

## Settings (environment variables)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port for `npm start` (or `npm start -- -p 8080`) |
| `DATABASE_URL` | none (required) | Postgres connection string (Supabase Session pooler) |
| `DATABASE_POOL_MAX` | `10` | Most database connections the app keeps open |
| `DATA_DIR` | `./data` | Scratch folder for files while an upload is read |
| `COOKIE_SECURE` | off | Set to `1` when the app is served only over HTTPS |
| `DEMO_PASSWORD` | `packaging123` | Password used by `npm run seed:demo` |

Passwords are stored as bcrypt hashes. Sessions end after 12 hours without activity, and a
deactivated user is signed out immediately. If the app is reachable from the internet, put it
behind HTTPS and set `COOKIE_SECURE=1`.

## Tests

```bash
npm test
```

Runs the rules that protect stock against a throwaway in-memory Postgres (PGlite, no setup needed): role permissions, mandatory
reasons, no negative stock, the permanent ledger, the full transfer flow (dispatch, receive,
discrepancy, reject, cancel), all-or-nothing dispatch, and bulk upload validation.

## Project layout

```
src/app/            Pages (App Router). (app)/ needs a signed-in user; login/ and setup/ do not.
src/app/actions/    Server actions: every change to data goes through these.
src/app/api/        Bulk upload endpoint and template download.
src/components/     Forms and other interactive pieces.
src/lib/            Database schema (db.ts), sessions, permissions.
src/lib/services/   Business rules: stock, transfers, items, bulk upload, users, locations.
scripts/            Demo data.
test/               Automated tests.
```

## Decisions worth knowing

- The Super Admin can change stock at any location and act on any transfer, as either the sending
  or the receiving side. A Warehouse or Store Admin can only do so for their own location. Even the
  Super Admin cannot edit or delete ledger entries.
- Transfers go to stores only (warehouse to store, store to store), as specified. Returning stock
  from a store to the warehouse is not a transfer yet.
- A receiver may enter more than was sent. It is recorded as a discrepancy like a shortage.
- The Warehouse Admin sees drafts created by stores in the All transfers list.

## Not in the MVP yet

- Reports with Excel and PDF export (stock by location, item-wise stock, transfer register,
  discrepancy report, stock ledger export)
- A separate Audit Log screen (the stock ledger and each transfer's timeline exist today)
- Server-generated PDF for the transfer slip (today it is the browser's print to PDF)
