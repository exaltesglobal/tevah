import { describe, expect, it } from "vitest";
import { computeDocument, supplyType } from "../src/gst";
import {
  ageing,
  balanceSheet,
  buildGstr1,
  buildGstr3b,
  daysOverdue,
  detectBankColumns,
  financialYearRange,
  gstr1Json,
  matchCandidates,
  monthRange,
  parseBankAmount,
  parseBankDate,
  parseBankStatement,
  parseCsv,
  profitAndLoss,
  runningBalances,
  trialBalance,
  type AccountTotals,
  type GstDocument,
  type GstLine,
} from "../src";

const acct = (code: string, type: AccountTotals["type"], debit: number, credit: number): AccountTotals => ({
  id: code,
  code,
  name: `Account ${code}`,
  type,
  debit,
  credit,
});

describe("financial statements", () => {
  // Capital 1,00,000 in; invoice 1,18,000 (1,00,000 + GST); rent 20,000 paid.
  const books = [
    acct("1110", "asset", 100_000_00, 20_000_00),
    acct("1200", "asset", 118_000_00, 0),
    acct("2200", "liability", 0, 18_000_00),
    acct("3100", "equity", 0, 100_000_00),
    acct("4100", "income", 0, 100_000_00),
    acct("5320", "expense", 20_000_00, 0),
    acct("5900", "expense", 0, 0),
  ];

  it("builds a balanced trial balance and skips idle accounts", () => {
    const tb = trialBalance(books);
    expect(tb.rows.map((r) => r.code)).toEqual(["1110", "1200", "2200", "3100", "4100", "5320"]);
    expect(tb.rows[0]).toMatchObject({ balanceDebit: 80_000_00, balanceCredit: 0 });
    expect(tb.totalDebit).toBe(218_000_00);
    expect(tb.balanced).toBe(true);
  });

  it("works out profit and the balance sheet", () => {
    const pl = profitAndLoss(books);
    expect(pl.totalIncome).toBe(100_000_00);
    expect(pl.totalExpenses).toBe(20_000_00);
    expect(pl.netProfit).toBe(80_000_00);
    const bs = balanceSheet(books);
    expect(bs.totalAssets).toBe(198_000_00);
    expect(bs.profitToDate).toBe(80_000_00);
    expect(bs.totalLiabilitiesAndEquity).toBe(198_000_00);
    expect(bs.balanced).toBe(true);
  });

  it("flags books that don't balance", () => {
    expect(trialBalance([acct("1", "asset", 5, 0)]).balanced).toBe(false);
  });

  it("keeps a running balance", () => {
    expect(runningBalances(1000, [{ date: "x", debit: 500, credit: 0 }, { date: "y", debit: 0, credit: 2000 }])).toEqual([1500, -500]);
  });
});

describe("ageing", () => {
  it("buckets open items by days past due", () => {
    expect(daysOverdue("2026-10-01", "2026-10-22")).toBe(21);
    const r = ageing(
      [
        { contactId: "a", contactName: "Acme", dueDate: "2026-11-01", amount: 100 },
        { contactId: "a", contactName: "Acme", dueDate: "2026-10-10", amount: 200 },
        { contactId: "b", contactName: "Beta", dueDate: "2026-06-01", amount: 1000 },
        { contactId: "b", contactName: "Beta", dueDate: "2026-08-15", amount: 50 },
      ],
      "2026-10-22",
    );
    expect(r.rows.map((x) => x.contactName)).toEqual(["Beta", "Acme"]);
    expect(r.rows[1]!.buckets).toMatchObject({ current: 100, "1-30": 200 });
    expect(r.rows[0]!.buckets).toMatchObject({ "61-90": 50, "90+": 1000 });
    expect(r.total).toBe(1350);
  });

  it("finds financial year and month ranges", () => {
    expect(financialYearRange("2026-10-22")).toEqual({ from: "2026-04-01", to: "2027-03-31" });
    expect(financialYearRange("2027-02-10")).toEqual({ from: "2026-04-01", to: "2027-03-31" });
    expect(financialYearRange("2026-10-22", 1)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(monthRange("2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
});

const line = (rateBps: number, taxable: number, inter: boolean, extra: Partial<GstLine> = {}): GstLine => {
  const tax = Math.round((taxable * rateBps) / 10000);
  return {
    hsnSac: "998314",
    description: "Software development",
    unit: "HRS",
    quantityMilli: 1000,
    gstRateBps: rateBps,
    taxable,
    igst: inter ? tax : 0,
    cgst: inter ? 0 : tax / 2,
    sgst: inter ? 0 : tax / 2,
    ...extra,
  };
};

const doc = (over: Partial<GstDocument> & Pick<GstDocument, "number" | "lines">): GstDocument => {
  const inter = over.supplyType === "inter";
  return {
    type: "invoice",
    status: "posted",
    date: "2026-10-05",
    gstin: null,
    contactName: "Someone",
    placeOfSupply: inter ? "29" : "27",
    supplyType: "intra",
    reverseCharge: false,
    total: over.lines.reduce((n, l) => n + l.taxable + l.igst + l.cgst + l.sgst, 0),
    ...over,
  };
};

describe("GSTR-1", () => {
  const docs: GstDocument[] = [
    doc({ number: "INV/26-27/0001", gstin: "29AABCA1234A1Z5", placeOfSupply: "29", supplyType: "inter", lines: [line(1800, 100_000_00, true), line(1200, 10_000_00, true, { hsnSac: "8471", unit: "NOS", quantityMilli: 2000 })] }),
    doc({ number: "INV/26-27/0002", lines: [line(1800, 10_000_00, false)] }),
    doc({ number: "INV/26-27/0003", supplyType: "inter", placeOfSupply: "07", lines: [line(1800, 200_000_00, true)] }),
    doc({ number: "INV/26-27/0004", lines: [line(0, 5_000_00, false)] }),
    doc({ number: "INV/26-27/0005", status: "cancelled", lines: [line(1800, 1_00, false)] }),
    doc({ number: "CN/26-27/0001", type: "credit_note", gstin: "29AABCA1234A1Z5", placeOfSupply: "29", supplyType: "inter", lines: [line(1800, 10_000_00, true)] }),
    doc({ number: "CN/26-27/0002", type: "credit_note", lines: [line(1800, 2_000_00, false)] }),
    doc({ number: "BILL/26-27/0001", type: "bill", lines: [line(1800, 50_000_00, false)] }),
  ];
  const r = buildGstr1(docs);

  it("sorts invoices into B2B, B2CL and B2CS", () => {
    expect(r.b2b.map((i) => i.number)).toEqual(["INV/26-27/0001"]);
    expect(r.b2b[0]!.items.map((i) => i.rateBps)).toEqual([1200, 1800]);
    expect(r.b2cl.map((i) => i.number)).toEqual(["INV/26-27/0003"]);
    expect(r.cdnr.map((i) => i.number)).toEqual(["CN/26-27/0001"]);
    // Intra-state B2C sale less the unregistered credit note.
    expect(r.b2cs).toEqual([{ placeOfSupply: "27", supplyType: "intra", rateBps: 1800, taxable: 8_000_00, igst: 0, cgst: 720_00, sgst: 720_00 }]);
  });

  it("summarises HSN, nil-rated supplies and document series", () => {
    expect(r.hsnB2b.find((h) => h.hsnSac === "8471")).toMatchObject({ uqc: "NOS", quantityMilli: 2000, rateBps: 1200 });
    expect(r.hsnB2b.find((h) => h.hsnSac === "998314")).toMatchObject({ uqc: "NA", quantityMilli: 0, taxable: 90_000_00 });
    expect(r.nil).toEqual([{ supplyType: "intra", registered: false, nilRated: 5_000_00 }]);
    expect(r.documents).toContainEqual({ kind: "invoice", prefix: "INV/26-27/", from: "INV/26-27/0001", to: "INV/26-27/0005", total: 5, cancelled: 1 });
    expect(r.totals.taxable).toBe(100_000_00 + 10_000_00 + 10_000_00 + 200_000_00 + 5_000_00 - 10_000_00 - 2_000_00);
  });

  it("writes the offline tool's JSON layout", () => {
    const json = gstr1Json("27AAJCE3276G1ZH", "102026", r);
    expect(json.b2b[0]!.ctin).toBe("29AABCA1234A1Z5");
    expect(json.b2b[0]!.inv[0]).toMatchObject({ inum: "INV/26-27/0001", idt: "05-10-2026", pos: "29", rchrg: "N", val: 1_29_200 });
    expect(json.b2b[0]!.inv[0]!.itms[1]!.itm_det).toEqual({ rt: 18, txval: 100000, iamt: 18000, camt: 0, samt: 0, csamt: 0 });
    expect(json.b2cs[0]).toMatchObject({ sply_ty: "INTRA", pos: "27", typ: "OE", rt: 18, txval: 8000 });
    expect(json.doc_issue.doc_det.map((d) => d.doc_num)).toEqual([1, 5]);
  });
});

describe("GSTR-3B", () => {
  it("nets outward tax, reverse charge and ITC", () => {
    const r = buildGstr3b([
      doc({ number: "INV/1", lines: [line(1800, 100_000_00, false), line(0, 1_000_00, false)] }),
      doc({ number: "INV/2", supplyType: "inter", placeOfSupply: "07", lines: [line(1800, 10_000_00, true)] }),
      doc({ number: "CN/1", type: "credit_note", lines: [line(1800, 10_000_00, false)] }),
      doc({ number: "BILL/1", type: "bill", lines: [line(1800, 20_000_00, false)] }),
      doc({ number: "BILL/2", type: "bill", reverseCharge: true, supplyType: "inter", lines: [line(1800, 5_000_00, true)] }),
      doc({ number: "DN/1", type: "debit_note", lines: [line(1800, 2_000_00, false)] }),
    ]);
    expect(r.outwardTaxable).toEqual({ taxable: 100_000_00, igst: 1_800_00, cgst: 8_100_00, sgst: 8_100_00 });
    expect(r.outwardNil).toBe(1_000_00);
    expect(r.interStateUnregistered).toEqual([{ placeOfSupply: "07", taxable: 10_000_00, igst: 1_800_00 }]);
    expect(r.inwardReverseCharge).toEqual({ taxable: 5_000_00, igst: 900_00, cgst: 0, sgst: 0 });
    expect(r.itcOther).toEqual({ taxable: 0, igst: 0, cgst: 1_620_00, sgst: 1_620_00 });
    expect(r.itcNet.igst).toBe(900_00);
    expect(r.liability).toEqual({ taxable: 0, igst: 2_700_00, cgst: 8_100_00, sgst: 8_100_00 });
    expect(r.netPayable).toEqual({ taxable: 0, igst: 1_800_00, cgst: 6_480_00, sgst: 6_480_00 });
  });
});

describe("bank statements", () => {
  it("parses quoted CSV", () => {
    expect(parseCsv('a,"b, c","d ""e"""\r\n\r\n1,2,3')).toEqual([["a", "b, c", 'd "e"'], ["1", "2", "3"]]);
  });

  it("reads Indian bank dates and amounts", () => {
    expect(parseBankDate("22/10/2026")).toBe("2026-10-22");
    expect(parseBankDate("05-10-26")).toBe("2026-10-05");
    expect(parseBankDate("22-Oct-2026")).toBe("2026-10-22");
    expect(parseBankDate("1 Sept 2026")).toBe("2026-09-01");
    expect(parseBankDate("2026-10-22")).toBe("2026-10-22");
    expect(parseBankDate("31/02/2026")).toBeNull();
    expect(parseBankDate("Opening balance")).toBeNull();
    expect(parseBankAmount("1,18,000.50")).toBe(118_000_50);
    expect(parseBankAmount("")).toBe(0);
    expect(parseBankAmount("500.00 Dr")).toBe(-500_00);
    expect(parseBankAmount("(250)")).toBe(-250_00);
    expect(parseBankAmount("abc")).toBeNull();
  });

  it("imports an HDFC-style statement with separate columns", () => {
    const csv = [
      "Statement of account,,,,,,",
      "Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance",
      "02/10/26,NEFT CR-ACME SOFTWARE-INV/26-27/0001,N123,02/10/26,,\"1,18,000.00\",\"2,18,000.00\"",
      "05/10/26,POS AWS SERVICES,0000,05/10/26,\"4,500.00\",,\"2,13,500.00\"",
      ",,,,,,",
      "Generated on 22/10/2026,,,,,,",
    ].join("\n");
    expect(detectBankColumns(parseCsv(csv))?.columns).toMatchObject({ date: 0, description: 1, reference: 2, withdrawal: 4, deposit: 5, balance: 6 });
    const { rows, skipped } = parseBankStatement(csv);
    expect(skipped).toEqual([]);
    expect(rows).toEqual([
      { date: "2026-10-02", description: "NEFT CR-ACME SOFTWARE-INV/26-27/0001", reference: "N123", amount: 118_000_00, balance: 218_000_00 },
      { date: "2026-10-05", description: "POS AWS SERVICES", reference: "0000", amount: -4_500_00, balance: 213_500_00 },
    ]);
  });

  it("imports a signed single-amount statement", () => {
    const { rows } = parseBankStatement("Txn Date,Description,Amount\n2026-10-01,Interest,125.50\n2026-10-02,Charges,-59");
    expect(rows.map((r) => r.amount)).toEqual([125_50, -59_00]);
  });

  it("rejects a file without a header", () => {
    expect(() => parseBankStatement("1,2,3\n4,5,6")).toThrow(/header row/);
  });

  it("suggests ledger lines with the same amount, closest first", () => {
    const row = { date: "2026-10-02", amount: 118_000_00, description: "NEFT CR-ACME SOFTWARE-RCPT/26-27/0001", reference: null };
    const ledger = [
      { lineId: "far", date: "2026-09-20", amount: 118_000_00, text: "RCPT/26-27/0009" },
      { lineId: "close", date: "2026-10-01", amount: 118_000_00, text: "RCPT/26-27/0001 Acme" },
      { lineId: "wrong-amount", date: "2026-10-02", amount: 18_000_00, text: "" },
      { lineId: "outgoing", date: "2026-10-02", amount: -118_000_00, text: "" },
    ];
    expect(matchCandidates(row, ledger).map((c) => c.lineId)).toEqual(["close"]);
    expect(matchCandidates(row, ledger, 30).map((c) => c.lineId)).toEqual(["close", "far"]);
  });
});

describe("exports under LUT", () => {
  const line = { hsnSac: "998315", description: "Hosting", unit: "NOS", quantityMilli: 1000, gstRateBps: 1800, taxable: 100000, cgst: 0, sgst: 0, igst: 0 };
  const base = { status: "posted" as const, gstin: null, contactName: "Acme Inc", placeOfSupply: "96", supplyType: "export" as const, reverseCharge: false, total: 100000, lines: [line] };
  const docs = [
    { ...base, type: "invoice" as const, number: "INV/26-27/0001", date: "2026-10-05" },
    { ...base, type: "credit_note" as const, number: "CN/26-27/0001", date: "2026-10-20", total: 20000, lines: [{ ...line, taxable: 20000 }] },
  ];

  it("carry no tax", () => {
    const t = computeDocument([{ quantity: 1, unitPrice: 100000, gstRateBps: 1800 }], { type: "export", reverseCharge: false });
    expect(t).toMatchObject({ taxable: 100000, cgst: 0, sgst: 0, igst: 0, total: 100000 });
    expect(supplyType("27", "96")).toBe("export");
  });

  it("go to GSTR-1 table 6A and 9B, not B2C, and to GSTR-3B 3.1(b)", () => {
    const r = buildGstr1(docs);
    expect(r.exp.map((i) => i.number)).toEqual(["INV/26-27/0001"]);
    expect(r.cdnur.map((i) => i.number)).toEqual(["CN/26-27/0001"]);
    expect(r.b2cs).toEqual([]);
    expect(r.b2cl).toEqual([]);
    expect(r.nil).toEqual([]);
    expect(r.totals).toMatchObject({ taxable: 80000, igst: 0, cgst: 0, sgst: 0 });
    const json = gstr1Json("27AAJCE3276G1ZH", "102026", r);
    expect(json.exp).toEqual([{ exp_typ: "WOPAY", inv: [{ inum: "INV/26-27/0001", idt: "05-10-2026", val: 1000, itms: [{ txval: 1000, rt: 18, iamt: 0, csamt: 0 }] }] }]);
    expect(json.cdnur[0]).toMatchObject({ typ: "EXPWOP", nt_num: "CN/26-27/0001" });
    const b = buildGstr3b(docs);
    expect(b.outwardZeroRated).toBe(80000);
    expect(b.outwardTaxable.taxable).toBe(0);
    expect(b.outwardNil).toBe(0);
  });
});
