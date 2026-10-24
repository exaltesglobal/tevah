import { asc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Scope } from "@/db";
import { accounts, products } from "@/db/schema";

/** Pickers for the product form, plus the codes already given to other items for HSN suggestions. */
export async function productFormOptions(s: Scope) {
  const hsnHistory = await s.tx
    .select({ name: products.name, hsnSac: products.hsnSac })
    .from(products)
    .where(s.own(products, isNotNull(products.hsnSac)))
    .limit(2000);
  const rows = await s.tx
    .select({ id: accounts.id, code: accounts.code, name: accounts.name, type: accounts.type })
    .from(accounts)
    .where(s.own(accounts, eq(accounts.archived, false), inArray(accounts.type, ["income", "expense", "asset"])))
    .orderBy(asc(accounts.code));
  return {
    incomeAccounts: rows.filter((a) => a.type === "income"),
    expenseAccounts: rows.filter((a) => a.type !== "income"),
    hsnHistory,
  };
}
