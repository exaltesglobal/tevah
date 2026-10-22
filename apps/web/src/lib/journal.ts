import { financialYear, formatDocumentNumber, rupeesToPaise } from "@tevah/core";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Scope } from "@/db";
import { accounts, contacts, documents, journalEntries, orgs, payments } from "@/db/schema";
import { audit } from "./audit";
import type { Session } from "./auth";
import { docPath, TYPE_LABEL } from "./doc-kinds";
import { UserError } from "./documents";
import { cancelEntry, createPostedEntry, journalByType, nextSequence } from "./ledger";

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

export const journalLineInput = z.object({
  accountId: z.uuid("Choose an account"),
  contactId: z.uuid().nullish().or(z.literal("").transform(() => null)),
  description: z.string().trim().max(300).nullish(),
  debit: rupees,
  credit: rupees,
});

export const journalInput = z
  .object({
    date: z.iso.date("Enter a date"),
    reference: z.string().trim().max(100).nullish(),
    narration: z.string().trim().min(1, "Say what this entry is for").max(2000),
    lines: z.array(journalLineInput).transform((lines) => lines.filter((l) => l.debit > 0 || l.credit > 0)),
  })
  .superRefine((v, ctx) => {
    if (v.lines.length < 2) ctx.addIssue({ code: "custom", path: ["lines"], message: "Add at least two lines" });
    for (const [i, l] of v.lines.entries()) {
      if (l.debit > 0 && l.credit > 0) ctx.addIssue({ code: "custom", path: ["lines", i], message: "A line is either a debit or a credit" });
    }
    const dr = v.lines.reduce((n, l) => n + l.debit, 0);
    const cr = v.lines.reduce((n, l) => n + l.credit, 0);
    if (dr !== cr) ctx.addIssue({ code: "custom", path: ["lines"], message: "Debits and credits must be equal" });
  });

export type JournalInput = z.output<typeof journalInput>;

/** Post a manual journal voucher (JV) in the miscellaneous journal. */
export async function postJournalVoucher(s: Scope, session: Session, input: JournalInput): Promise<string> {
  const accountIds = [...new Set(input.lines.map((l) => l.accountId))];
  const found = await s.tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(s.own(accounts, inArray(accounts.id, accountIds), eq(accounts.archived, false)));
  if (found.length !== accountIds.length) throw new UserError("One of the accounts isn't available");
  const contactIds = [...new Set(input.lines.flatMap((l) => (l.contactId ? [l.contactId] : [])))];
  if (contactIds.length) {
    const c = await s.tx.select({ id: contacts.id }).from(contacts).where(s.own(contacts, inArray(contacts.id, contactIds)));
    if (c.length !== contactIds.length) throw new UserError("One of the contacts isn't available");
  }

  const journal = await journalByType(s, "general");
  const [org] = await s.tx.select({ fyStartMonth: orgs.fyStartMonth }).from(orgs).where(eq(orgs.id, s.orgId));
  const fy = financialYear(input.date, org?.fyStartMonth ?? 4);
  const number = formatDocumentNumber("JV", fy, await nextSequence(s, `JV/${fy}`));
  const entryId = await createPostedEntry(s, {
    journalId: journal.id,
    date: input.date,
    number,
    reference: input.reference,
    narration: input.narration,
    sourceRef: "manual",
    createdBy: session.userId,
    lines: input.lines.map((l) => ({
      accountId: l.accountId,
      contactId: l.contactId ?? null,
      description: l.description ?? null,
      debit: l.debit,
      credit: l.credit,
    })),
  });
  await audit(s, session, "post", "journal_entry", entryId, { number });
  return entryId;
}

/** Cancel a manual entry. Entries made by invoices, bills and payments are cancelled from those instead. */
export async function cancelJournalVoucher(s: Scope, session: Session, entryId: string): Promise<void> {
  const [entry] = await s.tx
    .select({ status: journalEntries.status, sourceRef: journalEntries.sourceRef })
    .from(journalEntries)
    .where(s.own(journalEntries, eq(journalEntries.id, entryId)))
    .for("update");
  if (!entry) throw new UserError("Entry not found");
  if (entry.status !== "posted") throw new UserError("Only posted entries can be cancelled");
  if (!entry.sourceRef?.startsWith("manual") && !entry.sourceRef?.startsWith("bank:")) {
    throw new UserError("Cancel the invoice, bill or payment this entry came from instead");
  }
  await cancelEntry(s, entryId);
  await audit(s, session, "cancel", "journal_entry", entryId);
}

/** The invoice, bill or payment behind each entry, for linking from ledger views. */
export async function entrySources(s: Scope, entryIds: string[]): Promise<Map<string, { href: string; label: string }>> {
  const out = new Map<string, { href: string; label: string }>();
  if (!entryIds.length) return out;
  const docs = await s.tx
    .select({ id: documents.id, type: documents.type, number: documents.number, entryId: documents.journalEntryId })
    .from(documents)
    .where(s.own(documents, inArray(documents.journalEntryId, entryIds)));
  for (const d of docs) out.set(d.entryId!, { href: docPath(d.type, d.id), label: d.number ?? TYPE_LABEL[d.type] });
  const pays = await s.tx
    .select({ id: payments.id, number: payments.number, entryId: payments.journalEntryId })
    .from(payments)
    .where(s.own(payments, inArray(payments.journalEntryId, entryIds)));
  for (const p of pays) out.set(p.entryId!, { href: `/payments/${p.id}`, label: p.number ?? "Payment" });
  return out;
}
