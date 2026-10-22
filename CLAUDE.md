# Tevah conventions

- Money is integer paise everywhere (`bigint` columns, `Paise` type). Never use floats for stored amounts; use `@tevah/core` helpers (`rupeesToPaise`, `formatINR`, `mulRound`).
- GST rates and discounts are basis points (1800 = 18%).
- Business logic that doesn't need the database goes in `packages/core` with unit tests. The web app calls it.
- Every tenant table has `org_id`, `.enableRLS()` and the `orgIsolation` policy (see `apps/web/src/db/schema.ts`). Query tenant data only inside `withOrg(session.orgId, tx => ...)`.
- Reports read from the ledger (`journal_lines` of posted entries), never from documents directly. Documents post balanced entries through `packages/core/src/posting.ts`.
- Schema changes: edit `schema.ts`, run `pnpm --filter @tevah/web db:generate --name <change>`, commit the SQL.
- Server actions validate with zod and return `FormState`. Pass `data` to `zodErrors(error, data)` so forms keep what the user typed.
- Never commit exported customer data, credentials or `.env` files.
