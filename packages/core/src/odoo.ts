import type { DocumentType } from "./documents";
import type { AccountType, SystemTag } from "./ledger";
import { rupeesToPaise, type Paise } from "./money";
import type { TaskStatus } from "./projects";

/**
 * Mapping rules for importing an Odoo company (the JSON written by
 * apps/web/scripts/odoo-export.mjs). Pure functions; the web app does the
 * database writes.
 */

export interface OdooTax {
  id: number;
  name: string;
  amount: number;
  amountType: string;
  use: string;
  group: string | null;
  childIds: number[];
  kind: string | null;
}

export interface OdooAccount {
  id: number;
  code: string;
  name: string;
  type: string;
  active: boolean;
}

export interface OdooMoveLine {
  id: number;
  accountId: number | null;
  partnerId: number | null;
  name: string | null;
  debit: number;
  credit: number;
  displayType: string | null;
  productId: number | null;
  quantity: number;
  priceUnit: number;
  discount: number;
  taxIds: number[];
  taxLineId: number | null;
  hsn: string | null;
  uom: string | null;
}

export interface OdooMove {
  id: number;
  name: string;
  type: string;
  state: "posted" | "cancel";
  date: string;
  invoiceDate: string | null;
  dueDate: string | null;
  partnerId: number | null;
  ref: string | null;
  narration: string | null;
  journalId: number | null;
  total: number;
  residual: number;
  tax: number;
  placeOfSupply: string | null;
  gstTreatment: string | null;
  reversedEntryId: number | null;
  lines: OdooMoveLine[];
}

/** Odoo amounts are floats already rounded to paise; go through text so no float error creeps in. */
export function odooPaise(amount: number | null | undefined): Paise {
  return rupeesToPaise((amount ?? 0).toFixed(2));
}

const ACCOUNT_TYPES: Record<string, AccountType> = {
  asset_receivable: "asset",
  asset_cash: "asset",
  asset_current: "asset",
  asset_non_current: "asset",
  asset_prepayments: "asset",
  asset_fixed: "asset",
  liability_payable: "liability",
  liability_credit_card: "liability",
  liability_current: "liability",
  liability_non_current: "liability",
  equity: "equity",
  equity_unaffected: "equity",
  income: "income",
  income_other: "income",
  expense: "expense",
  expense_depreciation: "expense",
  expense_direct_cost: "expense",
};

/** Odoo's account_type to ours; null for off-balance accounts, which aren't imported. */
export function odooAccountType(type: string): AccountType | null {
  return ACCOUNT_TYPES[type] ?? null;
}

/**
 * The system role an Odoo account plays, so invoices, bills, GST and TDS
 * land on Tevah's own control accounts. `journalType` is the type of a
 * bank or cash journal that uses the account as its default.
 */
export function odooAccountTag(account: Pick<OdooAccount, "name" | "type">, journalType?: string): SystemTag | null {
  const name = account.name.toLowerCase();
  const type = odooAccountType(account.type);
  if (account.type === "asset_receivable") return "receivable";
  if (account.type === "liability_payable") return "payable";
  if (account.type === "asset_cash") return journalType === "cash" || /\bcash\b/.test(name) ? "cash" : "bank";
  if (account.type === "equity_unaffected") return "retained_earnings";
  const gst = /\b(cgst|sgst|utgst|igst)\b/.exec(name)?.[1];
  if (gst && (type === "asset" || type === "liability")) {
    const part = gst === "utgst" ? "sgst" : (gst as "cgst" | "sgst" | "igst");
    if (/reverse|\brcm\b|\brc\b/.test(name)) return `rcm_${part}_payable` as SystemTag;
    if (/input|\bitc\b|receivable|credit/.test(name)) return `input_${part}` as SystemTag;
    if (/output|payable/.test(name)) return `output_${part}` as SystemTag;
    return type === "asset" ? (`input_${part}` as SystemTag) : (`output_${part}` as SystemTag);
  }
  if (/\b(tds|tcs)\b/.test(name)) {
    if (type === "liability") return "tds_payable";
    if (type === "asset") return "tds_receivable";
  }
  if (/round(ing)?[ -]?off|\brounding\b/.test(name) && (type === "expense" || type === "income")) return "round_off";
  return null;
}

export function documentTypeFromMove(moveType: string): DocumentType | null {
  switch (moveType) {
    case "out_invoice":
      return "invoice";
    case "out_refund":
      return "credit_note";
    case "in_invoice":
      return "bill";
    case "in_refund":
      return "debit_note";
    default:
      return null;
  }
}

/** Which part of GST (or TDS) a tax is, from its name and group. */
export function taxComponent(tax: Pick<OdooTax, "name" | "group" | "kind">): "cgst" | "sgst" | "igst" | "cess" | "tds" | null {
  const text = `${tax.kind ?? ""} ${tax.group ?? ""} ${tax.name}`.toLowerCase();
  if (/\b(tds|tcs|withholding)\b/.test(text)) return "tds";
  if (/\bcess\b/.test(text)) return "cess";
  if (/\bigst\b/.test(text)) return "igst";
  if (/\bcgst\b/.test(text)) return "cgst";
  if (/\b(sgst|utgst)\b/.test(text)) return "sgst";
  return null;
}

/** Leaf taxes behind a list of tax ids, expanding Odoo's group taxes (GST 18% = CGST 9% + SGST 9%). */
export function leafTaxes(ids: readonly number[], taxes: ReadonlyMap<number, OdooTax>): OdooTax[] {
  const out: OdooTax[] = [];
  for (const id of ids) {
    const t = taxes.get(id);
    if (!t) continue;
    if (t.amountType === "group" && t.childIds.length) out.push(...leafTaxes(t.childIds, taxes));
    else out.push(t);
  }
  return out;
}

/** GST rate in basis points for a line's taxes; TDS and cess are left out. */
export function gstRateBps(ids: readonly number[], taxes: ReadonlyMap<number, OdooTax>): number {
  return leafTaxes(ids, taxes)
    .filter((t) => t.amountType === "percent" && ["cgst", "sgst", "igst"].includes(taxComponent(t) ?? ""))
    .reduce((n, t) => n + Math.round(t.amount * 100), 0);
}

/** Map Odoo units of measure to the codes Tevah uses (GST UQC where one fits). */
export function unitFromOdoo(uom: string | null | undefined): string {
  const u = (uom ?? "").trim().toLowerCase();
  if (!u || /^units?$|^pcs?$|^each$/.test(u)) return "NOS";
  if (/^hours?$|^hrs?$/.test(u)) return "HRS";
  if (/^days?$/.test(u)) return "DAY";
  if (/^months?$/.test(u)) return "MTH";
  if (/^kg|kilogram/.test(u)) return "KGS";
  if (/^g$|^grams?$/.test(u)) return "GMS";
  if (/^l$|^litres?$|^liters?$/.test(u)) return "LTR";
  if (/^m$|^metres?$|^meters?$/.test(u)) return "MTR";
  if (/^dozens?$/.test(u)) return "DOZ";
  return u.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20) || "NOS";
}

/** Board column for an Odoo task, from its closed state and stage name. */
export function taskStatusFromOdoo(task: { stage: string | null; closed: boolean; cancelled: boolean; state?: string | null }): TaskStatus {
  if (task.cancelled || /cancel/i.test(task.stage ?? "")) return "cancelled";
  if (task.closed || task.state === "1_done") return "done";
  const stage = (task.stage ?? "").toLowerCase();
  if (/done|complete|closed|finished|delivered/.test(stage)) return "done";
  if (task.state === "04_waiting_normal" || /wait|hold|block|review|approval|feedback/.test(stage)) return "waiting";
  if (/progress|doing|working|ongoing|started|wip/.test(stage)) return "in_progress";
  return "todo";
}

/** Walk up to the company a person belongs to, which is who invoices are really for. */
export function commercialPartner(id: number, parents: ReadonlyMap<number, number | null>): number {
  let current = id;
  for (let i = 0; i < 10; i++) {
    const parent = parents.get(current);
    if (!parent) return current;
    current = parent;
  }
  return current;
}

export interface ImportedLine {
  description: string;
  hsnSac: string | null;
  quantityMilli: number;
  unit: string;
  unitPrice: Paise;
  discountBps: number;
  gstRateBps: number;
  odooAccountId: number;
  odooProductId: number | null;
  taxable: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  total: Paise;
}

export interface ImportedDocument {
  type: DocumentType;
  supplyType: "intra" | "inter";
  reverseCharge: boolean;
  lines: ImportedLine[];
  taxable: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  roundOff: Paise;
  /** Invoice value including GST, before any TDS. */
  total: Paise;
  tdsAmount: Paise;
  amountPaid: Paise;
}

const half = (n: number) => Math.round(n / 2);

/**
 * Turn an Odoo invoice, bill or refund into a Tevah document. Line GST is
 * worked out from the rate; the document's GST totals come from Odoo's
 * own tax lines, which are what the ledger holds.
 */
export function documentFromMove(
  move: OdooMove,
  taxes: ReadonlyMap<number, OdooTax>,
  products: ReadonlyMap<number, { name: string; hsn: string | null; uom: string | null }>,
): ImportedDocument | null {
  const type = documentTypeFromMove(move.type);
  if (!type) return null;
  const taxLines = move.lines.filter((l) => l.taxLineId !== null);
  const productLines = move.lines.filter((l) => l.accountId !== null && l.taxLineId === null && (l.displayType === "product" || (l.displayType === null && l.productId !== null)));
  const componentOf = (l: OdooMoveLine) => {
    const t = taxes.get(l.taxLineId!);
    return t ? taxComponent(t) : null;
  };
  const amountOf = (l: OdooMoveLine) => Math.abs(odooPaise(l.debit) - odooPaise(l.credit));
  const sumTax = (c: string) => taxLines.filter((l) => componentOf(l) === c).reduce((n, l) => n + amountOf(l), 0);
  const allTaxNames = [...taxLines.map((l) => taxes.get(l.taxLineId!)?.name ?? ""), ...productLines.flatMap((l) => leafTaxes(l.taxIds, taxes).map((t) => t.name))].join(" ");
  const igstUsed = taxLines.some((l) => componentOf(l) === "igst") || productLines.some((l) => leafTaxes(l.taxIds, taxes).some((t) => taxComponent(t) === "igst"));
  const supplyType = igstUsed ? "inter" : "intra";

  const lines = productLines.map((l): ImportedLine => {
    const product = l.productId ? products.get(l.productId) : undefined;
    const taxable = amountOf(l);
    const rate = gstRateBps(l.taxIds, taxes);
    const gst = Math.round((taxable * rate) / 10_000);
    const igst = supplyType === "inter" ? gst : 0;
    const cgst = supplyType === "intra" ? half(gst) : 0;
    const sgst = supplyType === "intra" ? gst - cgst : 0;
    return {
      description: (l.name ?? product?.name ?? "Item").slice(0, 500),
      hsnSac: (l.hsn ?? product?.hsn ?? null)?.replace(/\s/g, "").slice(0, 8) || null,
      quantityMilli: Math.round((l.quantity || 1) * 1000),
      unit: unitFromOdoo(l.uom ?? product?.uom),
      unitPrice: odooPaise(l.priceUnit),
      discountBps: Math.round((l.discount ?? 0) * 100),
      gstRateBps: rate,
      odooAccountId: l.accountId!,
      odooProductId: l.productId,
      taxable,
      cgst,
      sgst,
      igst,
      total: taxable + gst,
    };
  });

  const taxable = lines.reduce((n, l) => n + l.taxable, 0);
  const cgst = sumTax("cgst");
  const sgst = sumTax("sgst");
  const igst = sumTax("igst");
  const tdsAmount = sumTax("tds");
  // Odoo's total is net of TDS when TDS is a (negative) tax on the bill.
  const odooTotal = odooPaise(move.total);
  const total = odooTotal + tdsAmount;
  const roundOff = total - taxable - cgst - sgst - igst - sumTax("cess");
  const paid = move.state === "posted" ? Math.max(0, odooTotal - odooPaise(move.residual)) : 0;
  return {
    type,
    supplyType,
    reverseCharge: /reverse|\brcm\b|\(rc\)/i.test(allTaxNames) || /reverse/i.test(move.gstTreatment ?? ""),
    lines,
    taxable,
    cgst,
    sgst,
    igst,
    roundOff,
    total,
    tdsAmount,
    amountPaid: paid,
  };
}

export interface TrialBalanceDiff {
  key: string;
  odoo: Paise;
  tevah: Paise;
  difference: Paise;
}

/** Compare Odoo's balances (debit minus credit) with Tevah's, per Tevah account. */
export function compareBalances(odoo: ReadonlyMap<string, Paise>, tevah: ReadonlyMap<string, Paise>): { rows: TrialBalanceDiff[]; matches: boolean } {
  const keys = new Set([...odoo.keys(), ...tevah.keys()]);
  const rows = [...keys]
    .map((key) => {
      const o = odoo.get(key) ?? 0;
      const t = tevah.get(key) ?? 0;
      return { key, odoo: o, tevah: t, difference: t - o };
    })
    .filter((r) => r.odoo !== 0 || r.tevah !== 0);
  return { rows, matches: rows.every((r) => r.difference === 0) };
}

/**
 * What an entry does to the ledger: its date and the net movement on each
 * account. Two entries with the same fingerprint post the same thing, however
 * their lines are split, so an invoice typed into both Odoo and Tevah during a
 * parallel run can be recognised as one.
 */
export function entryFingerprint(date: string, lines: readonly { accountId: string; debit: Paise; credit: Paise }[]): string {
  const net = new Map<string, number>();
  for (const l of lines) net.set(l.accountId, (net.get(l.accountId) ?? 0) + l.debit - l.credit);
  const parts = [...net]
    .filter(([, n]) => n !== 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([a, n]) => `${a}:${n}`);
  return `${date}|${parts.join(",")}`;
}
