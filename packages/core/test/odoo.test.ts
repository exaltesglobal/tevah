import { describe, expect, it } from "vitest";
import {
  commercialPartner,
  compareBalances,
  documentFromMove,
  entryFingerprint,
  gstRateBps,
  odooAccountTag,
  odooAccountType,
  odooPaise,
  taskStatusFromOdoo,
  unitFromOdoo,
  type OdooMove,
  type OdooMoveLine,
  type OdooTax,
} from "../src/odoo";

const tax = (id: number, name: string, amount: number, extra: Partial<OdooTax> = {}): OdooTax => ({
  id,
  name,
  amount,
  amountType: "percent",
  use: "sale",
  group: null,
  childIds: [],
  kind: null,
  ...extra,
});
const taxes = new Map(
  [
    tax(1, "GST 18%", 18, { amountType: "group", childIds: [2, 3] }),
    tax(2, "CGST 9%", 9, { group: "CGST" }),
    tax(3, "SGST 9%", 9, { group: "SGST" }),
    tax(4, "IGST 18%", 18, { group: "IGST" }),
    tax(5, "TDS 194J 10%", -10, { use: "purchase", group: "TDS" }),
  ].map((t) => [t.id, t]),
);
const line = (l: Partial<OdooMoveLine>): OdooMoveLine => ({
  id: 0,
  accountId: 1,
  partnerId: 7,
  name: null,
  debit: 0,
  credit: 0,
  displayType: null,
  productId: null,
  quantity: 0,
  priceUnit: 0,
  discount: 0,
  taxIds: [],
  taxLineId: null,
  hsn: null,
  uom: null,
  ...l,
});
const move = (m: Partial<OdooMove>): OdooMove => ({
  id: 1,
  name: "INV/2026/00001",
  type: "out_invoice",
  state: "posted",
  date: "2026-08-22",
  invoiceDate: "2026-08-22",
  dueDate: null,
  partnerId: 7,
  ref: null,
  narration: null,
  journalId: 1,
  total: 0,
  residual: 0,
  tax: 0,
  placeOfSupply: "27",
  gstTreatment: "regular",
  reversedEntryId: null,
  lines: [],
  ...m,
});
const products = new Map([[9, { name: "Consulting", hsn: "998314", uom: "Hours" }]]);

describe("odoo mapping", () => {
  it("converts float rupees to paise exactly", () => {
    expect(odooPaise(19.99)).toBe(1999);
    expect(odooPaise(1234.56)).toBe(123456);
    expect(odooPaise(34810)).toBe(3481000);
    expect(odooPaise(0.1 + 0.2)).toBe(30);
    expect(odooPaise(null)).toBe(0);
  });

  it("maps account types and control accounts", () => {
    expect(odooAccountType("asset_receivable")).toBe("asset");
    expect(odooAccountType("off_balance")).toBeNull();
    expect(odooAccountTag({ name: "Debtors", type: "asset_receivable" })).toBe("receivable");
    expect(odooAccountTag({ name: "HDFC Bank", type: "asset_cash" }, "bank")).toBe("bank");
    expect(odooAccountTag({ name: "Cash", type: "asset_cash" }, "cash")).toBe("cash");
    expect(odooAccountTag({ name: "CGST Output", type: "liability_current" })).toBe("output_cgst");
    expect(odooAccountTag({ name: "SGST Input", type: "asset_current" })).toBe("input_sgst");
    expect(odooAccountTag({ name: "IGST Payable (RCM)", type: "liability_current" })).toBe("rcm_igst_payable");
    expect(odooAccountTag({ name: "TDS Payable", type: "liability_current" })).toBe("tds_payable");
    expect(odooAccountTag({ name: "TDS Receivable", type: "asset_current" })).toBe("tds_receivable");
    expect(odooAccountTag({ name: "Undistributed Profits/Losses", type: "equity_unaffected" })).toBe("retained_earnings");
    expect(odooAccountTag({ name: "Consulting income", type: "income" })).toBeNull();
  });

  it("expands group taxes and leaves TDS out of the GST rate", () => {
    expect(gstRateBps([1], taxes)).toBe(1800);
    expect(gstRateBps([4], taxes)).toBe(1800);
    expect(gstRateBps([4, 5], taxes)).toBe(1800);
    expect(gstRateBps([], taxes)).toBe(0);
  });

  it("builds an intra-state invoice with Odoo's tax totals", () => {
    const doc = documentFromMove(
      move({
        total: 34810,
        residual: 10000,
        lines: [
          line({ id: 1, accountId: 20, displayType: "product", productId: 9, quantity: 10, priceUnit: 2500, credit: 25000, taxIds: [1] }),
          line({ id: 2, accountId: 20, displayType: "product", name: "Server setup", quantity: 1, priceUnit: 4500, credit: 4500, taxIds: [1] }),
          line({ id: 3, accountId: 30, displayType: "tax", taxLineId: 2, credit: 2655 }),
          line({ id: 4, accountId: 31, displayType: "tax", taxLineId: 3, credit: 2655 }),
          line({ id: 5, accountId: 10, displayType: "payment_term", debit: 34810 }),
        ],
      }),
      taxes,
      products,
    )!;
    expect(doc).toMatchObject({ type: "invoice", supplyType: "intra", taxable: 2950000, cgst: 265500, sgst: 265500, igst: 0, roundOff: 0, total: 3481000, amountPaid: 2481000 });
    expect(doc.lines[0]).toMatchObject({ description: "Consulting", hsnSac: "998314", unit: "HRS", quantityMilli: 10000, unitPrice: 250000, gstRateBps: 1800, cgst: 225000, sgst: 225000 });
    expect(doc.lines[1]!.hsnSac).toBeNull();
  });

  it("adds back TDS withheld on a bill so the open amount is Odoo's residual", () => {
    const doc = documentFromMove(
      move({
        type: "in_invoice",
        total: 108,
        residual: 108,
        lines: [
          line({ id: 1, accountId: 50, displayType: "product", debit: 100, quantity: 1, priceUnit: 100, taxIds: [4, 5] }),
          line({ id: 2, accountId: 40, displayType: "tax", taxLineId: 4, debit: 18 }),
          line({ id: 3, accountId: 41, displayType: "tax", taxLineId: 5, credit: 10 }),
          line({ id: 4, accountId: 11, displayType: "payment_term", credit: 108 }),
        ],
      }),
      taxes,
      products,
    )!;
    expect(doc).toMatchObject({ type: "bill", supplyType: "inter", igst: 1800, tdsAmount: 1000, total: 11800, amountPaid: 0, roundOff: 0 });
    expect(doc.total - doc.tdsAmount - doc.amountPaid).toBe(10800);
  });

  it("ignores moves that aren't invoices or bills", () => {
    expect(documentFromMove(move({ type: "entry" }), taxes, products)).toBeNull();
  });

  it("maps units, task stages and partners", () => {
    expect(unitFromOdoo("Units")).toBe("NOS");
    expect(unitFromOdoo("Hours")).toBe("HRS");
    expect(unitFromOdoo(null)).toBe("NOS");
    expect(taskStatusFromOdoo({ stage: "In Progress", closed: false, cancelled: false })).toBe("in_progress");
    expect(taskStatusFromOdoo({ stage: "New", closed: false, cancelled: false })).toBe("todo");
    expect(taskStatusFromOdoo({ stage: "Anything", closed: true, cancelled: false })).toBe("done");
    expect(taskStatusFromOdoo({ stage: "Done", closed: true, cancelled: true })).toBe("cancelled");
    expect(taskStatusFromOdoo({ stage: "Client review", closed: false, cancelled: false })).toBe("waiting");
    const parents = new Map<number, number | null>([[3, 2], [2, 1], [1, null]]);
    expect(commercialPartner(3, parents)).toBe(1);
    expect(commercialPartner(99, parents)).toBe(99);
  });

  it("compares balances per account", () => {
    const r = compareBalances(new Map([["1200", 500], ["4100", -500]]), new Map([["1200", 500], ["4100", -400], ["5000", 0]]));
    expect(r.matches).toBe(false);
    expect(r.rows).toEqual([
      { key: "1200", odoo: 500, tevah: 500, difference: 0 },
      { key: "4100", odoo: -500, tevah: -400, difference: 100 },
    ]);
  });
});

describe("entryFingerprint", () => {
  it("is the same however the lines are split or ordered", () => {
    const a = entryFingerprint("2026-10-01", [
      { accountId: "debtors", debit: 11800, credit: 0 },
      { accountId: "sales", debit: 0, credit: 6000 },
      { accountId: "sales", debit: 0, credit: 4000 },
      { accountId: "cgst", debit: 0, credit: 900 },
      { accountId: "sgst", debit: 0, credit: 900 },
    ]);
    const b = entryFingerprint("2026-10-01", [
      { accountId: "sgst", debit: 0, credit: 900 },
      { accountId: "sales", debit: 0, credit: 10000 },
      { accountId: "cgst", debit: 0, credit: 900 },
      { accountId: "debtors", debit: 11800, credit: 0 },
    ]);
    expect(a).toBe(b);
    expect(a).toBe("2026-10-01|cgst:-900,debtors:11800,sales:-10000,sgst:-900");
  });

  it("differs on date or amount, and ignores accounts that net to zero", () => {
    const lines = [
      { accountId: "bank", debit: 500, credit: 0 },
      { accountId: "debtors", debit: 0, credit: 500 },
    ];
    expect(entryFingerprint("2026-10-01", lines)).not.toBe(entryFingerprint("2026-10-02", lines));
    expect(entryFingerprint("2026-10-01", [...lines, { accountId: "x", debit: 5, credit: 5 }])).toBe(entryFingerprint("2026-10-01", lines));
    expect(entryFingerprint("2026-10-01", [{ ...lines[0]!, debit: 501 }, lines[1]!])).not.toBe(entryFingerprint("2026-10-01", lines));
  });
});
