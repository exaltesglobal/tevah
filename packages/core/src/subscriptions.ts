import { computeDocument, type SupplyType } from "./gst";
import { validateGstin } from "./gstin";
import { assertPaise, mulRound, type Paise } from "./money";
import { isStateCode } from "./states";

/**
 * A payment one of our apps received, in the shape Tevah books it: from a
 * Razorpay webhook or from an app calling Tevah's API.
 */
export interface AppPaymentEvent {
  /** Gateway or app payment id; Tevah raises one invoice per id. */
  paymentId: string;
  /** What the customer paid, GST included. */
  amount: Paise;
  /** Date of payment in India (YYYY-MM-DD); the invoice date. */
  date: string;
  customer: {
    name: string;
    email: string | null;
    phone: string | null;
    gstin: string | null;
    stateCode: string | null;
    /** ISO country code when the app sent one. */
    country: string | null;
    /** Outside India: the invoice is a zero-rated export under LUT. */
    foreign: boolean;
    /** The app's own id for the customer, so repeat payments find the same contact. */
    ref: string | null;
  };
  /** Plan or product the customer paid for, e.g. "Pro plan (monthly)". */
  plan: string | null;
  period: { from: string; to: string } | null;
  /** Gateway fee and the GST on it, both inside `fee`. */
  fee: Paise;
  feeTax: Paise;
  method: string | null;
}

export interface AppRefundEvent {
  refundId: string;
  paymentId: string;
  amount: Paise;
  date: string;
}

export interface AppSettlementEvent {
  settlementId: string;
  /** What reached the bank, after fees. */
  amount: Paise;
  fees: Paise;
  tax: Paise;
  utr: string | null;
  date: string;
}

export type ParsedWebhook =
  | { kind: "payment"; event: AppPaymentEvent; notes: Record<string, string> }
  | { kind: "refund"; event: AppRefundEvent }
  | { kind: "settlement"; event: AppSettlementEvent }
  | { kind: "ignored"; reason: string; id: string | null };

/** Indian date of a Unix timestamp. */
export function istDate(unixSeconds: number): string {
  return new Date((unixSeconds + 330 * 60) * 1000).toISOString().slice(0, 10);
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
const int = (v: unknown): number => (typeof v === "number" && Number.isInteger(v) ? v : 0);

/** Razorpay sends notes as an object, or as [] when there are none. */
function notesOf(...sources: unknown[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const src of sources) {
    for (const [k, v] of Object.entries(obj(src))) {
      const s = str(v);
      if (s) out[k.toLowerCase()] = s;
    }
  }
  return out;
}

/** Customer details, from what the app passed in Razorpay notes (name, company, gstin, state, country, customer_id) and the payment. */
export function customerDetails(
  notes: Record<string, string>,
  payment: { email: string | null; phone: string | null; customerId: string | null; international: boolean },
): AppPaymentEvent["customer"] {
  const check = notes.gstin ? validateGstin(notes.gstin) : null;
  const gstin = check?.valid ? check.gstin : null;
  const state = notes.state && isStateCode(notes.state.padStart(2, "0")) ? notes.state.padStart(2, "0") : null;
  const stateCode = (check?.valid ? check.stateCode : null) ?? state;
  const country = notes.country ? notes.country.toUpperCase().slice(0, 2) : null;
  // A card from abroad with no Indian GSTIN or state is a foreign customer unless the app says otherwise.
  const foreign = country ? country !== "IN" : payment.international && !gstin && !stateCode;
  return {
    name: notes.company ?? notes.name ?? payment.email ?? payment.phone ?? "Customer",
    email: payment.email,
    phone: payment.phone,
    gstin,
    stateCode: foreign ? null : stateCode,
    country: country ?? (foreign ? null : "IN"),
    foreign,
    ref: notes.customer_id ?? payment.customerId,
  };
}

/**
 * Read a Razorpay webhook body. Captured payments become payment events,
 * processed refunds and settlements their own events, and everything else is
 * ignored with a reason. The signature must already be checked.
 */
export function parseRazorpayWebhook(body: unknown): ParsedWebhook {
  const root = obj(body);
  const event = str(root.event) ?? "unknown";
  const payload = obj(root.payload);
  const payment = obj(obj(payload.payment).entity);
  const id = str(payment.id);

  if (event === "refund.processed") {
    const refund = obj(obj(payload.refund).entity);
    const refundId = str(refund.id);
    const paymentId = str(refund.payment_id) ?? id;
    if (!refundId || !paymentId) return { kind: "ignored", reason: "No refund in the event", id: refundId };
    if (int(refund.amount) <= 0) return { kind: "ignored", reason: "Refund has no amount", id: refundId };
    return { kind: "refund", event: { refundId, paymentId, amount: int(refund.amount), date: istDate(int(refund.created_at) || int(root.created_at)) } };
  }
  if (event === "settlement.processed") {
    const st = obj(obj(payload.settlement).entity);
    const settlementId = str(st.id);
    if (!settlementId) return { kind: "ignored", reason: "No settlement in the event", id: null };
    if (int(st.amount) <= 0) return { kind: "ignored", reason: "Settlement has no amount", id: settlementId };
    return {
      kind: "settlement",
      event: { settlementId, amount: int(st.amount), fees: int(st.fees), tax: int(st.tax), utr: str(st.utr), date: istDate(int(st.created_at) || int(root.created_at)) },
    };
  }
  if (event !== "payment.captured" && event !== "subscription.charged") {
    return { kind: "ignored", reason: `${event} isn't an event Tevah books`, id };
  }
  if (!id) return { kind: "ignored", reason: "No payment in the event", id: null };
  if (str(payment.currency) !== "INR") return { kind: "ignored", reason: `Payment in ${str(payment.currency) ?? "unknown currency"}; only INR is invoiced`, id };
  const amount = int(payment.amount);
  if (amount <= 0) return { kind: "ignored", reason: "Payment has no amount", id };

  const subscription = obj(obj(payload.subscription).entity);
  const notes = notesOf(subscription.notes, payment.notes);
  const start = int(subscription.current_start);
  const end = int(subscription.current_end);
  return {
    kind: "payment",
    notes,
    event: {
      paymentId: id,
      amount,
      date: istDate(int(payment.created_at) || int(root.created_at)),
      customer: customerDetails(notes, {
        email: str(payment.email),
        phone: str(payment.contact),
        customerId: str(payment.customer_id) ?? str(subscription.customer_id),
        international: payment.international === true,
      }),
      plan: notes.plan ?? str(payment.description),
      period: start && end ? { from: istDate(start), to: istDate(end - 1) } : null,
      fee: int(payment.fee),
      feeTax: int(payment.tax),
      method: str(payment.method),
    },
  };
}

/** Taxable value of a single-line invoice whose total, GST included, comes to `gross`. */
export function taxableForGross(gross: Paise, gstRateBps: number, supply: SupplyType): Paise {
  assertPaise(gross, "amount");
  if (supply === "export") return gross;
  const estimate = mulRound(gross, 10000, 10000 + gstRateBps);
  const candidates = Array.from({ length: 11 }, (_, i) => estimate - 5 + i).filter((t) => t > 0);
  const scored = candidates.map((taxable) => {
    const doc = computeDocument([{ quantity: 1, unitPrice: taxable, gstRateBps }], { type: supply, reverseCharge: false });
    const exact = doc.total - doc.roundOff;
    return { taxable, score: (exact === gross ? 0 : 2) + (doc.total === gross ? 0 : 1), off: Math.abs(exact - gross) + Math.abs(taxable - estimate) / 100 };
  });
  scored.sort((a, b) => a.score - b.score || a.off - b.off);
  return scored[0]!.taxable;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (d: string, withYear: boolean) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}${withYear ? ` ${d.slice(0, 4)}` : ""}`;

/** Invoice line text naming the app and what was paid for, e.g. "Agape Labs – Pro plan (24 Oct to 23 Nov 2026)". */
export function subscriptionLine(appName: string, plan: string | null, period: { from: string; to: string } | null): string {
  const what = plan && plan.toLowerCase() !== appName.toLowerCase() ? `${appName} – ${plan}` : `${appName} subscription`;
  if (!period) return what.slice(0, 300);
  const sameYear = period.from.slice(0, 4) === period.to.slice(0, 4);
  return `${what} (${shortDate(period.from, !sameYear)} to ${shortDate(period.to, true)})`.slice(0, 300);
}
