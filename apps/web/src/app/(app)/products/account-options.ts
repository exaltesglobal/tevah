import { and, asc, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db";
import { accounts } from "@/db/schema";

export async function accountOptions(tx: Tx) {
  const rows = await tx
    .select({ id: accounts.id, code: accounts.code, name: accounts.name, type: accounts.type })
    .from(accounts)
    .where(and(eq(accounts.archived, false), inArray(accounts.type, ["income", "expense", "asset"])))
    .orderBy(asc(accounts.code));
  return {
    incomeAccounts: rows.filter((a) => a.type === "income"),
    expenseAccounts: rows.filter((a) => a.type !== "income"),
  };
}
