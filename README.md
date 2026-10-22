# Tevah

A GST-native web ERP for Indian SMEs. The first live company on it is Exaltes Global Private Limited, replacing its Odoo subscription.

## What's here (milestone 1)

- **`packages/core`**: framework-free business logic with unit tests. Money in integer paise, GSTIN/PAN validation, the GST engine (CGST/SGST vs IGST, discounts, rupee round-off, reverse charge), double-entry posting rules for invoices, bills (with TDS), credit notes and payments, and a starter Indian chart of accounts.
- **`apps/web`**: Next.js app with Postgres (Drizzle ORM). Email/password login, company setup, contacts, products and services, and chart of accounts with balances.

## Multi-tenancy

Every business table has an `org_id` and a Postgres row-level security policy. The app connects as `tevah_app`, which doesn't own the tables, so Postgres enforces the policy on every query. Requests run inside `withOrg(orgId, ...)`, which sets `app.org_id` for the transaction. Migrations run as the owner role. `apps/web/test/tenancy.test.ts` proves one company can't read or write another's rows.

## Running locally

Needs Node 22, pnpm and Postgres 16.

```sh
pnpm install
cp apps/web/.env.example apps/web/.env   # then edit
createdb tevah_dev                        # as a role with CREATEROLE, e.g. `tevah`
cd apps/web
set -a; . ./.env; set +a
pnpm db:migrate     # schema + creates the tevah_app role
pnpm db:seed        # creates Exaltes Global and the first admin
pnpm dev
```

Tests: `pnpm test` from the root. The tenancy tests also need `TEST_DATABASE_ADMIN_URL` and `TEST_DATABASE_URL` pointing at a throwaway database. Without them they're skipped.

## Roadmap

1. ✅ Foundation: auth, companies, contacts, products, chart of accounts, GST engine
2. Sales invoices, vendor bills with TDS, payments, ledger posting
3. Reports: P&L, balance sheet, trial balance, ledgers, GSTR-1/3B, bank reconciliation
4. Projects and tasks; Odoo import
5. Parallel month-end run, then switch off Odoo
