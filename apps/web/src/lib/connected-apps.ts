import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  FOREIGN_POS,
  GST_RATES_BPS,
  isStateCode,
  parseRazorpayWebhook,
  subscriptionLine,
  taxableForGross,
  validateGstin,
  type AppPaymentEvent,
  type AppRefundEvent,
  type AppSettlementEvent,
  type ParsedWebhook,
  type StateCode,
  type SupplyType,
} from "@tevah/core";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Scope } from "@/db";
import { accounts, appPayments, connectedApps, contacts, documentLines, documents, journalEntries, journals, orgs, payments } from "@/db/schema";
import { audit } from "./audit";
import type { Session } from "./auth";
import { addPaid, postDocument, saveDraft, UserError } from "./documents";
import { createPostedEntry, systemAccounts } from "./ledger";
import { recordPayment } from "./payments";

export type ConnectedApp = typeof connectedApps.$inferSelect;

const optionalUuid = z
  .string()
  .optional()
  .transform((v) => v || null)
  .pipe(z.uuid().nullable());

export const appInput = z.object({
  name: z.string().trim().min(1, "Name the app").max(100),
  source: z.enum(["razorpay", "api"]),
  notesFilter: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => v || null),
  sac: z.string().trim().regex(/^\d{4,8}$/, "SAC is 4 to 8 digits"),
  gstRateBps: z.coerce.number().refine((v) => (GST_RATES_BPS as readonly number[]).includes(v), { message: "Choose a GST rate" }),
  incomeAccountId: z.uuid("Choose an income account"),
  journalId: optionalUuid,
  bankJournalId: optionalUuid,
  feeAccountId: optionalUuid,
  emailInvoices: z
    .string()
    .optional()
    .transform((v) => v === "on"),
  active: z
    .string()
    .optional()
    .transform((v) => v !== "off"),
});
export type AppInput = z.output<typeof appInput>;

export const newSecret = () => randomBytes(24).toString("base64url");

/** Razorpay holds the money until it settles to the bank, so its receipts land in a clearing account of their own. */
async function razorpayJournal(s: Scope): Promise<string> {
  const [existing] = await s.tx.select({ id: journals.id }).from(journals).where(s.own(journals, eq(journals.code, "RZP")));
  if (existing) return existing.id;
  const accountId = randomUUID();
  const [taken] = await s.tx.select({ id: accounts.id }).from(accounts).where(s.own(accounts, eq(accounts.code, "1120")));
  await s.tx.insert(accounts).values({ id: accountId, orgId: s.orgId, code: taken ? "1121" : "1120", name: "Razorpay Balance", type: "asset" });
  const journalId = randomUUID();
  await s.tx.insert(journals).values({ id: journalId, orgId: s.orgId, code: "RZP", name: "Razorpay", type: "bank", defaultAccountId: accountId });
  return journalId;
}

async function moneyJournal(s: Scope, id: string, label: string) {
  const [journal] = await s.tx.select().from(journals).where(s.own(journals, eq(journals.id, id)));
  if (!journal || (journal.type !== "bank" && journal.type !== "cash") || !journal.defaultAccountId) throw new UserError(`Choose a bank or cash account as the ${label}`);
  return journal as typeof journal & { defaultAccountId: string };
}

async function checkRefs(s: Scope, input: AppInput, journalId: string) {
  await moneyJournal(s, journalId, "receiving account");
  if (input.bankJournalId) {
    if (input.bankJournalId === journalId) throw new UserError("The settlement bank account must differ from the receiving account");
    await moneyJournal(s, input.bankJournalId, "settlement bank account");
  }
  for (const [id, type, label] of [
    [input.incomeAccountId, "income", "income account"],
    [input.feeAccountId, "expense", "fee account"],
  ] as const) {
    if (!id) continue;
    const [a] = await s.tx.select({ type: accounts.type }).from(accounts).where(s.own(accounts, eq(accounts.id, id)));
    if (a?.type !== type) throw new UserError(`Choose an ${type} account as the ${label}`);
  }
}

export async function createApp(s: Scope, session: Session, input: AppInput): Promise<string> {
  const journalId = input.journalId ?? (input.source === "razorpay" ? await razorpayJournal(s) : null);
  if (!journalId) throw new UserError("Choose the bank account the money lands in");
  await checkRefs(s, input, journalId);
  const id = randomUUID();
  await s.tx.insert(connectedApps).values({ ...input, id, orgId: s.orgId, journalId, secret: newSecret(), createdBy: session.userId });
  await audit(s, session, "create", "connected_app", id, { name: input.name, source: input.source });
  return id;
}

export async function updateApp(s: Scope, session: Session, id: string, input: AppInput): Promise<void> {
  const app = await getApp(s, id);
  if (!app) throw new UserError("App not found");
  const journalId = input.journalId ?? app.journalId;
  await checkRefs(s, input, journalId);
  await s.tx
    .update(connectedApps)
    .set({ ...input, source: app.source, journalId })
    .where(s.own(connectedApps, eq(connectedApps.id, id)));
  await audit(s, session, "update", "connected_app", id, { name: input.name });
}

export async function rotateSecret(s: Scope, session: Session, id: string): Promise<void> {
  await s.tx.update(connectedApps).set({ secret: newSecret() }).where(s.own(connectedApps, eq(connectedApps.id, id)));
  await audit(s, session, "update", "connected_app", id, { secret: "rotated" });
}

export async function getApp(s: Scope, id: string): Promise<ConnectedApp | null> {
  const [app] = await s.tx.select().from(connectedApps).where(s.own(connectedApps, eq(connectedApps.id, id)));
  return app ?? null;
}

export async function listApps(s: Scope) {
  return s.tx.select().from(connectedApps).where(s.own(connectedApps)).orderBy(connectedApps.name);
}

export async function recentAppPayments(s: Scope, appId: string, limit = 100) {
  return s.tx
    .select({
      id: appPayments.id,
      externalId: appPayments.externalId,
      event: appPayments.event,
      status: appPayments.status,
      amount: appPayments.amount,
      customerName: appPayments.customerName,
      customerEmail: appPayments.customerEmail,
      error: appPayments.error,
      emailStatus: appPayments.emailStatus,
      emailError: appPayments.emailError,
      receivedAt: appPayments.receivedAt,
      documentId: appPayments.documentId,
      number: documents.number,
      type: documents.type,
    })
    .from(appPayments)
    .leftJoin(documents, s.own(documents, eq(documents.id, appPayments.documentId)))
    .where(s.own(appPayments, eq(appPayments.appId, appId)))
    .orderBy(desc(appPayments.receivedAt))
    .limit(limit);
}

// ---------------------------------------------------------------------------
// Signatures

const hmac = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("hex");
const sameHex = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Razorpay signs the raw body with the webhook secret (X-Razorpay-Signature). */
export function verifyRazorpay(raw: string, signature: string | null, secret: string): boolean {
  return !!signature && sameHex(hmac(secret, raw), signature.trim().toLowerCase());
}

/** Apps sign `<unix time>.<body>`: X-Tevah-Signature: t=<unix time>,v1=<hex>. Five minutes' leeway. */
export function verifyTevahSignature(raw: string, header: string | null, secret: string, now = Date.now()): boolean {
  const parts = Object.fromEntries((header ?? "").split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!parts.v1 || !Number.isInteger(t) || Math.abs(now / 1000 - t) > 300) return false;
  return sameHex(hmac(secret, `${t}.${raw}`), parts.v1.toLowerCase());
}

export function signForTevah(raw: string, secret: string, now = Date.now()): string {
  const t = Math.floor(now / 1000);
  return `t=${t},v1=${hmac(secret, `${t}.${raw}`)}`;
}

/** Body of a payment an app reports through Tevah's API. Amounts are paise, GST included. */
export const apiPaymentBody = z.object({
  paymentId: z.string().trim().min(1).max(100),
  amount: z.number().int().positive(),
  currency: z.literal("INR").default("INR"),
  paidAt: z.iso.datetime({ offset: true }),
  customer: z.object({
    id: z.string().trim().max(80).nullish(),
    name: z.string().trim().min(1).max(200),
    email: z.email().nullish(),
    phone: z.string().trim().max(30).nullish(),
    gstin: z.string().trim().max(15).nullish(),
    state: z.string().trim().max(2).nullish(),
    /** ISO country code; anything but IN makes the invoice a zero-rated export. */
    country: z.string().trim().length(2).nullish(),
  }),
  plan: z.string().trim().max(150).nullish(),
  period: z.object({ from: z.iso.date(), to: z.iso.date() }).nullish(),
  fee: z.number().int().nonnegative().default(0),
  feeTax: z.number().int().nonnegative().default(0),
});

export function eventFromApi(body: z.output<typeof apiPaymentBody>): AppPaymentEvent {
  const check = body.customer.gstin ? validateGstin(body.customer.gstin) : null;
  const state = body.customer.state?.padStart(2, "0");
  const country = body.customer.country?.toUpperCase() ?? "IN";
  const foreign = country !== "IN";
  return {
    paymentId: body.paymentId,
    amount: body.amount,
    date: new Date(new Date(body.paidAt).getTime() + 330 * 60_000).toISOString().slice(0, 10),
    customer: {
      name: body.customer.name,
      email: body.customer.email ?? null,
      phone: body.customer.phone ?? null,
      gstin: foreign ? null : check?.valid ? check.gstin : null,
      stateCode: foreign ? null : ((check?.valid ? check.stateCode : null) ?? (state && isStateCode(state) ? state : null)),
      country,
      foreign,
      ref: body.customer.id ?? null,
    },
    plan: body.plan ?? null,
    period: body.period ?? null,
    fee: body.fee,
    feeTax: Math.min(body.feeTax, body.fee),
    method: null,
  };
}

/** Read an event body the way the app's source sends it. */
export function parseAppEvent(app: ConnectedApp, body: unknown): ParsedWebhook {
  if (app.source === "razorpay") {
    const parsed = parseRazorpayWebhook(body);
    if (parsed.kind === "payment" && app.notesFilter) {
      // Several apps can share one Razorpay account; each one books only payments tagged for it (notes.app).
      const want = app.notesFilter.toLowerCase();
      const got = parsed.notes.app?.toLowerCase();
      if (got !== want) return { kind: "ignored", reason: got ? `Tagged for ${got}, not ${app.notesFilter}` : `Not tagged app=${app.notesFilter} in Razorpay notes`, id: parsed.event.paymentId };
    }
    return parsed;
  }
  const result = apiPaymentBody.safeParse(body);
  if (!result.success) return { kind: "ignored", reason: `Invalid body: ${result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`.slice(0, 500), id: null };
  return { kind: "payment", event: eventFromApi(result.data), notes: {} };
}

// ---------------------------------------------------------------------------
// Booking

/** Acting user for what an app does: the admin who connected it. */
export function appSession(app: ConnectedApp, org: { name: string; stateCode: string }): Session {
  return { userId: app.createdBy, userName: app.name, email: "", orgId: app.orgId, orgName: org.name, orgStateCode: org.stateCode, role: "admin" };
}

const ref = (app: ConnectedApp, externalId: string) => `app:${app.id}:${externalId}`.slice(0, 100);
const shareToken = () => randomBytes(24).toString("base64url");

/** Find the customer by the app's id for them, then GSTIN, then email; otherwise add them. */
async function customerFor(s: Scope, app: ConnectedApp, c: AppPaymentEvent["customer"]): Promise<{ id: string; stateCode: string | null }> {
  const customerRef = c.ref ? `app:${app.id}:customer:${c.ref}`.slice(0, 100) : null;
  const pick = { id: contacts.id, stateCode: contacts.stateCode, kind: contacts.kind, externalRef: contacts.externalRef };
  const [byRef] = customerRef ? await s.tx.select(pick).from(contacts).where(s.own(contacts, eq(contacts.externalRef, customerRef))) : [];
  const [byGstin] = !byRef && c.gstin ? await s.tx.select(pick).from(contacts).where(s.own(contacts, eq(contacts.gstin, c.gstin))) : [];
  const [byEmail] = !byRef && !byGstin && c.email ? await s.tx.select(pick).from(contacts).where(s.own(contacts, eq(contacts.email, c.email))) : [];
  const found = byRef ?? byGstin ?? byEmail;
  if (found) {
    if (found.kind === "vendor") await s.tx.update(contacts).set({ kind: "both" }).where(s.own(contacts, eq(contacts.id, found.id)));
    if (customerRef && !found.externalRef) await s.tx.update(contacts).set({ externalRef: customerRef }).where(s.own(contacts, eq(contacts.id, found.id), isNull(contacts.externalRef)));
    return found;
  }
  const id = randomUUID();
  await s.tx.insert(contacts).values({
    id,
    orgId: s.orgId,
    kind: "customer",
    name: c.name.slice(0, 200),
    gstin: c.gstin,
    pan: c.gstin ? c.gstin.slice(2, 12) : null,
    email: c.email?.slice(0, 200) ?? null,
    phone: c.phone?.slice(0, 30) ?? null,
    stateCode: c.stateCode,
    externalRef: customerRef,
  });
  return { id, stateCode: c.stateCode };
}

export interface Booked {
  appPaymentId: string;
  status: "invoiced" | "ignored" | "failed" | "duplicate";
  documentId: string | null;
  emailPending: boolean;
}

type AppPaymentRow = typeof appPayments.$inferInsert;

/** One row per external id (payment, refund or settlement); a failed row is overwritten when the event is tried again. */
async function priorRow(s: Scope, app: ConnectedApp, externalId: string) {
  const [prior] = await s.tx
    .select()
    .from(appPayments)
    .where(s.own(appPayments, eq(appPayments.appId, app.id), eq(appPayments.externalId, externalId)))
    .for("update");
  return prior;
}

async function writeRow(s: Scope, app: ConnectedApp, externalId: string, prior: { id: string } | undefined, row: Omit<AppPaymentRow, "id" | "orgId" | "appId" | "externalId">): Promise<string> {
  const payload = row.payload?.slice(0, 60_000) ?? null;
  if (prior) {
    await s.tx.update(appPayments).set({ ...row, payload }).where(s.own(appPayments, eq(appPayments.id, prior.id)));
    return prior.id;
  }
  const id = randomUUID();
  await s.tx.insert(appPayments).values({ ...row, payload, id, orgId: s.orgId, appId: app.id, externalId: externalId.slice(0, 100) });
  await s.tx.update(connectedApps).set({ lastEventAt: new Date() }).where(s.own(connectedApps, eq(connectedApps.id, app.id)));
  return id;
}

/**
 * Turn a payment into a posted invoice, a receipt that settles it, and the
 * gateway fee, all in the caller's transaction. Each payment id is booked
 * once; a repeat (gateways retry) returns what was booked before.
 */
export async function bookAppPayment(s: Scope, app: ConnectedApp, eventName: string, e: AppPaymentEvent, payload: string): Promise<Booked> {
  const prior = await priorRow(s, app, e.paymentId);
  if (prior && prior.status !== "failed") return { appPaymentId: prior.id, status: "duplicate", documentId: prior.documentId, emailPending: false };

  const [org] = await s.tx.select().from(orgs).where(eq(orgs.id, s.orgId));
  if (!isStateCode(org!.stateCode)) throw new UserError("Set your company's state in Settings first");
  const session = appSession(app, { name: org!.name, stateCode: org!.stateCode });
  const customer = await customerFor(s, app, e.customer);

  // Outside India the supply is a zero-rated export under LUT; at home the place of supply is the
  // customer's state, or ours when no address is on record (IGST Act s.12(2)(b)).
  let placeOfSupply: StateCode;
  let supplyType: SupplyType;
  if (e.customer.foreign) {
    if (!org!.lut) throw new UserError("Enter your LUT number in Company settings before invoicing customers outside India");
    placeOfSupply = FOREIGN_POS;
    supplyType = "export";
  } else {
    placeOfSupply = customer.stateCode && isStateCode(customer.stateCode) ? customer.stateCode : (org!.stateCode as StateCode);
    supplyType = placeOfSupply === org!.stateCode ? "intra" : "inter";
  }
  const taxable = taxableForGross(e.amount, app.gstRateBps, supplyType);

  const docId = await saveDraft(s, session, "invoice", null, {
    contactId: customer.id,
    date: e.date,
    dueDate: null,
    placeOfSupply,
    supplyType,
    reverseCharge: false,
    vendorReference: null,
    originalDocumentId: null,
    tdsSection: null,
    tdsRate: 0,
    notes: `Paid online${e.method ? ` by ${e.method.toUpperCase()}` : ""}, payment ${e.paymentId}.`,
    lines: [
      {
        productId: null,
        description: subscriptionLine(app.name, e.plan, e.period),
        hsnSac: app.sac,
        quantity: 1000,
        unit: "NOS",
        unitPrice: taxable,
        discount: 0,
        gstRateBps: app.gstRateBps,
        accountId: app.incomeAccountId,
      },
    ],
  });
  await postDocument(s, session, docId);
  await s.tx
    .update(documents)
    .set({ externalRef: ref(app, e.paymentId), shareToken: shareToken() })
    .where(s.own(documents, eq(documents.id, docId)));
  const [doc] = await s.tx.select({ total: documents.total }).from(documents).where(s.own(documents, eq(documents.id, docId)));

  const paymentId = await recordPayment(s, session, "received", {
    contactId: customer.id,
    date: e.date,
    journalId: app.journalId,
    amount: e.amount,
    tds: 0,
    reference: e.paymentId.slice(0, 100),
    notes: `${app.name} payment`,
    allocations: [{ documentId: docId, amount: Math.min(e.amount, doc!.total) }],
  });
  await s.tx.update(payments).set({ externalRef: ref(app, e.paymentId) }).where(s.own(payments, eq(payments.id, paymentId)));

  if (app.feeAccountId && e.fee > 0) {
    // The gateway keeps its fee out of the settlement, so expense it now against the clearing balance.
    const journal = await moneyJournal(s, app.journalId, "receiving account");
    const sys = await systemAccounts(s);
    const tax = Math.min(e.feeTax, e.fee);
    await createPostedEntry(s, {
      journalId: app.journalId,
      date: e.date,
      number: null,
      reference: e.paymentId.slice(0, 100),
      narration: `${app.name} gateway fee on ${e.paymentId}`,
      sourceRef: `app-fee:${app.id}`.slice(0, 60),
      createdBy: app.createdBy,
      lines: [
        { accountId: app.feeAccountId, debit: e.fee - tax, credit: 0 },
        ...(tax ? [{ accountId: sys.input_igst, debit: tax, credit: 0 }] : []),
        { accountId: journal.defaultAccountId, debit: 0, credit: e.fee },
      ],
    });
  }

  const emailPending = app.emailInvoices && !!e.customer.email;
  const appPaymentId = await writeRow(s, app, e.paymentId, prior, {
    event: eventName.slice(0, 60),
    status: "invoiced",
    amount: e.amount,
    customerName: e.customer.name.slice(0, 200),
    customerEmail: e.customer.email?.slice(0, 200) ?? null,
    documentId: docId,
    paymentId,
    error: null,
    emailStatus: emailPending ? "pending" : "off",
    emailError: null,
    payload,
  });
  return { appPaymentId, status: "invoiced", documentId: docId, emailPending };
}

/**
 * A refund becomes a credit note against the invoice the payment raised, with
 * the money shown leaving the gateway balance. Partial refunds get a note for
 * the refunded amount only.
 */
export async function bookRefund(s: Scope, app: ConnectedApp, eventName: string, r: AppRefundEvent, payload: string): Promise<Booked> {
  const prior = await priorRow(s, app, r.refundId);
  if (prior && prior.status !== "failed") return { appPaymentId: prior.id, status: "duplicate", documentId: prior.documentId, emailPending: false };

  const [paid] = await s.tx
    .select({ documentId: appPayments.documentId, status: appPayments.status })
    .from(appPayments)
    .where(s.own(appPayments, eq(appPayments.appId, app.id), eq(appPayments.externalId, r.paymentId)));
  if (!paid?.documentId || paid.status !== "invoiced") {
    return noteAppEvent(s, app, r.refundId, eventName, "ignored", `Refund of ${r.paymentId}, a payment Tevah has no invoice for`, payload, { amount: r.amount });
  }
  const [invoice] = await s.tx.select().from(documents).where(s.own(documents, eq(documents.id, paid.documentId)));
  if (!invoice || invoice.status !== "posted") throw new UserError(`Invoice for ${r.paymentId} is ${invoice?.status ?? "missing"}`);
  if (!isStateCode(invoice.placeOfSupply)) throw new UserError("Invoice has no place of supply");
  const [line] = await s.tx.select().from(documentLines).where(s.own(documentLines, eq(documentLines.documentId, invoice.id)));
  const [contact] = await s.tx.select().from(contacts).where(s.own(contacts, eq(contacts.id, invoice.contactId)));
  const [org] = await s.tx.select().from(orgs).where(eq(orgs.id, s.orgId));
  const session = appSession(app, { name: org!.name, stateCode: org!.stateCode });

  const full = r.amount >= invoice.total;
  const amount = Math.min(r.amount, invoice.total);
  const taxable = full ? invoice.taxable : taxableForGross(amount, app.gstRateBps, invoice.supplyType);
  const noteId = await saveDraft(s, session, "credit_note", null, {
    contactId: invoice.contactId,
    date: r.date,
    dueDate: null,
    placeOfSupply: invoice.placeOfSupply,
    supplyType: invoice.supplyType,
    reverseCharge: false,
    vendorReference: null,
    originalDocumentId: invoice.id,
    tdsSection: null,
    tdsRate: 0,
    notes: `${full ? "Refund" : "Part refund"} of payment ${r.paymentId} (${r.refundId}).`,
    lines: [
      {
        productId: null,
        description: `Refund: ${line?.description ?? subscriptionLine(app.name, null, null)}`.slice(0, 300),
        hsnSac: line?.hsnSac ?? app.sac,
        quantity: 1000,
        unit: "NOS",
        unitPrice: taxable,
        discount: 0,
        gstRateBps: line?.gstRateBps ?? app.gstRateBps,
        accountId: line?.accountId ?? app.incomeAccountId,
      },
    ],
  });
  await postDocument(s, session, noteId);
  await s.tx
    .update(documents)
    .set({ externalRef: ref(app, r.refundId), shareToken: shareToken() })
    .where(s.own(documents, eq(documents.id, noteId)));
  const [note] = await s.tx.select({ total: documents.total, number: documents.number }).from(documents).where(s.own(documents, eq(documents.id, noteId)));

  // The invoice was already paid, so the note is owed back to the customer: pay it out of the gateway balance.
  const journal = await moneyJournal(s, app.journalId, "receiving account");
  const sys = await systemAccounts(s);
  const entryId = await createPostedEntry(s, {
    journalId: app.journalId,
    date: r.date,
    number: null,
    reference: r.refundId.slice(0, 100),
    narration: `Refund ${note!.number} to ${contact?.name ?? "customer"}`,
    sourceRef: `app-refund:${app.id}`.slice(0, 60),
    createdBy: app.createdBy,
    lines: [
      { accountId: sys.receivable, debit: note!.total, credit: 0, contactId: invoice.contactId },
      { accountId: journal.defaultAccountId, debit: 0, credit: note!.total },
    ],
  });
  await s.tx.update(journalEntries).set({ externalRef: ref(app, r.refundId) }).where(s.own(journalEntries, eq(journalEntries.id, entryId)));
  await addPaid(s, noteId, note!.total);

  const emailPending = app.emailInvoices && !!contact?.email;
  const appPaymentId = await writeRow(s, app, r.refundId, prior, {
    event: eventName.slice(0, 60),
    status: "invoiced",
    amount: -note!.total,
    customerName: contact?.name.slice(0, 200) ?? null,
    customerEmail: contact?.email?.slice(0, 200) ?? null,
    documentId: noteId,
    paymentId: null,
    error: null,
    emailStatus: emailPending ? "pending" : "off",
    emailError: null,
    payload,
  });
  return { appPaymentId, status: "invoiced", documentId: noteId, emailPending };
}

/**
 * A settlement moves the net amount from the gateway balance to the bank.
 * Fees were expensed payment by payment, so only the net moves. Apps sharing a
 * gateway account all hear about the same settlement; it is booked once per company.
 */
export async function bookSettlement(s: Scope, app: ConnectedApp, eventName: string, st: AppSettlementEvent, payload: string): Promise<Booked> {
  const prior = await priorRow(s, app, st.settlementId);
  if (prior && prior.status !== "failed") return { appPaymentId: prior.id, status: "duplicate", documentId: null, emailPending: false };
  if (!app.bankJournalId) {
    return noteAppEvent(s, app, st.settlementId, eventName, "ignored", "No settlement bank account is chosen for this app", payload, { amount: st.amount });
  }
  const externalRef = `app-settlement:${st.settlementId}`.slice(0, 100);
  const [booked] = await s.tx.select({ id: journalEntries.id }).from(journalEntries).where(s.own(journalEntries, eq(journalEntries.externalRef, externalRef)));
  if (booked) return noteAppEvent(s, app, st.settlementId, eventName, "ignored", "Settlement already booked through another connected app", payload, { amount: st.amount });

  const clearing = await moneyJournal(s, app.journalId, "receiving account");
  const bank = await moneyJournal(s, app.bankJournalId, "settlement bank account");
  const entryId = await createPostedEntry(s, {
    journalId: app.bankJournalId,
    date: st.date,
    number: null,
    reference: (st.utr ?? st.settlementId).slice(0, 100),
    narration: `${clearing.name} settlement ${st.settlementId}${st.utr ? ` (UTR ${st.utr})` : ""}`,
    sourceRef: `app-settlement:${app.id}`.slice(0, 60),
    createdBy: app.createdBy,
    lines: [
      { accountId: bank.defaultAccountId, debit: st.amount, credit: 0 },
      { accountId: clearing.defaultAccountId, debit: 0, credit: st.amount },
    ],
  });
  await s.tx.update(journalEntries).set({ externalRef }).where(s.own(journalEntries, eq(journalEntries.id, entryId)));

  const appPaymentId = await writeRow(s, app, st.settlementId, prior, {
    event: eventName.slice(0, 60),
    status: "invoiced",
    amount: st.amount,
    customerName: null,
    customerEmail: null,
    documentId: null,
    paymentId: null,
    error: null,
    emailStatus: "off",
    emailError: null,
    payload,
  });
  return { appPaymentId, status: "invoiced", documentId: null, emailPending: false };
}

/** Keep a note of an event Tevah couldn't book, or chose not to, so it shows on the app's page. */
export async function noteAppEvent(
  s: Scope,
  app: ConnectedApp,
  externalId: string,
  eventName: string,
  status: "ignored" | "failed",
  error: string,
  payload: string,
  about: { amount?: number; customer?: AppPaymentEvent["customer"] } = {},
): Promise<Booked> {
  const prior = await priorRow(s, app, externalId);
  if (prior && prior.status !== "failed") return { appPaymentId: prior.id, status: "duplicate", documentId: prior.documentId, emailPending: false };
  const appPaymentId = await writeRow(s, app, externalId, prior, {
    event: eventName.slice(0, 60),
    status,
    error: error.slice(0, 2000),
    amount: about.amount ?? 0,
    customerName: about.customer?.name.slice(0, 200) ?? null,
    customerEmail: about.customer?.email?.slice(0, 200) ?? null,
    documentId: null,
    paymentId: null,
    emailStatus: "off",
    emailError: null,
    payload,
  });
  return { appPaymentId, status, documentId: null, emailPending: false };
}

/** Book whatever a parsed event is: payment, refund, settlement or nothing. */
export async function bookAppEvent(s: Scope, app: ConnectedApp, eventName: string, parsed: ParsedWebhook, payload: string): Promise<Booked> {
  switch (parsed.kind) {
    case "payment":
      return bookAppPayment(s, app, eventName, parsed.event, payload);
    case "refund":
      return bookRefund(s, app, eventName, parsed.event, payload);
    case "settlement":
      return bookSettlement(s, app, eventName, parsed.event, payload);
    case "ignored":
      return parsed.id ? noteAppEvent(s, app, parsed.id, eventName, "ignored", parsed.reason, payload) : { appPaymentId: "", status: "ignored", documentId: null, emailPending: false };
  }
}

/** The event name Razorpay or the API put in the body, for the app's event list. */
export function eventNameOf(app: ConnectedApp, body: unknown): string {
  const name = body && typeof body === "object" && "event" in body && typeof body.event === "string" ? body.event : null;
  return name ?? (app.source === "razorpay" ? "unknown" : "api.payment");
}

/** Try a failed or ignored event again from the payload Tevah kept, e.g. after fixing the app's settings. */
export async function replayAppEvent(s: Scope, app: ConnectedApp, appPaymentId: string): Promise<Booked> {
  const [row] = await s.tx.select().from(appPayments).where(s.own(appPayments, eq(appPayments.id, appPaymentId), eq(appPayments.appId, app.id)));
  if (!row) throw new UserError("Event not found");
  if (row.status === "invoiced") throw new UserError("This event is already booked");
  if (!row.payload) throw new UserError("Tevah didn't keep this event's body, so it can't be booked again");
  let body: unknown;
  try {
    body = JSON.parse(row.payload);
  } catch {
    throw new UserError("The kept event body isn't valid JSON");
  }
  // A kept row is tried again whatever its status; mark it failed so the booking overwrites it.
  await s.tx.update(appPayments).set({ status: "failed" }).where(s.own(appPayments, eq(appPayments.id, row.id)));
  const parsed = parseAppEvent(app, body);
  if (parsed.kind === "ignored") {
    await noteAppEvent(s, app, row.externalId, row.event, "ignored", parsed.reason, row.payload);
    throw new UserError(parsed.reason);
  }
  return bookAppEvent(s, app, row.event, parsed, row.payload);
}
