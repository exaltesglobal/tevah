import { createHmac } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withOrg, type Db } from "@/db";
import * as schema from "@/db/schema";
import type { Session } from "@/lib/auth";
import { createApp, replayAppEvent, signForTevah, verifyRazorpay, verifyTevahSignature, type ConnectedApp } from "@/lib/connected-apps";
import { sentMail } from "@/lib/mail";
import { createOrg } from "@/lib/org-setup";
import { freshDatabase } from "./db";

describe("signatures", () => {
  const secret = "s3cret";
  it("accepts an app's fresh signature and refuses stale or wrong ones", () => {
    const body = '{"paymentId":"p1"}';
    const now = 1_792_800_000_000;
    const header = signForTevah(body, secret, now);
    expect(header).toMatch(/^t=1792800000,v1=[0-9a-f]{64}$/);
    expect(verifyTevahSignature(body, header, secret, now + 60_000)).toBe(true);
    expect(verifyTevahSignature(body, header, secret, now + 6 * 60_000)).toBe(false);
    expect(verifyTevahSignature(body, header, "other", now)).toBe(false);
    expect(verifyTevahSignature(body + " ", header, secret, now)).toBe(false);
    expect(verifyTevahSignature(body, null, secret, now)).toBe(false);
  });

  it("checks Razorpay's HMAC of the raw body", () => {
    const raw = '{"event":"payment.captured"}';
    const sig = createHmac("sha256", secret).update(raw).digest("hex");
    expect(verifyRazorpay(raw, sig, secret)).toBe(true);
    expect(verifyRazorpay(raw, sig.toUpperCase(), secret)).toBe(true);
    expect(verifyRazorpay(raw, "00" + sig.slice(2), secret)).toBe(false);
    expect(verifyRazorpay(raw, null, secret)).toBe(false);
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("connected apps against MySQL", () => {
  let pool: mysql.Pool;
  let db: Db;
  let session: Session;
  let app: ConnectedApp;
  let apiApp: ConnectedApp;
  let bankJournal: string;
  let razorpayPost: (req: Request, ctx: { params: Promise<{ org: string; app: string }> }) => Promise<Response>;
  let apiPost: typeof razorpayPost;

  const as = <T>(fn: Parameters<typeof withOrg<T>>[1]) => withOrg(session.orgId, fn, db);
  const sign = (raw: string, secret: string) => createHmac("sha256", secret).update(raw).digest("hex");
  const post = async (which: "razorpay" | "api", target: ConnectedApp, body: unknown, headers: Record<string, string>) => {
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    const req = new Request(`http://tevah.test/api/apps/${session.orgId}/${target.id}/${which === "razorpay" ? "razorpay" : "payments"}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: raw,
    });
    const res = await (which === "razorpay" ? razorpayPost : apiPost)(req, { params: Promise.resolve({ org: session.orgId, app: target.id }) });
    const text = await res.text();
    return { status: res.status, body: text.startsWith("{") ? (JSON.parse(text) as Record<string, unknown>) : text };
  };
  const razorpay = (target: ConnectedApp, body: unknown) => {
    const raw = JSON.stringify(body);
    return post("razorpay", target, raw, { "x-razorpay-signature": sign(raw, target.secret) });
  };
  const payment = (id: string, over: Record<string, unknown> = {}) => ({
    event: "payment.captured",
    created_at: 1792800001,
    payload: {
      payment: {
        entity: {
          id,
          amount: 49900,
          currency: "INR",
          status: "captured",
          method: "upi",
          description: "Pro plan",
          email: "priya@example.com",
          contact: "+919876543210",
          customer_id: "cust_1",
          notes: { app: "chitthi", company: "Shah Studio", gstin: "29AABCA1234B1ZD" },
          fee: 1178,
          tax: 180,
          created_at: 1792800000,
          ...over,
        },
      },
    },
  });
  const docByRef = async (externalRef: string) => (await db.select().from(schema.documents).where(and(eq(schema.documents.orgId, session.orgId), eq(schema.documents.externalRef, externalRef))))[0];
  const balance = async (code: string) => {
    const [row] = await db
      .select({ debit: sql<string>`coalesce(sum(${schema.journalLines.debit}), 0)`, credit: sql<string>`coalesce(sum(${schema.journalLines.credit}), 0)` })
      .from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalEntries.id, schema.journalLines.entryId))
      .innerJoin(schema.accounts, eq(schema.accounts.id, schema.journalLines.accountId))
      .where(sql`${schema.journalLines.orgId} = ${session.orgId} and ${schema.accounts.code} = ${code} and ${schema.journalEntries.status} = 'posted'`);
    return Number(row!.debit) - Number(row!.credit);
  };

  beforeAll(async () => {
    ({ db, pool } = await freshDatabase(url!));
    // The route handlers open the shared pool from DATABASE_URL, so point it at the test database before loading them.
    process.env.DATABASE_URL = url!;
    process.env.MAIL_TRANSPORT = "json";
    process.env.APP_URL = "https://tevah.test";
    ({ POST: razorpayPost } = await import("../src/app/api/apps/[org]/[app]/razorpay/route"));
    ({ POST: apiPost } = await import("../src/app/api/apps/[org]/[app]/payments/route"));

    const a = await createOrg(db, { name: "Exaltes", gstin: "27AAJCE3276G1ZH" }, { email: "a@test.in", name: "A", password: "test-password-123" });
    session = { userId: a.userId, orgId: a.orgId, userName: "A", email: "a@test.in", orgName: "Exaltes", orgStateCode: "27", role: "admin" };
    await as(async (s) => {
      const acct = async (code: string) => (await s.tx.select({ id: schema.accounts.id }).from(schema.accounts).where(s.own(schema.accounts, eq(schema.accounts.code, code))))[0]!.id;
      const [bank] = await s.tx.select().from(schema.journals).where(s.own(schema.journals, eq(schema.journals.type, "bank")));
      bankJournal = bank!.id;
      const base = { sac: "998315", gstRateBps: 1800, incomeAccountId: await acct("4100"), feeAccountId: await acct("5370"), bankJournalId: bank!.id, emailInvoices: true, active: true };
      const id = await createApp(s, session, { ...base, name: "Chitthi", source: "razorpay", notesFilter: "chitthi", journalId: null });
      const [first] = await s.tx.select({ journalId: schema.connectedApps.journalId }).from(schema.connectedApps).where(s.own(schema.connectedApps, eq(schema.connectedApps.id, id)));
      await expect(createApp(s, session, { ...base, name: "No journal", source: "api", notesFilter: null, journalId: null, bankJournalId: null })).rejects.toThrow(/bank account/);
      const apiId = await createApp(s, session, { ...base, name: "Flockwise", source: "api", notesFilter: null, journalId: first!.journalId, bankJournalId: null });
      const rows = await s.tx.select().from(schema.connectedApps).where(s.own(schema.connectedApps));
      app = rows.find((r) => r.id === id)!;
      apiApp = rows.find((r) => r.id === apiId)!;
    });
  });

  afterAll(async () => {
    const { getDb } = await import("@/db");
    await (getDb() as unknown as { $client: mysql.Pool }).$client.end();
    await pool?.end();
  });

  it("makes a Razorpay clearing journal for a Razorpay app, which other apps can share", async () => {
    const [journal] = await db.select().from(schema.journals).where(eq(schema.journals.id, app.journalId));
    expect(journal).toMatchObject({ code: "RZP", name: "Razorpay", type: "bank" });
    expect(apiApp.journalId).toBe(app.journalId);
  });

  it("refuses unknown apps, bad signatures and paused apps", async () => {
    const body = payment("pay_x");
    expect((await post("razorpay", { ...app, id: "00000000-0000-4000-8000-000000000000" }, body, {})).status).toBe(404);
    expect((await post("razorpay", app, body, { "x-razorpay-signature": "deadbeef" })).status).toBe(401);
    expect((await post("razorpay", apiApp, body, { "x-razorpay-signature": sign(JSON.stringify(body), apiApp.secret) })).status).toBe(404);
    await db.update(schema.connectedApps).set({ active: false }).where(eq(schema.connectedApps.id, app.id));
    expect((await razorpay(app, body)).status).toBe(410);
    await db.update(schema.connectedApps).set({ active: true }).where(eq(schema.connectedApps.id, app.id));
    expect(await db.select().from(schema.appPayments).where(eq(schema.appPayments.orgId, session.orgId))).toEqual([]);
  });

  it("books a captured payment as a paid IGST invoice, the fee, and emails the customer", async () => {
    const res = await razorpay(app, payment("pay_1"));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "invoiced" });
    const doc = (await docByRef(`app:${app.id}:pay_1`))!;
    expect(doc).toMatchObject({ type: "invoice", status: "posted", supplyType: "inter", placeOfSupply: "29", total: 49900, amountPaid: 49900, igst: 7612, cgst: 0 });
    expect(doc.number).toMatch(/^INV\//);
    expect(doc.shareToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const [line] = await db.select().from(schema.documentLines).where(eq(schema.documentLines.documentId, doc.id));
    expect(line).toMatchObject({ description: "Chitthi – Pro plan", hsnSac: "998315", unitPrice: 42288, gstRateBps: 1800 });
    const [customer] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, doc.contactId));
    expect(customer).toMatchObject({ name: "Shah Studio", gstin: "29AABCA1234B1ZD", stateCode: "29", email: "priya@example.com", externalRef: `app:${app.id}:customer:cust_1` });
    // Receipt into the clearing account, fee out of it: Razorpay owes us the net.
    expect(await balance("1120")).toBe(49900 - 1178);
    expect(await balance("5370")).toBe(998);
    expect(await balance("1200")).toBe(0);
    const [row] = await db.select().from(schema.appPayments).where(eq(schema.appPayments.externalId, "pay_1"));
    expect(row).toMatchObject({ status: "invoiced", documentId: doc.id, emailStatus: "sent", customerEmail: "priya@example.com" });
    expect(row!.paymentId).toBeTruthy();
    const mail = sentMail.at(-1)!;
    expect(mail.to).toBe("priya@example.com");
    expect(mail.subject).toBe(`Invoice ${doc.number} from Exaltes: ₹499.00 paid`);
    expect(mail.text).toContain(`https://tevah.test/invoice/${session.orgId}/${doc.shareToken}`);
    expect(mail.text).toContain("Chitthi");
  });

  it("books a retried webhook once", async () => {
    const before = sentMail.length;
    const res = await razorpay(app, payment("pay_1"));
    expect(res.body).toMatchObject({ status: "duplicate" });
    expect(sentMail.length).toBe(before);
    const docs = await db.select().from(schema.documents).where(eq(schema.documents.externalRef, `app:${app.id}:pay_1`));
    expect(docs).toHaveLength(1);
  });

  it("ignores payments tagged for another app and events it doesn't book", async () => {
    const other = await razorpay(app, payment("pay_other", { notes: { app: "flockwise" } }));
    expect(other.body).toMatchObject({ status: "ignored" });
    const authorized = await razorpay(app, { ...payment("pay_auth"), event: "payment.authorized" });
    expect(authorized.body).toMatchObject({ status: "ignored" });
    expect(await docByRef(`app:${app.id}:pay_other`)).toBeUndefined();
    const [row] = await db.select().from(schema.appPayments).where(eq(schema.appPayments.externalId, "pay_other"));
    expect(row).toMatchObject({ status: "ignored", error: "Tagged for flockwise, not chitthi" });
  });

  it("books an intra-state payment with CGST and SGST when the customer gives a state", async () => {
    await razorpay(app, payment("pay_2", { customer_id: "cust_2", email: "ravi@example.com", notes: { app: "chitthi", name: "Ravi", state: "27" } }));
    const doc = (await docByRef(`app:${app.id}:pay_2`))!;
    expect(doc).toMatchObject({ supplyType: "intra", placeOfSupply: "27", total: 49900, cgst: 3806, sgst: 3806, igst: 0 });
  });

  it("needs the LUT number before invoicing a customer abroad, then books a zero-rated export", async () => {
    const body = payment("pay_3", { customer_id: "cust_3", email: "jane@example.com", international: true, notes: { app: "chitthi", name: "Jane Doe", country: "US" } });
    const failed = await razorpay(app, body);
    expect(failed.status).toBe(200);
    expect(failed.body).toMatchObject({ status: "failed" });
    const [row] = await db.select().from(schema.appPayments).where(eq(schema.appPayments.externalId, "pay_3"));
    expect(row!.error).toMatch(/LUT number/);
    expect(await docByRef(`app:${app.id}:pay_3`)).toBeUndefined();

    await db.update(schema.orgs).set({ lut: "AD270326000123X" }).where(eq(schema.orgs.id, session.orgId));
    const booked = await as((s) => replayAppEvent(s, app, row!.id));
    expect(booked.status).toBe("invoiced");
    const doc = (await docByRef(`app:${app.id}:pay_3`))!;
    expect(doc).toMatchObject({ supplyType: "export", placeOfSupply: "96", taxable: 49900, igst: 0, cgst: 0, total: 49900, amountPaid: 49900 });
    const [customer] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, doc.contactId));
    expect(customer).toMatchObject({ name: "Jane Doe", gstin: null, stateCode: null });
    const [after] = await db.select().from(schema.appPayments).where(eq(schema.appPayments.externalId, "pay_3"));
    expect(after).toMatchObject({ status: "invoiced", documentId: doc.id, error: null });
  });

  it("turns a part refund into a credit note paid out of the clearing account", async () => {
    const clearingBefore = await balance("1120");
    const res = await razorpay(app, {
      event: "refund.processed",
      payload: { refund: { entity: { id: "rfnd_1", payment_id: "pay_1", amount: 10000, created_at: 1792886400 } }, payment: { entity: payment("pay_1").payload.payment.entity } },
    });
    expect(res.body).toMatchObject({ status: "invoiced" });
    const invoice = (await docByRef(`app:${app.id}:pay_1`))!;
    const note = (await docByRef(`app:${app.id}:rfnd_1`))!;
    expect(note).toMatchObject({ type: "credit_note", status: "posted", originalDocumentId: invoice.id, supplyType: "inter", total: 10000, amountPaid: 10000 });
    expect(note.number).toMatch(/^CN\//);
    expect(await balance("1120")).toBe(clearingBefore - 10000);
    expect(await balance("1200")).toBe(0);
    expect(sentMail.at(-1)).toMatchObject({ to: "priya@example.com", subject: `Credit note ${note.number} from Exaltes: ₹100.00 refunded` });
    // A refund of a payment Tevah never invoiced is noted, not booked.
    const unknown = await razorpay(app, { event: "refund.processed", payload: { refund: { entity: { id: "rfnd_2", payment_id: "pay_unknown", amount: 500, created_at: 1792886400 } } } });
    expect(unknown.body).toMatchObject({ status: "ignored" });
  });

  it("moves a settlement from the clearing account to the bank, once per company", async () => {
    const clearingBefore = await balance("1120");
    const bankBefore = await balance("1110");
    const body = { event: "settlement.processed", payload: { settlement: { entity: { id: "setl_1", amount: 48722, fees: 998, tax: 180, utr: "UTR123", created_at: 1792886400 } } } };
    expect((await razorpay(app, body)).body).toMatchObject({ status: "invoiced" });
    expect(await balance("1120")).toBe(clearingBefore - 48722);
    expect(await balance("1110")).toBe(bankBefore + 48722);
    expect((await razorpay(app, body)).body).toMatchObject({ status: "duplicate" });
    // A second Razorpay app on the same account hears the same settlement.
    await db.update(schema.connectedApps).set({ bankJournalId: bankJournal }).where(eq(schema.connectedApps.id, apiApp.id));
    const twin = { ...apiApp, source: "razorpay" as const, bankJournalId: bankJournal };
    await db.update(schema.connectedApps).set({ source: "razorpay" }).where(eq(schema.connectedApps.id, apiApp.id));
    expect((await razorpay(twin, body)).body).toMatchObject({ status: "ignored" });
    await db.update(schema.connectedApps).set({ source: "api", bankJournalId: null }).where(eq(schema.connectedApps.id, apiApp.id));
    expect(await balance("1120")).toBe(clearingBefore - 48722);
    const [entry] = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.externalRef, "app-settlement:setl_1"));
    expect(entry).toMatchObject({ status: "posted", reference: "UTR123" });
  });

  it("takes payments an app reports through the signed API, exports included", async () => {
    const body = {
      paymentId: "fw_1",
      amount: 118000,
      paidAt: "2026-10-24T09:30:00+05:30",
      customer: { id: "church_7", name: "Grace Church", email: "pastor@example.org", country: "GB" },
      plan: "Giving platform",
      period: { from: "2026-10-01", to: "2026-10-31" },
    };
    const raw = JSON.stringify(body);
    expect((await post("api", apiApp, raw, { "x-tevah-signature": "t=1,v1=00" })).status).toBe(401);
    const res = await post("api", apiApp, raw, { "x-tevah-signature": signForTevah(raw, apiApp.secret) });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "invoiced" });
    const doc = (await docByRef(`app:${apiApp.id}:fw_1`))!;
    expect(doc).toMatchObject({ supplyType: "export", placeOfSupply: "96", total: 118000, taxable: 118000, igst: 0, amountPaid: 118000, date: "2026-10-24" });
    const [line] = await db.select().from(schema.documentLines).where(eq(schema.documentLines.documentId, doc.id));
    expect(line!.description).toBe("Flockwise – Giving platform (1 Oct to 31 Oct 2026)");
    const bad = await post("api", apiApp, '{"paymentId":"x"}', { "x-tevah-signature": signForTevah('{"paymentId":"x"}', apiApp.secret) });
    expect(bad.status).toBe(422);
    const home = { ...body, paymentId: "fw_2", customer: { ...body.customer, id: "c_8", country: "IN", state: "27", gstin: null } };
    const homeRaw = JSON.stringify(home);
    expect((await post("api", apiApp, homeRaw, { "x-tevah-signature": signForTevah(homeRaw, apiApp.secret) })).body).toMatchObject({ status: "invoiced" });
    expect(await docByRef(`app:${apiApp.id}:fw_2`)).toMatchObject({ supplyType: "intra", total: 118000, taxable: 100000, cgst: 9000, sgst: 9000 });
  });

  it("keeps the ledger balanced through all of it", async () => {
    const [row] = await db
      .select({ debit: sql<string>`sum(${schema.journalLines.debit})`, credit: sql<string>`sum(${schema.journalLines.credit})` })
      .from(schema.journalLines)
      .where(eq(schema.journalLines.orgId, session.orgId));
    expect(Number(row!.debit)).toBe(Number(row!.credit));
    expect(Number(row!.debit)).toBeGreaterThan(0);
  });
});
