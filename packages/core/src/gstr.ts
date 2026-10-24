import { sum, type Paise } from "./money";

/**
 * GST return summaries (GSTR-1 and GSTR-3B).
 *
 * Returns are invoice-wise by law, so these build from posted documents
 * rather than the ledger; the web layer checks the totals against the
 * GST accounts in the ledger.
 */

export interface GstLine {
  hsnSac: string | null;
  description: string;
  unit: string;
  quantityMilli: number;
  gstRateBps: number;
  taxable: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
}

export interface GstDocument {
  type: "invoice" | "credit_note" | "bill" | "debit_note";
  status: "posted" | "cancelled";
  number: string;
  date: string;
  /** Counterparty GSTIN; null when unregistered. */
  gstin: string | null;
  contactName: string;
  placeOfSupply: string;
  supplyType: "intra" | "inter";
  reverseCharge: boolean;
  total: Paise;
  lines: GstLine[];
}

export interface TaxAmounts {
  taxable: Paise;
  igst: Paise;
  cgst: Paise;
  sgst: Paise;
}

const zero = (): TaxAmounts => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0 });

function add(into: TaxAmounts, from: TaxAmounts, sign = 1): TaxAmounts {
  into.taxable += sign * from.taxable;
  into.igst += sign * from.igst;
  into.cgst += sign * from.cgst;
  into.sgst += sign * from.sgst;
  return into;
}

const taxOf = (l: GstLine): TaxAmounts => ({ taxable: l.taxable, igst: l.igst, cgst: l.cgst, sgst: l.sgst });

/** Inter-state invoices to unregistered buyers above this value go to B2CL (₹1 lakh from Aug 2024). */
export const B2CL_THRESHOLD: Paise = 1_00_000_00;

export interface RateRow extends TaxAmounts {
  rateBps: number;
}

/** A document's taxable lines summed per GST rate, as the return tables want them. */
export function itemsByRate(lines: readonly GstLine[]): RateRow[] {
  const byRate = new Map<number, RateRow>();
  for (const l of lines) {
    if (l.gstRateBps === 0) continue;
    const row = byRate.get(l.gstRateBps) ?? { rateBps: l.gstRateBps, ...zero() };
    add(row, taxOf(l));
    byRate.set(l.gstRateBps, row);
  }
  return [...byRate.values()].sort((a, b) => a.rateBps - b.rateBps);
}

export interface Gstr1Invoice {
  number: string;
  date: string;
  gstin: string | null;
  contactName: string;
  placeOfSupply: string;
  reverseCharge: boolean;
  value: Paise;
  items: RateRow[];
}

export interface B2csRow extends RateRow {
  placeOfSupply: string;
  supplyType: "intra" | "inter";
}

export interface HsnRow extends TaxAmounts {
  hsnSac: string;
  description: string;
  uqc: string;
  quantityMilli: number;
  rateBps: number;
}

export interface NilRow {
  supplyType: "intra" | "inter";
  registered: boolean;
  nilRated: Paise;
}

export interface DocumentSeries {
  kind: "invoice" | "credit_note";
  prefix: string;
  from: string;
  to: string;
  total: number;
  cancelled: number;
}

export interface Gstr1 {
  b2b: Gstr1Invoice[];
  b2cl: Gstr1Invoice[];
  b2cs: B2csRow[];
  /** Credit notes issued to registered buyers. */
  cdnr: Gstr1Invoice[];
  hsnB2b: HsnRow[];
  hsnB2c: HsnRow[];
  nil: NilRow[];
  documents: DocumentSeries[];
  totals: TaxAmounts;
}

/** Unit quantity codes the GST portal accepts for the HSN table; services report "NA". */
const UQC = new Set(["BAG", "BOX", "BTL", "CTN", "DOZ", "GMS", "KGS", "KLR", "LTR", "MTR", "MTS", "NOS", "PAC", "PCS", "QTL", "ROL", "SET", "SQF", "SQM", "TON", "UNT"]);

export function uqcFor(hsnSac: string, unit: string): string {
  if (hsnSac.startsWith("99")) return "NA";
  const u = unit.toUpperCase();
  return UQC.has(u) ? u : "OTH";
}

/** Build GSTR-1 for a period's sales documents (invoices and credit notes). */
export function buildGstr1(docs: readonly GstDocument[]): Gstr1 {
  const sales = docs.filter((d) => d.type === "invoice" || d.type === "credit_note");
  const posted = sales.filter((d) => d.status === "posted");
  const b2b: Gstr1Invoice[] = [];
  const b2cl: Gstr1Invoice[] = [];
  const cdnr: Gstr1Invoice[] = [];
  const b2cs = new Map<string, B2csRow>();
  const hsn = { b2b: new Map<string, HsnRow>(), b2c: new Map<string, HsnRow>() };
  const nil = new Map<string, NilRow>();
  const totals = zero();

  for (const d of posted) {
    const sign = d.type === "credit_note" ? -1 : 1;
    const registered = Boolean(d.gstin);
    const items = itemsByRate(d.lines);
    const row: Gstr1Invoice = {
      number: d.number,
      date: d.date,
      gstin: d.gstin,
      contactName: d.contactName,
      placeOfSupply: d.placeOfSupply,
      reverseCharge: d.reverseCharge,
      value: d.total,
      items,
    };
    if (items.length) {
      if (d.type === "credit_note" && registered) cdnr.push(row);
      else if (d.type === "invoice" && registered) b2b.push(row);
      else if (d.type === "invoice" && d.supplyType === "inter" && d.total > B2CL_THRESHOLD) b2cl.push(row);
      else {
        // Credit notes to unregistered buyers reduce the B2CS figures for their state and rate.
        for (const item of items) {
          const key = `${d.placeOfSupply}|${d.supplyType}|${item.rateBps}`;
          const agg = b2cs.get(key) ?? { placeOfSupply: d.placeOfSupply, supplyType: d.supplyType, rateBps: item.rateBps, ...zero() };
          add(agg, item, sign);
          b2cs.set(key, agg);
        }
      }
    }
    for (const l of d.lines) {
      add(totals, taxOf(l), sign);
      if (l.gstRateBps === 0) {
        const key = `${d.supplyType}|${registered}`;
        const agg = nil.get(key) ?? { supplyType: d.supplyType, registered, nilRated: 0 };
        agg.nilRated += sign * l.taxable;
        nil.set(key, agg);
      }
      const code = l.hsnSac ?? "";
      const uqc = uqcFor(code, l.unit);
      const key = `${code}|${l.gstRateBps}|${uqc}`;
      const table = registered ? hsn.b2b : hsn.b2c;
      const agg = table.get(key) ?? { hsnSac: code, description: l.description, uqc, quantityMilli: 0, rateBps: l.gstRateBps, ...zero() };
      if (uqc !== "NA") agg.quantityMilli += sign * l.quantityMilli;
      add(agg, taxOf(l), sign);
      table.set(key, agg);
    }
  }

  const byNumber = (a: Gstr1Invoice, b: Gstr1Invoice) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number);
  const hsnRows = (m: Map<string, HsnRow>) => [...m.values()].sort((a, b) => a.hsnSac.localeCompare(b.hsnSac) || a.rateBps - b.rateBps);
  return {
    b2b: b2b.sort(byNumber),
    b2cl: b2cl.sort(byNumber),
    b2cs: [...b2cs.values()].sort((a, b) => a.placeOfSupply.localeCompare(b.placeOfSupply) || a.rateBps - b.rateBps),
    cdnr: cdnr.sort(byNumber),
    hsnB2b: hsnRows(hsn.b2b),
    hsnB2c: hsnRows(hsn.b2c),
    nil: [...nil.values()],
    documents: documentSeries(sales),
    totals,
  };
}

/** Table 13: number ranges issued in the period, per series, with cancellations. */
export function documentSeries(docs: readonly GstDocument[]): DocumentSeries[] {
  const series = new Map<string, GstDocument[]>();
  for (const d of docs) {
    if (d.type !== "invoice" && d.type !== "credit_note") continue;
    const prefix = d.number.slice(0, d.number.lastIndexOf("/") + 1);
    const key = `${d.type}|${prefix}`;
    series.set(key, [...(series.get(key) ?? []), d]);
  }
  return [...series.entries()].map(([key, list]) => {
    const sorted = [...list].sort((a, b) => a.number.localeCompare(b.number));
    return {
      kind: key.split("|")[0] as DocumentSeries["kind"],
      prefix: key.split("|")[1]!,
      from: sorted[0]!.number,
      to: sorted.at(-1)!.number,
      total: sorted.length,
      cancelled: sorted.filter((d) => d.status === "cancelled").length,
    };
  });
}

export interface Gstr3b {
  /** 3.1(a) Outward taxable supplies (other than zero rated, nil and exempt). */
  outwardTaxable: TaxAmounts;
  /** 3.1(c) Other outward supplies: nil rated and exempt. */
  outwardNil: Paise;
  /** 3.1(d) Inward supplies liable to reverse charge. */
  inwardReverseCharge: TaxAmounts;
  /** 3.2 Inter-state supplies to unregistered persons, by place of supply. */
  interStateUnregistered: { placeOfSupply: string; taxable: Paise; igst: Paise }[];
  /** 4(A)(3) ITC on inward supplies liable to reverse charge. */
  itcReverseCharge: TaxAmounts;
  /** 4(A)(5) All other ITC. */
  itcOther: TaxAmounts;
  /** 4(C) Net ITC available. */
  itcNet: TaxAmounts;
  /** Tax due before set-off: outward tax plus reverse-charge tax. */
  liability: TaxAmounts;
  /** Liability less ITC, per head. Reverse-charge tax must be paid in cash; the portal applies the set-off order. */
  netPayable: TaxAmounts;
}

/** Build the GSTR-3B summary for a period's posted documents. */
export function buildGstr3b(docs: readonly GstDocument[]): Gstr3b {
  const outwardTaxable = zero();
  const inwardReverseCharge = zero();
  const itcOther = zero();
  let outwardNil = 0;
  const unregistered = new Map<string, { placeOfSupply: string; taxable: Paise; igst: Paise }>();

  for (const d of docs) {
    if (d.status !== "posted") continue;
    const sales = d.type === "invoice" || d.type === "credit_note";
    const sign = d.type === "credit_note" || d.type === "debit_note" ? -1 : 1;
    for (const l of d.lines) {
      const tax = taxOf(l);
      if (sales) {
        if (l.gstRateBps === 0) outwardNil += sign * l.taxable;
        else add(outwardTaxable, tax, sign);
        if (!d.gstin && d.supplyType === "inter" && l.gstRateBps > 0) {
          const row = unregistered.get(d.placeOfSupply) ?? { placeOfSupply: d.placeOfSupply, taxable: 0, igst: 0 };
          row.taxable += sign * l.taxable;
          row.igst += sign * l.igst;
          unregistered.set(d.placeOfSupply, row);
        }
      } else if (d.reverseCharge) {
        add(inwardReverseCharge, tax, sign);
      } else {
        add(itcOther, { ...tax, taxable: 0 }, sign);
      }
    }
  }

  const itcReverseCharge = { ...inwardReverseCharge, taxable: 0 };
  const itcNet = add(add(zero(), itcReverseCharge), itcOther);
  const liability = add(add(zero(), { ...outwardTaxable, taxable: 0 }), { ...inwardReverseCharge, taxable: 0 });
  const netPayable = add(add(zero(), liability), itcNet, -1);
  return {
    outwardTaxable,
    outwardNil,
    inwardReverseCharge,
    interStateUnregistered: [...unregistered.values()].sort((a, b) => a.placeOfSupply.localeCompare(b.placeOfSupply)),
    itcReverseCharge,
    itcOther,
    itcNet,
    liability,
    netPayable,
  };
}

// ---------------------------------------------------------------------------
// JSON in the GST offline tool's GSTR-1 layout

const rupees = (p: Paise) => Math.round(p) / 100;
const percent = (bps: number) => bps / 100;
/** dd-mm-yyyy, the portal's date format. */
export const portalDate = (iso: string) => iso.split("-").reverse().join("-");

const itemsJson = (items: readonly RateRow[]) =>
  items.map((i, n) => ({
    num: n + 1,
    itm_det: { rt: percent(i.rateBps), txval: rupees(i.taxable), iamt: rupees(i.igst), camt: rupees(i.cgst), samt: rupees(i.sgst), csamt: 0 },
  }));

const hsnJson = (rows: readonly HsnRow[]) =>
  rows.map((r, n) => ({
    num: n + 1,
    hsn_sc: r.hsnSac,
    desc: r.description.slice(0, 30),
    uqc: r.uqc,
    qty: r.quantityMilli / 1000,
    rt: percent(r.rateBps),
    txval: rupees(r.taxable),
    iamt: rupees(r.igst),
    camt: rupees(r.cgst),
    samt: rupees(r.sgst),
    csamt: 0,
  }));

function groupBy<T>(list: readonly T[], key: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const t of list) out.set(key(t), [...(out.get(key(t)) ?? []), t]);
  return out;
}

/** GSTR-1 as JSON for the GST offline tool; `period` is "MMYYYY". */
export function gstr1Json(gstin: string, period: string, r: Gstr1) {
  const nilKind = (n: NilRow) => `${n.supplyType === "inter" ? "INTR" : "INTRA"}${n.registered ? "B2B" : "B2C"}`;
  return {
    gstin,
    fp: period,
    b2b: [...groupBy(r.b2b, (i) => i.gstin!)].map(([ctin, invs]) => ({
      ctin,
      inv: invs.map((i) => ({
        inum: i.number,
        idt: portalDate(i.date),
        val: rupees(i.value),
        pos: i.placeOfSupply,
        rchrg: i.reverseCharge ? "Y" : "N",
        inv_typ: "R",
        itms: itemsJson(i.items),
      })),
    })),
    b2cl: [...groupBy(r.b2cl, (i) => i.placeOfSupply)].map(([pos, invs]) => ({
      pos,
      inv: invs.map((i) => ({ inum: i.number, idt: portalDate(i.date), val: rupees(i.value), itms: itemsJson(i.items) })),
    })),
    b2cs: r.b2cs.map((b) => ({
      sply_ty: b.supplyType === "inter" ? "INTER" : "INTRA",
      pos: b.placeOfSupply,
      typ: "OE",
      rt: percent(b.rateBps),
      txval: rupees(b.taxable),
      iamt: rupees(b.igst),
      camt: rupees(b.cgst),
      samt: rupees(b.sgst),
      csamt: 0,
    })),
    cdnr: [...groupBy(r.cdnr, (i) => i.gstin!)].map(([ctin, notes]) => ({
      ctin,
      nt: notes.map((n) => ({
        ntty: "C",
        nt_num: n.number,
        nt_dt: portalDate(n.date),
        val: rupees(n.value),
        pos: n.placeOfSupply,
        rchrg: n.reverseCharge ? "Y" : "N",
        inv_typ: "R",
        itms: itemsJson(n.items),
      })),
    })),
    hsn: { hsn_b2b: hsnJson(r.hsnB2b), hsn_b2c: hsnJson(r.hsnB2c) },
    nil: { inv: r.nil.map((n) => ({ sply_ty: nilKind(n), nil_amt: rupees(n.nilRated), expt_amt: 0, ngsup_amt: 0 })) },
    doc_issue: {
      doc_det: (["invoice", "credit_note"] as const)
        .map((kind) => ({ kind, docs: r.documents.filter((d) => d.kind === kind) }))
        .filter((g) => g.docs.length)
        .map((g) => ({
          doc_num: g.kind === "invoice" ? 1 : 5,
          docs: g.docs.map((d, n) => ({
            num: n + 1,
            from: d.from,
            to: d.to,
            totnum: d.total,
            cancel: d.cancelled,
            net_issue: d.total - d.cancelled,
          })),
        })),
    },
  };
}

/** Total tax across heads, handy for comparing with the ledger. */
export const totalTax = (t: TaxAmounts): Paise => sum([t.igst, t.cgst, t.sgst]);
