import {
  computeDocument,
  financialYear,
  formatDocumentNumber,
  GST_RATES_BPS,
  isSalesDocument,
  isStateCode,
  mulRound,
  NUMBER_PREFIX,
  postCreditNote,
  postDebitNote,
  postSalesInvoice,
  postVendorBill,
  rupeesToPaise,
  type DocumentTotals,
  type DocumentType,
  type LineInput,
} from "@tevah/core";
import { randomUUID } from "node:crypto";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Scope } from "@/db";
import { accounts, contacts, documentLines, documents, orgs, products } from "@/db/schema";
import { audit } from "./audit";
import type { Session } from "./auth";
import { cancelEntry, createPostedEntry, journalByType, nextSequence, systemAccounts } from "./ledger";

export class UserError extends Error {}

const rupees = z.string().transform((v, ctx) => {
  try {
    return rupeesToPaise(v || "0");
  } catch {
    ctx.addIssue({ code: "custom", message: "Enter an amount like 1500 or 1,500.50" });
    return z.NEVER;
  }
});

const percentToBps = (max: number) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      const n = Number(v || 0);
      if (!Number.isFinite(n) || n < 0 || n > max) {
        ctx.addIssue({ code: "custom", message: `Enter a percentage between 0 and ${max}` });
        return z.NEVER;
      }
      return Math.round(n * 100);
    });

export const lineInput = z.object({
  productId: z.uuid().nullish(),
  description: z.string().trim().min(1, "Describe the line"),
  hsnSac: z
    .string()
    .trim()
    .regex(/^(\d{4,8})?$/, "HSN/SAC is 4 to 8 digits")
    .nullish(),
  quantity: z.string().transform((v, ctx) => {
    const n = Number(v);
    if (!(n > 0) || Math.round(n * 1000) !== n * 1000) {
      ctx.addIssue({ code: "custom", message: "Quantity must be above zero, up to 3 decimals" });
      return z.NEVER;
    }
    return Math.round(n * 1000);
  }),
  unit: z.string().trim().max(20).default("NOS"),
  unitPrice: rupees,
  discount: percentToBps(100),
  gstRateBps: z.coerce
    .number()
    .refine((v) => (GST_RATES_BPS as readonly number[]).includes(v), { message: "Choose a GST rate" }),
  accountId: z.uuid().nullish(),
});

export const documentInput = z.object({
  contactId: z.uuid("Choose a contact"),
  date: z.iso.date("Enter a date"),
  dueDate: z.iso.date().nullish(),
  placeOfSupply: z.string().refine(isStateCode, { message: "Choose the place of supply" }),
  supplyType: z.enum(["intra", "inter"]),
  reverseCharge: z.boolean().default(false),
  vendorReference: z.string().trim().max(50).nullish(),
  originalDocumentId: z.uuid().nullish(),
  tdsSection: z.string().trim().max(20).nullish(),
  tdsRate: percentToBps(30),
  notes: z.string().trim().max(2000).nullish(),
  lines: z.array(lineInput).min(1, "Add at least one line"),
});

export type DocumentInput = z.output<typeof documentInput>;
type ParsedLine = z.output<typeof lineInput>;

const toLineInput = (l: { quantityMilli: number; unitPrice: number; discountBps: number; gstRateBps: number }): LineInput => ({
  quantity: l.quantityMilli / 1000,
  unitPrice: l.unitPrice,
  discountBps: l.discountBps,
  gstRateBps: l.gstRateBps,
});

/** TDS is deducted on the value before GST. */
export const tdsOn = (totals: DocumentTotals, rateBps: number) => mulRound(totals.taxable, rateBps, 10000);

export async function saveDraft(
  s: Scope,
  session: Session,
  type: DocumentType,
  id: string | null,
  input: DocumentInput,
): Promise<string> {
  const sales = isSalesDocument(type);
  const [contact] = await s.tx.select().from(contacts).where(s.own(contacts, eq(contacts.id, input.contactId)));
  if (!contact) throw new UserError("Contact not found");
  if (sales ? contact.kind === "vendor" : contact.kind === "customer") {
    throw new UserError(`${contact.name} is not set up as a ${sales ? "customer" : "vendor"}`);
  }

  const lineAccounts = await resolveLineAccounts(s, sales, input.lines);
  const totals = computeDocument(input.lines.map((l) => toLineInput({ ...l, quantityMilli: l.quantity, discountBps: l.discount })), {
    type: input.supplyType,
    reverseCharge: input.reverseCharge,
  });
  const tdsAmount = sales ? 0 : tdsOn(totals, input.tdsRate);

  const values = {
    contactId: input.contactId,
    date: input.date,
    dueDate: input.dueDate ?? null,
    placeOfSupply: input.placeOfSupply,
    supplyType: input.supplyType,
    reverseCharge: input.reverseCharge,
    vendorReference: input.vendorReference ?? null,
    originalDocumentId: input.originalDocumentId ?? null,
    tdsSection: tdsAmount ? (input.tdsSection ?? null) : null,
    tdsAmount,
    notes: input.notes ?? null,
    taxable: totals.taxable,
    cgst: totals.cgst,
    sgst: totals.sgst,
    igst: totals.igst,
    roundOff: totals.roundOff,
    total: totals.total,
  };

  let docId: string;
  if (id) {
    const [existing] = await s.tx
      .select({ status: documents.status, type: documents.type })
      .from(documents)
      .where(s.own(documents, eq(documents.id, id)))
      .for("update");
    if (!existing || existing.type !== type) throw new UserError("Document not found");
    if (existing.status !== "draft") throw new UserError("Only drafts can be edited");
    await s.tx.update(documents).set(values).where(s.own(documents, eq(documents.id, id)));
    await s.tx.delete(documentLines).where(s.own(documentLines, eq(documentLines.documentId, id)));
    docId = id;
  } else {
    docId = randomUUID();
    await s.tx.insert(documents).values({ ...values, id: docId, orgId: s.orgId, type, createdBy: session.userId });
  }

  await s.tx.insert(documentLines).values(
    input.lines.map((l, i) => ({
        orgId: s.orgId,
        documentId: docId,
        position: i,
        productId: l.productId ?? null,
        description: l.description,
        hsnSac: l.hsnSac || null,
        quantityMilli: l.quantity,
        unit: l.unit.toUpperCase(),
        unitPrice: l.unitPrice,
        discountBps: l.discount,
        gstRateBps: l.gstRateBps,
        accountId: lineAccounts[i]!,
        taxable: totals.lines[i]!.taxable,
        cgst: totals.lines[i]!.cgst,
        sgst: totals.lines[i]!.sgst,
        igst: totals.lines[i]!.igst,
        total: totals.lines[i]!.total,
    })),
  );
  await audit(s, session, id ? "update" : "create", type, docId, { total: totals.total });
  return docId;
}

/** Line account: explicit choice, else the product's account, else the default sales/purchases account. */
async function resolveLineAccounts(s: Scope, sales: boolean, lines: ParsedLine[]): Promise<string[]> {
  const sys = await systemAccounts(s);
  const productIds = [...new Set(lines.map((l) => l.productId).filter((p): p is string => !!p))];
  const productRows = productIds.length
    ? await s.tx.select().from(products).where(s.own(products, inArray(products.id, productIds)))
    : [];
  if (productRows.length !== productIds.length) throw new UserError("A product on this document no longer exists");
  const byId = new Map(productRows.map((p) => [p.id, p]));

  const chosen = lines.map((l) => {
    if (l.accountId) return l.accountId;
    const p = l.productId ? byId.get(l.productId) : undefined;
    return (sales ? p?.incomeAccountId : p?.expenseAccountId) ?? (sales ? sys.sales : sys.purchases);
  });
  const explicit = [...new Set(lines.map((l) => l.accountId).filter((a): a is string => !!a))];
  if (explicit.length) {
    const found = await s.tx.select({ id: accounts.id }).from(accounts).where(s.own(accounts, inArray(accounts.id, explicit)));
    if (found.length !== explicit.length) throw new UserError("Choose line accounts from your chart of accounts");
  }
  return chosen;
}

const JOURNAL_FOR: Record<DocumentType, "sales" | "purchase"> = {
  invoice: "sales",
  credit_note: "sales",
  bill: "purchase",
  debit_note: "purchase",
};

/** Assign the number, write the ledger entry and lock the document. */
export async function postDocument(s: Scope, session: Session, id: string): Promise<string> {
  const [doc] = await s.tx.select().from(documents).where(s.own(documents, eq(documents.id, id))).for("update");
  if (!doc) throw new UserError("Document not found");
  if (doc.status !== "draft") throw new UserError("This document is already posted");
  const lines = await s.tx
    .select()
    .from(documentLines)
    .where(s.own(documentLines, eq(documentLines.documentId, id)))
    .orderBy(asc(documentLines.position));
  if (!lines.length) throw new UserError("Add at least one line before posting");
  if (doc.originalDocumentId) {
    const [original] = await s.tx
      .select({ type: documents.type, status: documents.status, contactId: documents.contactId })
      .from(documents)
      .where(s.own(documents, eq(documents.id, doc.originalDocumentId)));
    if (!original || original.status !== "posted" || original.contactId !== doc.contactId || original.type !== CORRECTS[doc.type]) {
      throw new UserError(`The original ${doc.type === "credit_note" ? "invoice" : "bill"} must be a posted one for the same contact`);
    }
  }

  const totals = computeDocument(lines.map(toLineInput), { type: doc.supplyType, reverseCharge: doc.reverseCharge });
  if (totals.total !== doc.total) throw new Error("Stored totals are out of date; save the draft again");

  const [org] = await s.tx.select({ fyStartMonth: orgs.fyStartMonth }).from(orgs).where(eq(orgs.id, s.orgId));
  const fy = financialYear(doc.date, org?.fyStartMonth ?? 4);
  const prefix = NUMBER_PREFIX[doc.type];
  const number = formatDocumentNumber(prefix, fy, await nextSequence(s, `${prefix}/${fy}`));

  const sys = await systemAccounts(s);
  const lineAccountIds = lines.map((l) => l.accountId);
  const entryLines =
    doc.type === "invoice"
      ? postSalesInvoice({ totals, lineAccountIds, customerId: doc.contactId, accounts: sys })
      : doc.type === "credit_note"
        ? postCreditNote({ totals, lineAccountIds, customerId: doc.contactId, accounts: sys })
        : (doc.type === "bill" ? postVendorBill : postDebitNote)({
            totals,
            lineAccountIds,
            vendorId: doc.contactId,
            accounts: sys,
            tds: doc.tdsAmount,
            reverseCharge: doc.reverseCharge,
          });

  const journal = await journalByType(s, JOURNAL_FOR[doc.type]);
  const entryId = await createPostedEntry(s, {
    journalId: journal.id,
    date: doc.date,
    number,
    reference: doc.vendorReference,
    narration: `${number}`,
    sourceRef: `document:${doc.id}`,
    createdBy: session.userId,
    lines: entryLines,
  });

  await s.tx
    .update(documents)
    .set({ status: "posted", number, journalEntryId: entryId, postedAt: new Date() })
    .where(s.own(documents, eq(documents.id, id)));
  if (doc.originalDocumentId) await applyNote(s, doc, doc.originalDocumentId);
  await audit(s, session, "post", doc.type, id, { number, total: doc.total });
  return number;
}

/** Cancel a posted document. Its number stays used, as GST requires. */
export async function cancelDocument(s: Scope, session: Session, id: string): Promise<void> {
  const [doc] = await s.tx.select().from(documents).where(s.own(documents, eq(documents.id, id))).for("update");
  if (!doc) throw new UserError("Document not found");
  if (doc.status !== "posted") throw new UserError("Only posted documents can be cancelled");
  const isNote = doc.type === "credit_note" || doc.type === "debit_note";
  if (isNote && doc.originalDocumentId && doc.amountPaid > 0) {
    await addPaid(s, doc.originalDocumentId, -doc.amountPaid);
    await addPaid(s, doc.id, -doc.amountPaid);
  } else if (doc.amountPaid > 0) {
    throw new UserError("Cancel the payments and notes against this document first");
  }
  if (doc.journalEntryId) await cancelEntry(s, doc.journalEntryId);
  await s.tx.update(documents).set({ status: "cancelled" }).where(s.own(documents, eq(documents.id, id)));
  await audit(s, session, "cancel", doc.type, id);
}

export async function deleteDraft(s: Scope, session: Session, id: string): Promise<void> {
  const [doc] = await s.tx
    .select({ type: documents.type, status: documents.status })
    .from(documents)
    .where(s.own(documents, eq(documents.id, id)))
    .for("update");
  if (doc?.status !== "draft") throw new UserError("Only drafts can be deleted");
  await s.tx.delete(documents).where(s.own(documents, eq(documents.id, id)));
  await audit(s, session, "archive", doc.type, id, { deleted: true });
}

/** What the counterparty still owes us (sales) or we still owe them (purchases). */
export function outstanding(doc: { type: DocumentType; total: number; tdsAmount: number; amountPaid: number }): number {
  return doc.total - doc.tdsAmount - doc.amountPaid;
}

/** Which document a credit or debit note corrects. */
const CORRECTS: Partial<Record<DocumentType, DocumentType>> = { credit_note: "invoice", debit_note: "bill" };

/** Settle the original invoice or bill with a note, up to what is still outstanding on it. */
async function applyNote(s: Scope, note: { id: string; total: number }, originalId: string): Promise<void> {
  const [original] = await s.tx.select().from(documents).where(s.own(documents, eq(documents.id, originalId))).for("update");
  const applied = Math.min(note.total, original ? outstanding(original) : 0);
  if (applied <= 0) return;
  await addPaid(s, originalId, applied);
  await addPaid(s, note.id, applied);
}

export async function addPaid(s: Scope, documentId: string, amount: number): Promise<void> {
  await s.tx
    .update(documents)
    .set({ amountPaid: sql`${documents.amountPaid} + ${amount}` })
    .where(s.own(documents, eq(documents.id, documentId)));
}
