import { randomUUID } from "node:crypto";
import { assertBalanced, SYSTEM_TAGS, type EntryLine, type SystemAccounts } from "@tevah/core";
import { eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Scope } from "@/db";
import { accounts, bankStatementLines, journalEntries, journalLines, journals, sequences } from "@/db/schema";

/** Accounts the posting rules need, by system tag. */
export async function systemAccounts(s: Scope): Promise<SystemAccounts> {
  const rows = await s.tx
    .select({ id: accounts.id, tag: accounts.systemTag })
    .from(accounts)
    .where(s.own(accounts, isNotNull(accounts.systemTag)));
  const byTag = new Map(rows.map((r) => [r.tag, r.id]));
  const missing = SYSTEM_TAGS.filter((t) => !byTag.has(t));
  if (missing.length) throw new Error(`Chart of accounts is missing: ${missing.join(", ")}`);
  return Object.fromEntries(SYSTEM_TAGS.map((t) => [t, byTag.get(t)!])) as SystemAccounts;
}

export async function journalByType(s: Scope, type: (typeof journals.$inferSelect)["type"]) {
  const [journal] = await s.tx.select().from(journals).where(s.own(journals, eq(journals.type, type))).limit(1);
  if (!journal) throw new Error(`No ${type} journal set up`);
  return journal;
}

/** Next value of a per-org counter; the row lock serialises concurrent posts until commit. */
export async function nextSequence(s: Scope, key: string): Promise<number> {
  await s.tx
    .insert(sequences)
    .values({ orgId: s.orgId, key, lastValue: 1 })
    .onDuplicateKeyUpdate({ set: { lastValue: sql`${sequences.lastValue} + 1` } });
  const [row] = await s.tx
    .select({ value: sequences.lastValue })
    .from(sequences)
    .where(s.own(sequences, eq(sequences.key, key)));
  return row!.value;
}

export interface NewEntry {
  journalId: string;
  date: string;
  number?: string | null;
  reference?: string | null;
  narration?: string | null;
  sourceRef: string;
  createdBy: string;
  lines: EntryLine[];
}

/** Write a balanced, posted journal entry. */
export async function createPostedEntry(s: Scope, e: NewEntry): Promise<string> {
  assertBalanced(e.lines);
  const entryId = randomUUID();
  await s.tx.insert(journalEntries).values({
    id: entryId,
    orgId: s.orgId,
    journalId: e.journalId,
    date: e.date,
    number: e.number,
    reference: e.reference,
    narration: e.narration,
    sourceRef: e.sourceRef,
    status: "posted",
    postedAt: new Date(),
    createdBy: e.createdBy,
  });
  await s.tx.insert(journalLines).values(
    e.lines.map((l) => ({
      orgId: s.orgId,
      entryId,
      accountId: l.accountId,
      contactId: l.contactId ?? null,
      description: l.description ?? null,
      debit: l.debit,
      credit: l.credit,
    })),
  );
  return entryId;
}

/**
 * Cancelled entries stay for the audit trail but drop out of every balance.
 * Bank statement lines matched to them go back to unreconciled.
 */
export async function cancelEntry(s: Scope, entryId: string): Promise<void> {
  await s.tx
    .update(journalEntries)
    .set({ status: "cancelled" })
    .where(s.own(journalEntries, eq(journalEntries.id, entryId), eq(journalEntries.status, "posted")));
  const lines = await s.tx.select({ id: journalLines.id }).from(journalLines).where(s.own(journalLines, eq(journalLines.entryId, entryId)));
  if (lines.length) {
    await s.tx
      .update(bankStatementLines)
      .set({ matchedLineId: null })
      .where(s.own(bankStatementLines, inArray(bankStatementLines.matchedLineId, lines.map((l) => l.id))));
  }
}
