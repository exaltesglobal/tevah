import { asc, inArray } from "drizzle-orm";
import type { Scope } from "@/db";
import { accounts, journals } from "@/db/schema";

/** Accounts and bank/cash journals the app form chooses from. */
export async function appFormOptions(s: Scope) {
  const [accountRows, journalRows] = await Promise.all([
    s.tx
      .select({ id: accounts.id, code: accounts.code, name: accounts.name, type: accounts.type })
      .from(accounts)
      .where(s.own(accounts, inArray(accounts.type, ["income", "expense"])))
      .orderBy(asc(accounts.code)),
    s.tx
      .select({ id: journals.id, code: journals.code, name: journals.name, type: journals.type })
      .from(journals)
      .where(s.own(journals, inArray(journals.type, ["bank", "cash"])))
      .orderBy(asc(journals.type), asc(journals.name)),
  ]);
  return {
    income: accountRows.filter((a) => a.type === "income"),
    expense: accountRows.filter((a) => a.type === "expense"),
    journals: journalRows,
  };
}
export type AppFormOptions = Awaited<ReturnType<typeof appFormOptions>>;
