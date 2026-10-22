import { matchCandidates, parseBankStatement, statementRowKey, type LedgerCandidate } from "@tevah/core";
import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, like, sql } from "drizzle-orm";
import { z } from "zod";
import type { Scope } from "@/db";
import { accounts, bankStatementLines, journalEntries, journalLines, journals } from "@/db/schema";
import { audit } from "./audit";
import type { Session } from "./auth";
import { UserError } from "./documents";
import { createPostedEntry } from "./ledger";

export async function bankJournal(s: Scope, journalId: string) {
  const [row] = await s.tx
    .select({ journal: journals, account: accounts })
    .from(journals)
    .innerJoin(accounts, s.own(accounts, eq(accounts.id, journals.defaultAccountId)))
    .where(s.own(journals, eq(journals.id, journalId), inArray(journals.type, ["bank", "cash"])));
  if (!row) throw new UserError("Bank account not found");
  return row;
}

/** Bank and cash accounts with their ledger balance and reconciliation status. */
export async function moneyAccounts(s: Scope) {
  const rows = await s.tx
    .select({
      journalId: journals.id,
      code: journals.code,
      type: journals.type,
      name: accounts.name,
      accountId: accounts.id,
      accountCode: accounts.code,
    })
    .from(journals)
    .innerJoin(accounts, s.own(accounts, eq(accounts.id, journals.defaultAccountId)))
    .where(s.own(journals, inArray(journals.type, ["bank", "cash"])))
    .orderBy(asc(journals.type), asc(accounts.code));
  const balances = await s.tx
    .select({ accountId: journalLines.accountId, n: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)` })
    .from(journalLines)
    .innerJoin(journalEntries, s.own(journalEntries, eq(journalEntries.id, journalLines.entryId), eq(journalEntries.status, "posted")))
    .where(s.own(journalLines, inArray(journalLines.accountId, rows.map((r) => r.accountId).concat([""]))))
    .groupBy(journalLines.accountId);
  const stats = await s.tx
    .select({
      journalId: bankStatementLines.journalId,
      lines: sql<number>`count(*)`.mapWith(Number),
      unmatched: sql<number>`coalesce(sum(${bankStatementLines.matchedLineId} is null), 0)`.mapWith(Number),
      lastDate: sql<string | null>`max(${bankStatementLines.date})`,
    })
    .from(bankStatementLines)
    .where(s.own(bankStatementLines))
    .groupBy(bankStatementLines.journalId);
  return rows.map((r) => ({
    ...r,
    balance: Number(balances.find((b) => b.accountId === r.accountId)?.n ?? 0),
    statementLines: stats.find((x) => x.journalId === r.journalId)?.lines ?? 0,
    unmatched: stats.find((x) => x.journalId === r.journalId)?.unmatched ?? 0,
    lastStatementDate: stats.find((x) => x.journalId === r.journalId)?.lastDate ?? null,
  }));
}

export const bankAccountInput = z.object({
  name: z.string().trim().min(2, "Name the account, e.g. HDFC Current 1234").max(150),
  type: z.enum(["bank", "cash"]).default("bank"),
});

/** Add a bank or cash account: a ledger account plus the journal its money moves through. */
export async function createMoneyAccount(s: Scope, session: Session, input: z.output<typeof bankAccountInput>): Promise<string> {
  const base = input.type === "bank" ? 1110 : 1100;
  const used = await s.tx
    .select({ code: accounts.code })
    .from(accounts)
    .where(s.own(accounts, like(accounts.code, `${String(base).slice(0, 3)}%`)));
  const taken = new Set(used.map((u) => u.code));
  let code = base + 1;
  while (taken.has(String(code)) && code < base + 9) code++;
  if (taken.has(String(code))) throw new UserError("No free account codes left in this range");

  const prefix = input.type === "bank" ? "BNK" : "CSH";
  const codes = await s.tx.select({ code: journals.code }).from(journals).where(s.own(journals, like(journals.code, `${prefix}%`)));
  let n = 2;
  while (codes.some((c) => c.code === `${prefix}${n}`)) n++;

  const accountId = randomUUID();
  await s.tx.insert(accounts).values({ id: accountId, orgId: s.orgId, code: String(code), name: input.name, type: "asset" });
  const journalId = randomUUID();
  await s.tx.insert(journals).values({
    id: journalId,
    orgId: s.orgId,
    code: `${prefix}${n}`,
    name: input.name,
    type: input.type,
    defaultAccountId: accountId,
  });
  await audit(s, session, "create", "bank_account", journalId, { name: input.name, code });
  return journalId;
}

export async function renameMoneyAccount(s: Scope, session: Session, journalId: string, name: string): Promise<void> {
  const { account } = await bankJournal(s, journalId);
  await s.tx.update(accounts).set({ name }).where(s.own(accounts, eq(accounts.id, account.id)));
  await s.tx.update(journals).set({ name }).where(s.own(journals, eq(journals.id, journalId)));
  await audit(s, session, "update", "bank_account", journalId, { name });
}

export interface ImportResult {
  added: number;
  duplicates: number;
  skipped: { line: number; reason: string }[];
  from: string | null;
  to: string | null;
}

/** Load a statement CSV into a bank account, skipping lines already imported. */
export async function importStatement(s: Scope, session: Session, journalId: string, csv: string): Promise<ImportResult> {
  await bankJournal(s, journalId);
  let parsed;
  try {
    parsed = parseBankStatement(csv);
  } catch (e) {
    throw new UserError(e instanceof Error ? e.message : "Couldn't read the file");
  }
  if (!parsed.rows.length) throw new UserError("No transactions found in the file");

  // Identical rows on the same day (two ₹500 UPI payments) stay distinct by their position among equals.
  const seen = new Map<string, number>();
  const rows = parsed.rows.map((row) => {
    const base = statementRowKey(row, 0);
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return { row, key: createHash("sha256").update(statementRowKey(row, occurrence)).digest("hex") };
  });
  const existing = await s.tx
    .select({ key: bankStatementLines.rowKey })
    .from(bankStatementLines)
    .where(s.own(bankStatementLines, eq(bankStatementLines.journalId, journalId), inArray(bankStatementLines.rowKey, rows.map((r) => r.key))));
  const have = new Set(existing.map((e) => e.key));
  const fresh = rows.filter((r) => !have.has(r.key));
  const batch = randomUUID();
  if (fresh.length) {
    await s.tx.insert(bankStatementLines).values(
      fresh.map(({ row, key }) => ({
        orgId: s.orgId,
        journalId,
        date: row.date,
        description: row.description || "(no description)",
        reference: row.reference,
        amount: row.amount,
        balance: row.balance,
        rowKey: key,
        importBatch: batch,
      })),
    );
  }
  const dates = parsed.rows.map((r) => r.date).sort();
  await audit(s, session, "create", "bank_statement", batch, { journalId, added: fresh.length });
  return { added: fresh.length, duplicates: rows.length - fresh.length, skipped: parsed.skipped, from: dates[0] ?? null, to: dates.at(-1) ?? null };
}

export type StatementFilter = "unmatched" | "matched" | "all";

export async function statementLines(s: Scope, journalId: string, filter: StatementFilter) {
  return s.tx
    .select({
      id: bankStatementLines.id,
      date: bankStatementLines.date,
      description: bankStatementLines.description,
      reference: bankStatementLines.reference,
      amount: bankStatementLines.amount,
      balance: bankStatementLines.balance,
      matchedLineId: bankStatementLines.matchedLineId,
      entryId: journalEntries.id,
      entryNumber: journalEntries.number,
      entryNarration: journalEntries.narration,
    })
    .from(bankStatementLines)
    .leftJoin(journalLines, s.own(journalLines, eq(journalLines.id, bankStatementLines.matchedLineId)))
    .leftJoin(journalEntries, s.own(journalEntries, eq(journalEntries.id, journalLines.entryId)))
    .where(
      s.own(
        bankStatementLines,
        eq(bankStatementLines.journalId, journalId),
        filter === "unmatched" ? isNull(bankStatementLines.matchedLineId) : undefined,
        filter === "matched" ? sql`${bankStatementLines.matchedLineId} is not null` : undefined,
      ),
    )
    .orderBy(desc(bankStatementLines.date), desc(bankStatementLines.createdAt))
    .limit(500);
}

/** Posted ledger lines on the bank account not yet matched to a statement line. */
export async function unmatchedLedger(s: Scope, journalId: string): Promise<LedgerCandidate[]> {
  const { account } = await bankJournal(s, journalId);
  const matched = await s.tx
    .select({ id: bankStatementLines.matchedLineId })
    .from(bankStatementLines)
    .where(s.own(bankStatementLines, sql`${bankStatementLines.matchedLineId} is not null`));
  const taken = new Set(matched.map((m) => m.id));
  const rows = await s.tx
    .select({
      lineId: journalLines.id,
      date: journalEntries.date,
      debit: journalLines.debit,
      credit: journalLines.credit,
      number: journalEntries.number,
      reference: journalEntries.reference,
      narration: journalEntries.narration,
      description: journalLines.description,
    })
    .from(journalLines)
    .innerJoin(journalEntries, s.own(journalEntries, eq(journalEntries.id, journalLines.entryId), eq(journalEntries.status, "posted")))
    .where(s.own(journalLines, eq(journalLines.accountId, account.id)))
    .orderBy(desc(journalEntries.date));
  return rows
    .filter((r) => !taken.has(r.lineId))
    .map((r) => ({
      lineId: r.lineId,
      date: r.date,
      amount: r.debit - r.credit,
      text: [r.number, r.reference, r.narration, r.description].filter(Boolean).join(" "),
    }));
}

/** Suggested ledger matches for each unmatched statement line. */
export function suggestMatches(
  lines: { id: string; date: string; amount: number; description: string; reference: string | null; matchedLineId: string | null }[],
  ledger: LedgerCandidate[],
): Map<string, LedgerCandidate[]> {
  const out = new Map<string, LedgerCandidate[]>();
  for (const l of lines) if (!l.matchedLineId) out.set(l.id, matchCandidates(l, ledger).slice(0, 3));
  return out;
}

async function lockedStatementLine(s: Scope, id: string) {
  const [line] = await s.tx.select().from(bankStatementLines).where(s.own(bankStatementLines, eq(bankStatementLines.id, id))).for("update");
  if (!line) throw new UserError("Statement line not found");
  return line;
}

/** Reconcile a statement line with a ledger line on the same bank account. */
export async function matchStatementLine(s: Scope, session: Session, statementLineId: string, journalLineId: string): Promise<void> {
  const line = await lockedStatementLine(s, statementLineId);
  if (line.matchedLineId) throw new UserError("This line is already matched");
  const { account } = await bankJournal(s, line.journalId);
  const [ledger] = await s.tx
    .select({ debit: journalLines.debit, credit: journalLines.credit, accountId: journalLines.accountId })
    .from(journalLines)
    .innerJoin(journalEntries, s.own(journalEntries, eq(journalEntries.id, journalLines.entryId), eq(journalEntries.status, "posted")))
    .where(s.own(journalLines, eq(journalLines.id, journalLineId)));
  if (!ledger || ledger.accountId !== account.id) throw new UserError("That entry isn't on this bank account");
  if (ledger.debit - ledger.credit !== line.amount) throw new UserError("The amounts don't match");
  const [other] = await s.tx
    .select({ id: bankStatementLines.id })
    .from(bankStatementLines)
    .where(s.own(bankStatementLines, eq(bankStatementLines.matchedLineId, journalLineId)));
  if (other) throw new UserError("That entry is already matched to another statement line");
  await s.tx.update(bankStatementLines).set({ matchedLineId: journalLineId }).where(s.own(bankStatementLines, eq(bankStatementLines.id, line.id)));
  await audit(s, session, "update", "bank_statement_line", line.id, { matchedLineId: journalLineId });
}

export async function unmatchStatementLine(s: Scope, session: Session, statementLineId: string): Promise<void> {
  const line = await lockedStatementLine(s, statementLineId);
  await s.tx.update(bankStatementLines).set({ matchedLineId: null }).where(s.own(bankStatementLines, eq(bankStatementLines.id, line.id)));
  await audit(s, session, "update", "bank_statement_line", line.id, { matchedLineId: null });
}

export const quickEntryInput = z.object({
  accountId: z.uuid("Choose an account"),
  narration: z.string().trim().max(2000).nullish(),
});

/**
 * Book a statement line that has no entry yet (bank charges, interest,
 * a transfer) against another account, and reconcile it in one go.
 */
export async function bookStatementLine(s: Scope, session: Session, statementLineId: string, input: z.output<typeof quickEntryInput>): Promise<void> {
  const line = await lockedStatementLine(s, statementLineId);
  if (line.matchedLineId) throw new UserError("This line is already matched");
  const { journal, account } = await bankJournal(s, line.journalId);
  if (input.accountId === account.id) throw new UserError("Choose an account other than the bank itself");
  const [other] = await s.tx
    .select({ id: accounts.id, tag: accounts.systemTag })
    .from(accounts)
    .where(s.own(accounts, eq(accounts.id, input.accountId), eq(accounts.archived, false)));
  if (!other) throw new UserError("Account not found");
  if (other.tag === "receivable" || other.tag === "payable") {
    throw new UserError("Record customer and vendor money from Payments, so it settles their invoices and bills");
  }
  const amount = Math.abs(line.amount);
  const moneyIn = line.amount > 0;
  const entryId = await createPostedEntry(s, {
    journalId: journal.id,
    date: line.date,
    reference: line.reference,
    narration: input.narration || line.description,
    sourceRef: `bank:${line.id}`,
    createdBy: session.userId,
    lines: [
      { accountId: account.id, debit: moneyIn ? amount : 0, credit: moneyIn ? 0 : amount, description: line.description },
      { accountId: other.id, debit: moneyIn ? 0 : amount, credit: moneyIn ? amount : 0, description: line.description },
    ],
  });
  const [bankLine] = await s.tx
    .select({ id: journalLines.id })
    .from(journalLines)
    .where(s.own(journalLines, eq(journalLines.entryId, entryId), eq(journalLines.accountId, account.id)));
  await s.tx.update(bankStatementLines).set({ matchedLineId: bankLine!.id }).where(s.own(bankStatementLines, eq(bankStatementLines.id, line.id)));
  await audit(s, session, "post", "bank_statement_line", line.id, { entryId });
}

/** Remove an unmatched statement line imported by mistake. */
export async function deleteStatementLine(s: Scope, session: Session, statementLineId: string): Promise<void> {
  const line = await lockedStatementLine(s, statementLineId);
  if (line.matchedLineId) throw new UserError("Unmatch the line before deleting it");
  await s.tx.delete(bankStatementLines).where(s.own(bankStatementLines, and(eq(bankStatementLines.id, line.id), isNull(bankStatementLines.matchedLineId))));
  await audit(s, session, "archive", "bank_statement_line", line.id, { deleted: true });
}

/** Statement balance against the ledger, as at the last statement date. */
export async function reconciliationSummary(s: Scope, journalId: string) {
  const { account } = await bankJournal(s, journalId);
  const [last] = await s.tx
    .select({ date: bankStatementLines.date, balance: bankStatementLines.balance })
    .from(bankStatementLines)
    .where(s.own(bankStatementLines, eq(bankStatementLines.journalId, journalId)))
    .orderBy(desc(bankStatementLines.date), desc(bankStatementLines.createdAt))
    .limit(1);
  if (!last) return null;
  const [ledger] = await s.tx
    .select({ n: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)` })
    .from(journalLines)
    .innerJoin(
      journalEntries,
      s.own(journalEntries, eq(journalEntries.id, journalLines.entryId), eq(journalEntries.status, "posted"), sql`${journalEntries.date} <= ${last.date}`),
    )
    .where(s.own(journalLines, eq(journalLines.accountId, account.id)));
  const [open] = await s.tx
    .select({ n: sql<string>`coalesce(sum(${bankStatementLines.amount}), 0)`, count: sql<number>`count(*)`.mapWith(Number) })
    .from(bankStatementLines)
    .where(s.own(bankStatementLines, eq(bankStatementLines.journalId, journalId), isNull(bankStatementLines.matchedLineId)));
  return {
    asOf: last.date,
    statementBalance: last.balance,
    ledgerBalance: Number(ledger?.n ?? 0),
    unmatchedCount: open?.count ?? 0,
    unmatchedTotal: Number(open?.n ?? 0),
  };
}
