import { randomUUID } from "node:crypto";
import { balanceSheet, profitAndLoss, trialBalance } from "@tevah/core";
import { eq } from "drizzle-orm";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withOrg, type Db } from "@/db";
import * as schema from "@/db/schema";
import type { Session } from "@/lib/auth";
import {
  bookStatementLine,
  createMoneyAccount,
  importStatement,
  matchStatementLine,
  moneyAccounts,
  statementLines,
  suggestMatches,
  unmatchedLedger,
  unmatchStatementLine,
} from "@/lib/banking";
import { cancelJournalVoucher, journalInput, postJournalVoucher } from "@/lib/journal";
import { cancelPayment, recordPayment } from "@/lib/payments";
import { createOrg } from "@/lib/org-setup";
import { accountTotals, ledgerRows } from "@/lib/reports";
import { freshDatabase } from "./db";

const url = process.env.TEST_DATABASE_URL;

const STATEMENT = `HDFC BANK Ltd.,,,,,,
Statement of account,,,,,,
Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance
01/10/26,NEFT CR-KARNATAKA CLIENT-INV 0001,N123,01/10/26,,"50,000.00","1,50,000.00"
03/10/26,CHG GST ON SMS ALERTS,,03/10/26,17.70,,"1,49,982.30"
05/10/26,UPI-TEA STALL,,05/10/26,500.00,,"1,49,482.30"
05/10/26,UPI-TEA STALL,,05/10/26,500.00,,"1,48,982.30"
,,,,,,
Generated on 22/10/26,,,,,,
`;

describe.skipIf(!url)("journal vouchers, reports and bank reconciliation against MySQL", () => {
  let pool: mysql.Pool;
  let db: Db;
  let session: Session;
  let other: Session;
  let bank: string;
  let customer: string;
  const acct: Record<string, string> = {};

  const as = <T>(who: Session, fn: Parameters<typeof withOrg<T>>[1]) => withOrg(who.orgId, fn, db);
  const year = { from: "2026-04-01", to: "2027-03-31" };

  beforeAll(async () => {
    ({ db, pool } = await freshDatabase(url!));
    const pw = "test-password-123";
    const a = await createOrg(db, { name: "Exaltes", gstin: "27AAJCE3276G1ZH" }, { email: "a@test.in", name: "A", password: pw });
    const b = await createOrg(db, { name: "Other", stateCode: "29" }, { email: "b@test.in", name: "B", password: pw });
    const base = { userName: "A", email: "a@test.in", orgName: "Exaltes", orgStateCode: "27", role: "admin" as const };
    session = { ...base, userId: a.userId, orgId: a.orgId };
    other = { ...base, userId: b.userId, orgId: b.orgId };
    await as(session, async (s) => {
      for (const a of await s.tx.select().from(schema.accounts).where(s.own(schema.accounts))) acct[a.code] = a.id;
      const [j] = await s.tx.select().from(schema.journals).where(s.own(schema.journals, eq(schema.journals.type, "bank")));
      bank = j!.id;
      customer = randomUUID();
      await s.tx.insert(schema.contacts).values({ id: customer, orgId: s.orgId, kind: "customer", name: "Karnataka client", stateCode: "29" });
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("posts a balanced journal voucher and refuses an unbalanced one", async () => {
    const bad = journalInput.safeParse({
      date: "2026-10-01",
      narration: "Capital",
      lines: [
        { accountId: acct["1110"], debit: "100000", credit: "" },
        { accountId: acct["3100"], debit: "", credit: "90000" },
      ],
    });
    expect(bad.success).toBe(false);

    const input = journalInput.parse({
      date: "2026-09-30",
      narration: "Opening capital",
      lines: [
        { accountId: acct["1110"], debit: "1,00,000", credit: "" },
        { accountId: acct["3100"], debit: "", credit: "100000" },
        { accountId: acct["5300"], debit: "", credit: "" },
      ],
    });
    expect(input.lines).toHaveLength(2);
    const id = await as(session, (s) => postJournalVoucher(s, session, input));
    const [entry] = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, id));
    expect(entry!.number).toBe("JV/26-27/0001");
    expect(entry!.status).toBe("posted");
  });

  it("builds a balanced trial balance, P&L and balance sheet from the ledger", async () => {
    await as(session, (s) =>
      recordPayment(s, session, "received", {
        contactId: customer,
        date: "2026-10-01",
        journalId: bank,
        amount: 50_000_00,
        tds: 0,
        reference: "INV 0001",
        allocations: [],
      }),
    );
    const totals = await as(session, (s) => accountTotals(s, { to: year.to }));
    const tb = trialBalance(totals);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit).toBe(1_50_000_00);
    const bs = balanceSheet(totals);
    expect(bs.balanced).toBe(true);
    expect(profitAndLoss(totals).netProfit).toBe(0);

    // The other company sees none of it.
    expect(await as(other, (s) => accountTotals(s, { to: year.to }))).toEqual([]);
  });

  it("imports a statement once, keeping same-day duplicates apart", async () => {
    const first = await as(session, (s) => importStatement(s, session, bank, STATEMENT));
    expect(first).toMatchObject({ added: 4, duplicates: 0, from: "2026-10-01", to: "2026-10-05" });
    const again = await as(session, (s) => importStatement(s, session, bank, STATEMENT));
    expect(again).toMatchObject({ added: 0, duplicates: 4 });
    await expect(as(other, (s) => importStatement(s, other, bank, STATEMENT))).rejects.toThrow("Bank account not found");
  });

  it("suggests and matches the customer receipt, then books bank charges", async () => {
    const lines = await as(session, (s) => statementLines(s, bank, "unmatched"));
    expect(lines).toHaveLength(4);
    const receipt = lines.find((l) => l.amount === 50_000_00)!;
    const ledger = await as(session, (s) => unmatchedLedger(s, bank));
    const suggestions = suggestMatches(lines, ledger);
    const best = suggestions.get(receipt.id)![0]!;
    expect(best.text).toContain("INV 0001");

    await expect(as(session, (s) => matchStatementLine(s, session, lines.find((l) => l.amount === -17_70)!.id, best.lineId))).rejects.toThrow(
      "amounts don't match",
    );
    await as(session, (s) => matchStatementLine(s, session, receipt.id, best.lineId));
    await expect(as(session, (s) => matchStatementLine(s, session, receipt.id, best.lineId))).rejects.toThrow("already matched");

    const charge = lines.find((l) => l.amount === -17_70)!;
    await expect(as(session, (s) => bookStatementLine(s, session, charge.id, { accountId: acct["1200"]! }))).rejects.toThrow("Payments");
    await as(session, (s) => bookStatementLine(s, session, charge.id, { accountId: acct["5370"]! }));

    expect(await as(session, (s) => statementLines(s, bank, "unmatched"))).toHaveLength(2);
    const rows = await as(session, (s) => ledgerRows(s, acct["5370"]!, year));
    expect(rows).toEqual([expect.objectContaining({ debit: 17_70, credit: 0, sourceRef: `bank:${charge.id}` })]);
    const [summary] = await as(session, (s) => moneyAccounts(s));
    expect(summary).toMatchObject({ balance: 1_50_000_00 - 17_70, statementLines: 4, unmatched: 2 });
  });

  it("unmatches when the matched entry is cancelled, and only cancels manual entries from the journal", async () => {
    const matched = await as(session, (s) => statementLines(s, bank, "matched"));
    const charge = matched.find((l) => l.amount === -17_70)!;
    await as(session, (s) => cancelJournalVoucher(s, session, charge.entryId!));
    const receipt = matched.find((l) => l.amount === 50_000_00)!;
    await expect(as(session, (s) => cancelJournalVoucher(s, session, receipt.entryId!))).rejects.toThrow("Cancel the invoice, bill or payment");

    const [pay] = await db.select().from(schema.payments).where(eq(schema.payments.journalEntryId, receipt.entryId!));
    await as(session, (s) => cancelPayment(s, session, pay!.id));
    expect(await as(session, (s) => statementLines(s, bank, "matched"))).toHaveLength(0);

    await as(session, (s) => unmatchStatementLine(s, session, receipt.id));
    expect(trialBalance(await as(session, (s) => accountTotals(s, { to: year.to }))).balanced).toBe(true);
  });

  it("adds a second bank account with its own ledger account and journal", async () => {
    const id = await as(session, (s) => createMoneyAccount(s, session, { name: "ICICI Current 4321", type: "bank" }));
    const [j] = await db.select().from(schema.journals).where(eq(schema.journals.id, id));
    expect(j!.code).toBe("BNK2");
    const [a] = await db.select().from(schema.accounts).where(eq(schema.accounts.id, j!.defaultAccountId!));
    expect(a).toMatchObject({ code: "1111", name: "ICICI Current 4321", type: "asset" });
  });
});
