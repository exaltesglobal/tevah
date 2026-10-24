import type { AccountTotals, GstDocument, OpenItem, SystemTag } from "@tevah/core";
import { and, asc, eq, gte, inArray, isNotNull, lt, lte, sql } from "drizzle-orm";
import type { Scope } from "@/db";
import { accounts, contacts, documentLines, documents, journalEntries, journalLines, journals } from "@/db/schema";

export interface Period {
  /** Inclusive; omit for "since the beginning". */
  from?: string;
  to: string;
}

const inPeriod = (p: Period) =>
  and(eq(journalEntries.status, "posted"), p.from ? gte(journalEntries.date, p.from) : undefined, lte(journalEntries.date, p.to));

/** Posted debits and credits per account over a period, from the ledger. */
export async function accountTotals(s: Scope, period: Period): Promise<AccountTotals[]> {
  const rows = await s.tx
    .select({
      id: accounts.id,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, s.own(journalEntries, eq(journalEntries.id, journalLines.entryId), inPeriod(period)))
    .innerJoin(accounts, s.own(accounts, eq(accounts.id, journalLines.accountId)))
    .where(s.own(journalLines))
    .groupBy(accounts.id)
    .orderBy(asc(accounts.code));
  return rows.map((r) => ({ ...r, debit: Number(r.debit), credit: Number(r.credit) }));
}

export async function accountByTag(s: Scope, tag: SystemTag) {
  const [row] = await s.tx.select().from(accounts).where(s.own(accounts, eq(accounts.systemTag, tag)));
  if (!row) throw new Error(`No ${tag} account`);
  return row;
}

/** Debit minus credit on accounts up to and including a date (or before it, with `before`). */
export async function balanceOf(s: Scope, accountIds: string[], date: string, before = false): Promise<number> {
  if (!accountIds.length) return 0;
  const [row] = await s.tx
    .select({ n: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)` })
    .from(journalLines)
    .innerJoin(
      journalEntries,
      s.own(
        journalEntries,
        eq(journalEntries.id, journalLines.entryId),
        eq(journalEntries.status, "posted"),
        before ? lt(journalEntries.date, date) : lte(journalEntries.date, date),
      ),
    )
    .where(s.own(journalLines, inArray(journalLines.accountId, accountIds)));
  return Number(row?.n ?? 0);
}

export interface LedgerRow {
  lineId: string;
  entryId: string;
  date: string;
  number: string | null;
  journalCode: string;
  narration: string | null;
  description: string | null;
  sourceRef: string | null;
  contactName: string | null;
  debit: number;
  credit: number;
}

/** Posted lines on one account in a period, oldest first. */
export async function ledgerRows(s: Scope, accountId: string, period: Period): Promise<LedgerRow[]> {
  return s.tx
    .select({
      lineId: journalLines.id,
      entryId: journalEntries.id,
      date: journalEntries.date,
      number: journalEntries.number,
      journalCode: journals.code,
      narration: journalEntries.narration,
      description: journalLines.description,
      sourceRef: journalEntries.sourceRef,
      contactName: contacts.name,
      debit: journalLines.debit,
      credit: journalLines.credit,
    })
    .from(journalLines)
    .innerJoin(journalEntries, s.own(journalEntries, eq(journalEntries.id, journalLines.entryId), inPeriod(period)))
    .innerJoin(journals, s.own(journals, eq(journals.id, journalEntries.journalId)))
    .leftJoin(contacts, s.own(contacts, eq(contacts.id, journalLines.contactId)))
    .where(s.own(journalLines, eq(journalLines.accountId, accountId)))
    .orderBy(asc(journalEntries.date), asc(journalEntries.postedAt), asc(journalLines.id));
}

/**
 * Open invoices (receivable) or bills (payable) as at a date. Settlement
 * lives on the documents, so ageing reads them; the page checks the total
 * against the control account in the ledger.
 */
export async function openItems(s: Scope, kind: "receivable" | "payable", asOf: string): Promise<(OpenItem & { number: string | null; documentId: string; date: string })[]> {
  const rows = await s.tx
    .select({
      documentId: documents.id,
      number: documents.number,
      date: documents.date,
      dueDate: documents.dueDate,
      contactId: documents.contactId,
      contactName: contacts.name,
      open: sql<string>`${documents.total} - ${documents.tdsAmount} - ${documents.amountPaid}`,
    })
    .from(documents)
    .innerJoin(contacts, s.own(contacts, eq(contacts.id, documents.contactId)))
    .where(
      s.own(
        documents,
        eq(documents.type, kind === "receivable" ? "invoice" : "bill"),
        eq(documents.status, "posted"),
        lte(documents.date, asOf),
        sql`${documents.total} - ${documents.tdsAmount} - ${documents.amountPaid} <> 0`,
      ),
    )
    .orderBy(asc(documents.date));
  return rows.map((r) => ({ ...r, dueDate: r.dueDate ?? r.date, amount: Number(r.open) }));
}

/** Unapplied credit notes (receivable) or debit notes (payable), which reduce the balance owed. */
export async function unappliedNotes(s: Scope, kind: "receivable" | "payable", asOf: string): Promise<number> {
  const [row] = await s.tx
    .select({ n: sql<string>`coalesce(sum(${documents.total} - ${documents.amountPaid}), 0)` })
    .from(documents)
    .where(
      s.own(
        documents,
        eq(documents.type, kind === "receivable" ? "credit_note" : "debit_note"),
        eq(documents.status, "posted"),
        lte(documents.date, asOf),
      ),
    );
  return Number(row?.n ?? 0);
}

/** Posted and cancelled sales and purchase documents in a period, shaped for the GST returns. */
export async function gstDocuments(s: Scope, period: Required<Period>): Promise<GstDocument[]> {
  const docs = await s.tx
    .select({
      id: documents.id,
      type: documents.type,
      status: documents.status,
      number: documents.number,
      date: documents.date,
      gstin: contacts.gstin,
      contactName: contacts.name,
      placeOfSupply: documents.placeOfSupply,
      supplyType: documents.supplyType,
      reverseCharge: documents.reverseCharge,
      total: documents.total,
    })
    .from(documents)
    .innerJoin(contacts, s.own(contacts, eq(contacts.id, documents.contactId)))
    .where(
      s.own(
        documents,
        inArray(documents.status, ["posted", "cancelled"]),
        isNotNull(documents.number),
        gte(documents.date, period.from),
        lte(documents.date, period.to),
      ),
    )
    .orderBy(asc(documents.date), asc(documents.number));
  if (!docs.length) return [];
  const lines = await s.tx
    .select()
    .from(documentLines)
    .where(s.own(documentLines, inArray(documentLines.documentId, docs.map((d) => d.id))))
    .orderBy(asc(documentLines.position));
  const byDoc = new Map<string, (typeof lines)[number][]>();
  for (const l of lines) byDoc.set(l.documentId, [...(byDoc.get(l.documentId) ?? []), l]);
  return docs.map((d) => ({
    ...d,
    status: d.status as GstDocument["status"],
    number: d.number!,
    lines: (byDoc.get(d.id) ?? []).map((l) => ({
      hsnSac: l.hsnSac,
      description: l.description,
      unit: l.unit,
      quantityMilli: l.quantityMilli,
      gstRateBps: l.gstRateBps,
      taxable: l.taxable,
      cgst: l.cgst,
      sgst: l.sgst,
      igst: l.igst,
    })),
  }));
}

/** Net movement on GST accounts in a period: credits less debits for output and RCM, debits less credits for input. */
export async function gstLedgerMovements(s: Scope, period: Required<Period>) {
  const totals = await accountTotals(s, period);
  const tagged = await s.tx
    .select({ id: accounts.id, tag: accounts.systemTag })
    .from(accounts)
    .where(s.own(accounts, isNotNull(accounts.systemTag)));
  const tagOf = new Map(tagged.map((t) => [t.id, t.tag]));
  const net = (tag: string) => {
    const t = totals.find((a) => tagOf.get(a.id) === tag);
    if (!t) return 0;
    return tag.startsWith("input") ? t.debit - t.credit : t.credit - t.debit;
  };
  return {
    output: { igst: net("output_igst"), cgst: net("output_cgst"), sgst: net("output_sgst") },
    input: { igst: net("input_igst"), cgst: net("input_cgst"), sgst: net("input_sgst") },
    reverseCharge: { igst: net("rcm_igst_payable"), cgst: net("rcm_cgst_payable"), sgst: net("rcm_sgst_payable") },
  };
}

export interface TdsRow {
  contactId: string | null;
  contactName: string | null;
  pan: string | null;
  /** Net TDS for the period: deducted by us (payable) or by customers (receivable). */
  amount: number;
  entries: number;
}

/** TDS by contact from the TDS payable or receivable account. */
export async function tdsByContact(s: Scope, tag: "tds_payable" | "tds_receivable", period: Period): Promise<TdsRow[]> {
  const account = await accountByTag(s, tag);
  const sign = tag === "tds_payable" ? sql`${journalLines.credit} - ${journalLines.debit}` : sql`${journalLines.debit} - ${journalLines.credit}`;
  const rows = await s.tx
    .select({
      contactId: journalLines.contactId,
      contactName: contacts.name,
      pan: contacts.pan,
      amount: sql<string>`coalesce(sum(${sign}), 0)`,
      entries: sql<number>`count(distinct ${journalEntries.id})`.mapWith(Number),
    })
    .from(journalLines)
    .innerJoin(journalEntries, s.own(journalEntries, eq(journalEntries.id, journalLines.entryId), inPeriod(period)))
    .leftJoin(contacts, s.own(contacts, eq(contacts.id, journalLines.contactId)))
    .where(s.own(journalLines, eq(journalLines.accountId, account.id)))
    .groupBy(journalLines.contactId, contacts.name, contacts.pan)
    .orderBy(asc(contacts.name));
  return rows.map((r) => ({ ...r, amount: Number(r.amount) })).filter((r) => r.amount !== 0);
}
