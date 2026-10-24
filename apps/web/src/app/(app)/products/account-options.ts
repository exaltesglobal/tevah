import { asc, eq, inArray } from "drizzle-orm";
import type { Scope } from "@/db";
import { accounts } from "@/db/schema";

export async function accountOptions(s: Scope) {
  const rows = await s.tx
    .select({ id: accounts.id, code: accounts.code, name: accounts.name, type: accounts.type })
    .from(accounts)
    .where(s.own(accounts, eq(accounts.archived, false), inArray(accounts.type, ["income", "expense", "asset"])))
    .orderBy(asc(accounts.code));
  return {
    incomeAccounts: rows.filter((a) => a.type === "income"),
    expenseAccounts: rows.filter((a) => a.type !== "income"),
  };
}
