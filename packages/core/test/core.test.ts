import { describe, expect, it } from "vitest";
import {
  assertBalanced,
  computeDocument,
  computeLine,
  formatINR,
  gstinCheckChar,
  INDIA_COA,
  isValidPan,
  postSalesInvoice,
  postVendorBill,
  rupeesToPaise,
  supplyType,
  SYSTEM_TAGS,
  validateGstin,
  type SystemAccounts,
} from "../src";

const accounts = Object.fromEntries(SYSTEM_TAGS.map((t) => [t, t])) as SystemAccounts;

describe("money", () => {
  it("parses rupees into paise", () => {
    expect(rupeesToPaise("1,234.5")).toBe(123450);
    expect(rupeesToPaise("₹ 10")).toBe(1000);
    expect(rupeesToPaise("-0.05")).toBe(-5);
    expect(() => rupeesToPaise("1.234")).toThrow();
  });

  it("formats in Indian grouping", () => {
    expect(formatINR(12345678)).toBe("1,23,456.78");
    expect(formatINR(1234567890, { symbol: true })).toBe("₹1,23,45,678.90");
    expect(formatINR(-50)).toBe("-0.50");
  });
});

describe("GSTIN", () => {
  it("accepts Exaltes Global's GSTIN", () => {
    const r = validateGstin("27aajce3276g1zh");
    expect(r).toEqual({ valid: true, gstin: "27AAJCE3276G1ZH", stateCode: "27", pan: "AAJCE3276G" });
  });

  it("rejects a wrong check digit", () => {
    const r = validateGstin("27AAJCE3276G1ZA");
    expect(r.valid).toBe(false);
  });

  it("computes check characters", () => {
    expect(gstinCheckChar("27AAJCE3276G1Z")).toBe("H");
  });

  it("validates PAN", () => {
    expect(isValidPan("AAJCE3276G")).toBe(true);
    expect(isValidPan("AAJCE3276")).toBe(false);
  });
});

describe("GST computation", () => {
  it("splits intra-state tax into equal CGST and SGST", () => {
    const line = computeLine({ quantity: 1, unitPrice: 100001, gstRateBps: 1800 }, "intra");
    expect(line.taxable).toBe(100001);
    expect(line.cgst).toBe(9000);
    expect(line.sgst).toBe(9000);
    expect(line.igst).toBe(0);
  });

  it("charges IGST across states", () => {
    expect(supplyType("27", "29")).toBe("inter");
    expect(supplyType("27", "27")).toBe("intra");
    expect(supplyType("27", null)).toBe("intra");
    const line = computeLine({ quantity: 2.5, unitPrice: 200000, discountBps: 1000, gstRateBps: 1800 }, "inter");
    expect(line.taxable).toBe(450000);
    expect(line.igst).toBe(81000);
  });

  it("rounds the document total to whole rupees", () => {
    const doc = computeDocument(
      [
        { quantity: 1, unitPrice: 33333, gstRateBps: 1800 },
        { quantity: 3, unitPrice: 1999, gstRateBps: 500 },
      ],
      { type: "intra" },
    );
    const exact = doc.taxable + doc.cgst + doc.sgst + doc.igst;
    expect(doc.total % 100).toBe(0);
    expect(doc.total - exact).toBe(doc.roundOff);
    expect(Math.abs(doc.roundOff)).toBeLessThanOrEqual(50);
  });

  it("excludes tax from the payable total under reverse charge", () => {
    const doc = computeDocument([{ quantity: 1, unitPrice: 100000, gstRateBps: 1800 }], {
      type: "intra",
      reverseCharge: true,
    });
    expect(doc.cgst + doc.sgst).toBe(18000);
    expect(doc.total).toBe(100000);
  });
});

describe("posting", () => {
  it("posts a balanced sales invoice", () => {
    const totals = computeDocument([{ quantity: 1, unitPrice: 123456, gstRateBps: 1800 }], { type: "intra" });
    const lines = postSalesInvoice({ totals, lineAccountIds: ["sales"], customerId: "c1", accounts });
    expect(() => assertBalanced(lines)).not.toThrow();
    expect(lines.find((l) => l.accountId === "receivable")?.debit).toBe(totals.total);
  });

  it("posts a vendor bill with TDS", () => {
    const totals = computeDocument([{ quantity: 1, unitPrice: 5000000, gstRateBps: 1800 }], { type: "inter" });
    const lines = postVendorBill({
      totals,
      lineAccountIds: ["purchases"],
      vendorId: "v1",
      accounts,
      tds: 500000,
    });
    expect(lines.find((l) => l.accountId === "payable")?.credit).toBe(totals.total - 500000);
    expect(lines.find((l) => l.accountId === "tds_payable")?.credit).toBe(500000);
    expect(lines.find((l) => l.accountId === "input_igst")?.debit).toBe(900000);
  });

  it("posts a reverse-charge bill with an RCM liability", () => {
    const totals = computeDocument([{ quantity: 1, unitPrice: 100000, gstRateBps: 1800 }], {
      type: "intra",
      reverseCharge: true,
    });
    const lines = postVendorBill({ totals, lineAccountIds: ["purchases"], vendorId: "v1", accounts, reverseCharge: true });
    expect(lines.find((l) => l.accountId === "rcm_cgst_payable")?.credit).toBe(9000);
    expect(lines.find((l) => l.accountId === "payable")?.credit).toBe(100000);
  });

  it("rejects unbalanced entries", () => {
    expect(() =>
      assertBalanced([
        { accountId: "a", debit: 100, credit: 0 },
        { accountId: "b", debit: 0, credit: 99 },
      ]),
    ).toThrow(/does not balance/);
  });
});

describe("chart of accounts", () => {
  it("covers every system tag exactly once with unique codes", () => {
    for (const tag of SYSTEM_TAGS) {
      expect(INDIA_COA.filter((a) => a.tag === tag)).toHaveLength(1);
    }
    expect(new Set(INDIA_COA.map((a) => a.code)).size).toBe(INDIA_COA.length);
  });
});
