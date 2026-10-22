import { randomUUID } from "node:crypto";
import { financialYear, formatDocumentNumber, postCustomerReceipt, postVendorPayment, rupeesToPaise } from "@tevah/core";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Scope } from "@/db";
import { contacts, documents, journals, orgs, paymentAllocations, payments } from "@/db/schema";
import { audit } from "./audit";
import type { Session } from "./auth";
import { addPaid, outstanding, UserError } from "./documents";
import { cancelEntry, createPostedEntry, nextSequence, systemAccounts } from "./ledger";

export type PaymentDirection = "received" | "paid";

const rupees = z.string().transform((v, ctx) => {
  try {
    const p = rupeesToPaise(v || "0");
    if (p < 0) throw new Error();
    return p;
  } catch {
    ctx.addIssue({ code: "custom", message: "Enter an amount like 1500 or 1,500.50" });
    return z.NEVER;
  }
});

export const paymentInput = z.object({
  contactId: z.uuid("Choose a contact"),
  date: z.iso.date("Enter a date"),
  journalId: z.uuid("Choose a bank or cash account"),
  amount: rupees.refine((v) => v > 0, "Enter the amount"),
  tds: rupees.default(0),
  reference: z.string().trim().max(100).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  allocations: z.array(z.object({ documentId: z.uuid(), amount: rupees })).default([]),
});

export type PaymentInput = z.output<typeof paymentInput>;

const NUMBER_PREFIX: Record<PaymentDirection, string> = { received: "RCPT", paid: "PAY" };
/** Documents a payment can settle: receipts clear invoices, payments clear bills. */
const SETTLES: Record<PaymentDirection, "invoice" | "bill"> = { received: "invoice", paid: "bill" };

/** Record and post a payment, settling the chosen documents. */
export async function recordPayment(s: Scope, session: Session, direction: PaymentDirection, input: PaymentInput): Promise<string> {
  const tds = direction === "received" ? input.tds : 0;
  const [contact] = await s.tx.select().from(contacts).where(s.own(contacts, eq(contacts.id, input.contactId)));
  if (!contact) throw new UserError("Contact not found");

  const [journal] = await s.tx.select().from(journals).where(s.own(journals, eq(journals.id, input.journalId)));
  if (!journal || (journal.type !== "bank" && journal.type !== "cash") || !journal.defaultAccountId) {
    throw new UserError("Choose a bank or cash account");
  }

  const allocations = input.allocations.filter((a) => a.amount > 0);
  const allocated = allocations.reduce((n, a) => n + a.amount, 0);
  if (allocated > input.amount + tds) throw new UserError("You've allocated more than was paid");
  if (new Set(allocations.map((a) => a.documentId)).size !== allocations.length) {
    throw new UserError("Each document can be settled once per payment");
  }
  if (allocations.length) {
    const docs = await s.tx
      .select()
      .from(documents)
      .where(s.own(documents, inArray(documents.id, allocations.map((a) => a.documentId))))
      .for("update");
    const byId = new Map(docs.map((d) => [d.id, d]));
    for (const a of allocations) {
      const d = byId.get(a.documentId);
      if (!d || d.contactId !== contact.id || d.type !== SETTLES[direction] || d.status !== "posted") {
        throw new UserError("A document on this payment can't be settled by it");
      }
      if (a.amount > outstanding(d)) throw new UserError(`${d.number} only has ${outstanding(d) / 100} outstanding`);
    }
  }

  const [org] = await s.tx.select({ fyStartMonth: orgs.fyStartMonth }).from(orgs).where(eq(orgs.id, s.orgId));
  const fy = financialYear(input.date, org?.fyStartMonth ?? 4);
  const prefix = NUMBER_PREFIX[direction];
  const number = formatDocumentNumber(prefix, fy, await nextSequence(s, `${prefix}/${fy}`));

  const posting = {
    amount: input.amount,
    contactId: contact.id,
    moneyAccountId: journal.defaultAccountId,
    accounts: await systemAccounts(s),
    tds,
  };
  const entryId = await createPostedEntry(s, {
    journalId: journal.id,
    date: input.date,
    number,
    reference: input.reference,
    narration: `${number} ${contact.name}`,
    sourceRef: `payment:${number}`,
    createdBy: session.userId,
    lines: direction === "received" ? postCustomerReceipt(posting) : postVendorPayment(posting),
  });

  const id = randomUUID();
  await s.tx.insert(payments).values({
    id,
    orgId: s.orgId,
    direction,
    number,
    contactId: contact.id,
    date: input.date,
    amount: input.amount,
    tdsAmount: tds,
    journalId: journal.id,
    reference: input.reference ?? null,
    notes: input.notes ?? null,
    journalEntryId: entryId,
    createdBy: session.userId,
  });
  if (allocations.length) {
    await s.tx.insert(paymentAllocations).values(allocations.map((a) => ({ orgId: s.orgId, paymentId: id, ...a })));
    for (const a of allocations) await addPaid(s, a.documentId, a.amount);
  }
  await audit(s, session, "create", "payment", id, { number, amount: input.amount, tds });
  return id;
}

/** Cancel a payment: its ledger entry drops out and the documents it settled reopen. */
export async function cancelPayment(s: Scope, session: Session, id: string): Promise<void> {
  const [payment] = await s.tx.select().from(payments).where(s.own(payments, eq(payments.id, id))).for("update");
  if (!payment) throw new UserError("Payment not found");
  if (payment.status !== "posted") throw new UserError("This payment is already cancelled");
  const allocations = await s.tx
    .select()
    .from(paymentAllocations)
    .where(s.own(paymentAllocations, eq(paymentAllocations.paymentId, id)));
  for (const a of allocations) await addPaid(s, a.documentId, -a.amount);
  if (payment.journalEntryId) await cancelEntry(s, payment.journalEntryId);
  await s.tx.update(payments).set({ status: "cancelled" }).where(s.own(payments, eq(payments.id, id)));
  await audit(s, session, "cancel", "payment", id);
}
