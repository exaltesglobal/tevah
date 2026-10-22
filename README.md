# Tevah

A GST-native web ERP for Indian SMEs. The first live company on it is Exaltes Global Private Limited, replacing its Odoo subscription.

## What's here (milestone 1)

- **`packages/core`**: framework-free business logic with unit tests. Money in integer paise, GSTIN/PAN validation, the GST engine (CGST/SGST vs IGST, discounts, rupee round-off, reverse charge), double-entry posting rules for invoices, bills (with TDS), credit notes and payments, and a starter Indian chart of accounts.
- **`apps/web`**: Next.js app on MySQL/MariaDB (Drizzle ORM), built to run on Hostinger's Node.js web hosting with its MySQL database. Email/password login, company setup, contacts, products and services, and chart of accounts with balances.

## Multi-tenancy

Every business table has an `org_id`. MySQL has no row-level security, so isolation lives in the app: tenant queries run inside `withOrg(orgId, s => ...)` and filter with `s.own(table, ...)`, and inserts carry `s.orgId`. `apps/web/test/tenancy.test.ts` has a guard that fails CI if any query on a tenant table in `src/` skips `own(...)`, plus integration tests showing one company can't read or change another's rows.

## Running locally

Needs Node 22+, pnpm and MySQL 8 or MariaDB 10.6+.

```sh
pnpm install
cp apps/web/.env.example apps/web/.env   # then set DATABASE_URL and the seed admin
cd apps/web
set -a; . ./.env; set +a
pnpm db:migrate     # creates the tables
pnpm db:seed        # creates Exaltes Global and the first admin
pnpm dev
```

Tests: `pnpm test` from the root. The MySQL integration tests also need `TEST_DATABASE_URL` pointing at a throwaway database. Without it they're skipped, but the scoping guard still runs.

## Deploying on Hostinger

Hostinger's Node.js web hosting builds the app from GitHub. The site runs at https://tevah.exaltesglobal.com.

- Build settings: Node 22, pnpm, framework Next.js, root directory `apps/web`, output `.next`, build script `build:hostinger`. That script builds the app, then applies migrations and runs the seed, so each deploy brings the database up to date.
- Environment variables (set in hPanel or through the API): `DATABASE_URL=mysql://USER:PASSWORD@127.0.0.1:3306/DB`. Use host `127.0.0.1`, not `localhost` and not the `srvNNNN.hstgr.io` name. For the very first deploy also set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`. The seed skips once the company exists, so the password variable can be removed after that.

## Roadmap

1. ✅ Foundation: auth, companies, contacts, products, chart of accounts, GST engine
2. ✅ Sales invoices, credit and debit notes, vendor bills with TDS, payments, ledger posting
3. Reports: P&L, balance sheet, trial balance, ledgers, GSTR-1/3B, bank reconciliation
4. Projects and tasks; Odoo import
5. Parallel month-end run, then switch off Odoo
