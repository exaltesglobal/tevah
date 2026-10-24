# Tevah conventions

- Money is integer paise everywhere (`bigint` columns, `Paise` type). Never use floats for stored amounts; use `@tevah/core` helpers (`rupeesToPaise`, `formatINR`, `mulRound`).
- GST rates and discounts are basis points (1800 = 18%).
- Business logic that doesn't need the database goes in `packages/core` with unit tests. The web app calls it.
- The database is MySQL/MariaDB (it runs on Hostinger shared hosting), so there is no row-level security. Every tenant table has `org_id`. Query tenant data only inside `withOrg(session.orgId, s => ...)`, wrap every where/join condition on a tenant table in `s.own(table, ...)`, and set `orgId: s.orgId` on inserts. `test/tenancy.test.ts` fails on any unscoped query.
- MySQL has no `RETURNING`: generate ids with `randomUUID()` before inserting.
- Reports read from the ledger (`journal_lines` of posted entries), never from documents directly. Documents post balanced entries through `packages/core/src/posting.ts`.
- Schema changes: edit `schema.ts`, run `pnpm --filter @tevah/web db:generate --name <change>`, commit the SQL.
- Server actions validate with zod and return `FormState`. Pass `data` to `zodErrors(error, data)` so forms keep what the user typed.
- Never commit exported customer data, credentials or `.env` files.
