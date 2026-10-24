import { eq, sql } from "drizzle-orm";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withOrg, type Db } from "@/db";
import * as schema from "@/db/schema";
import type { Session } from "@/lib/auth";
import { cancelDocument, deleteDraft, outstanding, postDocument, saveDraft, type DocumentInput } from "@/lib/documents";
import { cancelPayment, recordPayment } from "@/lib/payments";
import { createOrg } from "@/lib/org-setup";
import { freshDatabase } from "./db";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("invoices, bills and payments against MySQL", () => {
  let pool: mysql.Pool;
  let db: Db;
  let session: Session;
  let other: Session;
  let customer: string;
  let vendor: string;
  let bank: string;

  const line = (unitPrice: string, overrides: Partial<DocumentInput["lines"][number]> = {}) => ({
    description: "Consulting",
    quantity: 1000,
    unit: "HRS",
    unitPrice: Math.round(Number(unitPrice) * 100),
    discount: 0,
    gstRateBps: 1800,
    ...overrides,
  });
  const doc = (contactId: string, lines: DocumentInput["lines"], extra: Partial<DocumentInput> = {}): DocumentInput => ({
    contactId,
    date: "2026-10-22",
    placeOfSupply: "27",
    supplyType: "intra",
    reverseCharge: false,
    tdsRate: 0,
    lines,
    ...extra,
  });
  const as = <T>(who: Session, fn: Parameters<typeof withOrg<T>>[1]) => withOrg(who.orgId, fn, db);
  const getDoc = async (id: string) => (await db.select().from(schema.documents).where(eq(schema.documents.id, id)))[0]!;
  const accountBalance = async (orgId: string, tag: string) => {
    const [row] = await db
      .select({ debit: sql<string>`coalesce(sum(${schema.journalLines.debit}), 0)`, credit: sql<string>`coalesce(sum(${schema.journalLines.credit}), 0)` })
      .from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalEntries.id, schema.journalLines.entryId))
      .innerJoin(schema.accounts, eq(schema.accounts.id, schema.journalLines.accountId))
      .where(sql`${schema.journalLines.orgId} = ${orgId} and ${schema.accounts.systemTag} = ${tag} and ${schema.journalEntries.status} = 'posted'`);
    return Number(row!.debit) - Number(row!.credit);
  };

  beforeAll(async () => {
    ({ db, pool } = await freshDatabase(url!));
    const pw = "test-password-123";
    const a = await createOrg(db, { name: "Exaltes", gstin: "27AAJCE3276G1ZH" }, { email: "a@test.in", name: "A", password: pw });
    const b = await createOrg(db, { name: "Other", stateCode: "29" }, { email: "b@test.in", name: "B", password: pw });
    const base = { userName: "A", email: "a@test.in", orgName: "Exaltes", orgStateCode: "27", role: "admin" as const };
    session = { ...base, userId: a.userId, orgId: a.orgId };
    other = { ...base, userId: b.userId, orgId: b.orgId };
    await as(session, async (s) => {
      await s.tx.insert(schema.contacts).values([
        { orgId: s.orgId, kind: "customer", name: "Karnataka client", stateCode: "29" },
        { orgId: s.orgId, kind: "vendor", name: "Pune vendor", stateCode: "27" },
      ]);
      const rows = await s.tx.select().from(schema.contacts).where(s.own(schema.contacts));
      customer = rows.find((c) => c.kind === "customer")!.id;
      vendor = rows.find((c) => c.kind === "vendor")!.id;
      const [j] = await s.tx.select().from(schema.journals).where(s.own(schema.journals, eq(schema.journals.type, "bank")));
      bank = j!.id;
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("posts invoices with sequential GST numbers and a balanced ledger", async () => {
    const input = doc(customer, [line("1000"), line("333.33", { quantity: 2500, discount: 1000 })], {
      placeOfSupply: "29",
      supplyType: "inter",
    });
    const first = await as(session, (s) => saveDraft(s, session, "invoice", null, input));
    const second = await as(session, (s) => saveDraft(s, session, "invoice", null, input));
    expect(await as(session, (s) => postDocument(s, session, first))).toBe("INV/26-27/0001");
    expect(await as(session, (s) => postDocument(s, session, second))).toBe("INV/26-27/0002");

    const d = await getDoc(first);
    expect(d.status).toBe("posted");
    expect(d.igst).toBeGreaterThan(0);
    expect(d.cgst).toBe(0);
    expect(d.total % 100).toBe(0);
    expect(await accountBalance(session.orgId, "receivable")).toBe(2 * d.total);
    expect(await accountBalance(session.orgId, "output_igst")).toBe(-2 * d.igst);

    await expect(as(session, (s) => postDocument(s, session, first))).rejects.toThrow(/already posted/);
    await expect(as(session, (s) => saveDraft(s, session, "invoice", first, input))).rejects.toThrow(/Only drafts/);
  });

  it("keeps another company's documents out of reach", async () => {
    const [d] = await db.select().from(schema.documents).limit(1);
    await expect(as(other, (s) => cancelDocument(s, other, d!.id))).rejects.toThrow(/not found/);
    await expect(as(other, (s) => saveDraft(s, other, "invoice", null, doc(customer, [line("10")])))).rejects.toThrow(/Contact not found/);
  });

  it("settles an invoice with a receipt net of customer TDS, and reopens it on cancel", async () => {
    const id = await as(session, (s) => saveDraft(s, session, "invoice", null, doc(customer, [line("50000")])));
    await as(session, (s) => postDocument(s, session, id));
    const inv = await getDoc(id);
    const tds = 500000; // 10% of the taxable value
    const paymentId = await as(session, (s) =>
      recordPayment(s, session, "received", {
        contactId: customer,
        date: "2026-10-23",
        journalId: bank,
        amount: inv.total - tds,
        tds,
        allocations: [{ documentId: id, amount: inv.total }],
      }),
    );
    expect(outstanding(await getDoc(id))).toBe(0);
    expect(await accountBalance(session.orgId, "tds_receivable")).toBe(tds);
    await expect(as(session, (s) => cancelDocument(s, session, id))).rejects.toThrow(/Cancel the payments/);

    await as(session, (s) => cancelPayment(s, session, paymentId));
    expect(outstanding(await getDoc(id))).toBe(inv.total);
    expect(await accountBalance(session.orgId, "tds_receivable")).toBe(0);
  });

  it("refuses to over-settle a document", async () => {
    const id = await as(session, (s) => saveDraft(s, session, "invoice", null, doc(customer, [line("100")])));
    await as(session, (s) => postDocument(s, session, id));
    const inv = await getDoc(id);
    await expect(
      as(session, (s) =>
        recordPayment(s, session, "received", {
          contactId: customer,
          date: "2026-10-23",
          journalId: bank,
          amount: inv.total + 100,
          tds: 0,
          allocations: [{ documentId: id, amount: inv.total + 100 }],
        }),
      ),
    ).rejects.toThrow(/outstanding/);
  });

  it("applies a credit note to its invoice and un-applies it on cancel", async () => {
    const invId = await as(session, (s) => saveDraft(s, session, "invoice", null, doc(customer, [line("2000")])));
    await as(session, (s) => postDocument(s, session, invId));
    const cnId = await as(session, (s) =>
      saveDraft(s, session, "credit_note", null, doc(customer, [line("500")], { originalDocumentId: invId })),
    );
    expect(await as(session, (s) => postDocument(s, session, cnId))).toBe("CN/26-27/0001");
    const cn = await getDoc(cnId);
    expect(outstanding(await getDoc(invId))).toBe((await getDoc(invId)).total - cn.total);

    await as(session, (s) => cancelDocument(s, session, cnId));
    expect((await getDoc(invId)).amountPaid).toBe(0);
    expect((await getDoc(cnId)).status).toBe("cancelled");
  });

  it("posts a vendor bill with TDS and pays the net amount", async () => {
    const id = await as(session, (s) =>
      saveDraft(s, session, "bill", null, doc(vendor, [line("100000")], { tdsRate: 1000, tdsSection: "194J", vendorReference: "V-77" })),
    );
    expect(await as(session, (s) => postDocument(s, session, id))).toBe("BILL/26-27/0001");
    const bill = await getDoc(id);
    expect(bill.tdsAmount).toBe(1000000);
    expect(await accountBalance(session.orgId, "tds_payable")).toBe(-1000000);
    expect(await accountBalance(session.orgId, "input_cgst")).toBe(bill.cgst);

    await as(session, (s) =>
      recordPayment(s, session, "paid", {
        contactId: vendor,
        date: "2026-10-24",
        journalId: bank,
        amount: outstanding(bill),
        tds: 0,
        allocations: [{ documentId: id, amount: outstanding(bill) }],
      }),
    );
    expect(outstanding(await getDoc(id))).toBe(0);
    expect(await accountBalance(session.orgId, "payable")).toBe(0);
  });

  it("rejects the wrong kind of contact and deletes only drafts", async () => {
    await expect(as(session, (s) => saveDraft(s, session, "invoice", null, doc(vendor, [line("10")])))).rejects.toThrow(
      /not set up as a customer/,
    );
    const id = await as(session, (s) => saveDraft(s, session, "invoice", null, doc(customer, [line("10")])));
    await as(session, (s) => deleteDraft(s, session, id));
    expect(await db.select().from(schema.documents).where(eq(schema.documents.id, id))).toEqual([]);
  });

  it("keeps every posted entry balanced", async () => {
    const [row] = await db
      .select({ d: sql<string>`sum(${schema.journalLines.debit})`, c: sql<string>`sum(${schema.journalLines.credit})` })
      .from(schema.journalLines);
    expect(Number(row!.d)).toBe(Number(row!.c));
  });
});
