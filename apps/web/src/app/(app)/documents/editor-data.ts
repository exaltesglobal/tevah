import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Scope } from "@/db";
import { accounts, contacts, documents, products } from "@/db/schema";
import { SIDES, type Side } from "@/lib/doc-kinds";

/** Everything the document editor offers in its pickers. */
export async function editorData(s: Scope, side: Side) {
  const sales = side === "sales";
  const [contactRows, productRows, accountRows, originals] = await Promise.all([
    s.tx
      .select({ id: contacts.id, name: contacts.name, stateCode: contacts.stateCode, gstin: contacts.gstin, tdsRateBps: contacts.tdsRateBps })
      .from(contacts)
      .where(s.own(contacts, eq(contacts.archived, false), inArray(contacts.kind, [...SIDES[side].contactKinds])))
      .orderBy(asc(contacts.name)),
    s.tx
      .select()
      .from(products)
      .where(s.own(products, eq(products.archived, false)))
      .orderBy(asc(products.name)),
    s.tx
      .select({ id: accounts.id, code: accounts.code, name: accounts.name })
      .from(accounts)
      .where(s.own(accounts, eq(accounts.archived, false), inArray(accounts.type, sales ? ["income"] : ["expense", "asset"])))
      .orderBy(asc(accounts.code)),
    // Posted invoices or bills a credit or debit note can correct.
    s.tx
      .select({ id: documents.id, number: documents.number, contactId: documents.contactId, date: documents.date })
      .from(documents)
      .where(s.own(documents, and(eq(documents.type, sales ? "invoice" : "bill"), eq(documents.status, "posted"))))
      .orderBy(desc(documents.date))
      .limit(500),
  ]);
  return {
    contacts: contactRows,
    products: productRows.map((p) => ({
      id: p.id,
      name: p.name,
      hsnSac: p.hsnSac,
      unit: p.unit,
      price: sales ? p.salePrice : p.purchasePrice,
      gstRateBps: p.gstRateBps,
    })),
    accounts: accountRows,
    originals: originals.map((o) => ({ ...o, number: o.number ?? "" })),
  };
}

export type EditorData = Awaited<ReturnType<typeof editorData>>;
