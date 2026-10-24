import { describe, expect, it } from "vitest";
import { computeDocument } from "../src/gst";
import { istDate, parseRazorpayWebhook, subscriptionLine, taxableForGross } from "../src/subscriptions";

const payment = (over: Record<string, unknown> = {}) => ({
  id: "pay_29QQoUBi66xm2f",
  entity: "payment",
  amount: 49900,
  currency: "INR",
  status: "captured",
  method: "upi",
  description: "Pro plan",
  email: "priya@example.com",
  contact: "+919876543210",
  customer_id: "cust_1",
  notes: { app: "agape", name: "Priya Shah", company: "Shah Studio", gstin: "29AABCA1234B1ZD" },
  fee: 1178,
  tax: 180,
  created_at: 1792800000, // 2026-10-24 09:30 IST
  ...over,
});

describe("parseRazorpayWebhook", () => {
  it("reads a captured payment with the customer details the app put in notes", () => {
    const r = parseRazorpayWebhook({ event: "payment.captured", payload: { payment: { entity: payment() } }, created_at: 1792800001 });
    expect(r).toEqual({
      kind: "payment",
      notes: { app: "agape", name: "Priya Shah", company: "Shah Studio", gstin: "29AABCA1234B1ZD" },
      event: {
        paymentId: "pay_29QQoUBi66xm2f",
        amount: 49900,
        date: "2026-10-24",
        customer: {
          name: "Shah Studio",
          email: "priya@example.com",
          phone: "+919876543210",
          gstin: "29AABCA1234B1ZD",
          stateCode: "29",
          country: "IN",
          foreign: false,
          ref: "cust_1",
        },
        plan: "Pro plan",
        period: null,
        fee: 1178,
        feeTax: 180,
        method: "upi",
      },
    });
  });

  it("takes the plan, period and notes from the subscription when one is charged", () => {
    const r = parseRazorpayWebhook({
      event: "subscription.charged",
      payload: {
        subscription: { entity: { id: "sub_1", customer_id: "cust_9", current_start: 1792800000, current_end: 1795478400, notes: { plan: "Pro monthly", state: "27" } } },
        payment: { entity: payment({ notes: [], description: null, customer_id: null }) },
      },
    });
    if (r.kind !== "payment") throw new Error(r.reason);
    expect(r.event.plan).toBe("Pro monthly");
    expect(r.event.period).toEqual({ from: "2026-10-24", to: "2026-11-24" });
    expect(r.event.customer).toEqual({
      name: "priya@example.com",
      email: "priya@example.com",
      phone: "+919876543210",
      gstin: null,
      stateCode: "27",
      country: "IN",
      foreign: false,
      ref: "cust_9",
    });
  });

  it("marks a customer outside India as foreign, from notes.country or an international card", () => {
    const byNotes = parseRazorpayWebhook({ event: "payment.captured", payload: { payment: { entity: payment({ notes: { name: "Jane Doe", country: "us" } }) } } });
    expect(byNotes.kind === "payment" && byNotes.event.customer).toMatchObject({ name: "Jane Doe", country: "US", foreign: true, gstin: null, stateCode: null });
    const byCard = parseRazorpayWebhook({ event: "payment.captured", payload: { payment: { entity: payment({ international: true, notes: { name: "Jane Doe" } }) } } });
    expect(byCard.kind === "payment" && byCard.event.customer).toMatchObject({ foreign: true, country: null });
    // An Indian GSTIN on an international card is still an Indian customer.
    const gstin = parseRazorpayWebhook({ event: "payment.captured", payload: { payment: { entity: payment({ international: true }) } } });
    expect(gstin.kind === "payment" && gstin.event.customer).toMatchObject({ foreign: false, stateCode: "29", country: "IN" });
    // Saying country=IN overrides the card's origin.
    const home = parseRazorpayWebhook({ event: "payment.captured", payload: { payment: { entity: payment({ international: true, notes: { country: "IN" } }) } } });
    expect(home.kind === "payment" && home.event.customer).toMatchObject({ foreign: false, country: "IN" });
  });

  it("reads processed refunds and settlements", () => {
    const refund = parseRazorpayWebhook({
      event: "refund.processed",
      payload: { refund: { entity: { id: "rfnd_1", payment_id: "pay_29QQoUBi66xm2f", amount: 49900, created_at: 1792886400 } }, payment: { entity: payment() } },
    });
    expect(refund).toEqual({ kind: "refund", event: { refundId: "rfnd_1", paymentId: "pay_29QQoUBi66xm2f", amount: 49900, date: "2026-10-25" } });
    const settlement = parseRazorpayWebhook({
      event: "settlement.processed",
      payload: { settlement: { entity: { id: "setl_1", amount: 48722, fees: 998, tax: 180, utr: "UTR123", created_at: 1792886400 } } },
    });
    expect(settlement).toEqual({ kind: "settlement", event: { settlementId: "setl_1", amount: 48722, fees: 998, tax: 180, utr: "UTR123", date: "2026-10-25" } });
    expect(parseRazorpayWebhook({ event: "refund.processed", payload: {} })).toMatchObject({ kind: "ignored" });
  });

  it("ignores other events, other currencies and invalid GSTINs", () => {
    expect(parseRazorpayWebhook({ event: "payment.authorized", payload: { payment: { entity: payment() } } })).toMatchObject({ kind: "ignored", id: "pay_29QQoUBi66xm2f" });
    expect(parseRazorpayWebhook({ event: "payment.captured", payload: { payment: { entity: payment({ currency: "USD" }) } } })).toMatchObject({ kind: "ignored" });
    expect(parseRazorpayWebhook({ event: "payment.captured", payload: {} })).toMatchObject({ kind: "ignored", id: null });
    const r = parseRazorpayWebhook({ event: "payment.captured", payload: { payment: { entity: payment({ notes: { gstin: "29ABC" } }) } } });
    expect(r.kind === "payment" && r.event.customer).toMatchObject({ gstin: null, stateCode: null, name: "priya@example.com" });
  });
});

describe("taxableForGross", () => {
  it.each([
    [49900, 1800, "intra"],
    [49900, 1800, "inter"],
    [99900, 1800, "intra"],
    [118000, 1800, "inter"],
    [1, 1800, "intra"],
    [29900, 500, "intra"],
    [49900, 1800, "export"],
  ] as const)("makes a %i paise invoice at %i bps (%s) come to exactly what was paid", (gross, rate, supply) => {
    const taxable = taxableForGross(gross, rate, supply);
    const doc = computeDocument([{ quantity: 1, unitPrice: taxable, gstRateBps: rate }], { type: supply, reverseCharge: false });
    if (gross % 100 === 0) expect(doc.total).toBe(gross);
    expect(Math.abs(doc.total - doc.roundOff - gross)).toBeLessThanOrEqual(1);
  });
});

describe("subscriptionLine", () => {
  it("names the app, plan and period", () => {
    expect(subscriptionLine("Agape Labs", "Pro plan", { from: "2026-10-24", to: "2026-11-23" })).toBe("Agape Labs – Pro plan (24 Oct to 23 Nov 2026)");
    expect(subscriptionLine("Agape Labs", "Annual", { from: "2026-12-01", to: "2027-11-30" })).toBe("Agape Labs – Annual (1 Dec 2026 to 30 Nov 2027)");
    expect(subscriptionLine("Agape Labs", null, null)).toBe("Agape Labs subscription");
  });

  it("gives Indian dates", () => {
    expect(istDate(1792780200)).toBe("2026-10-24"); // 00:00 IST
    expect(istDate(1792780199)).toBe("2026-10-23");
  });
});
