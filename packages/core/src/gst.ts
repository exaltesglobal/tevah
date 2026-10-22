import { assertPaise, mulRound, sum, type Paise } from "./money";

/**
 * GST rates are basis points: 1800 = 18%.
 * Current slabs after the 2025 rationalisation, plus the legacy 12% and 28%
 * which still appear on older documents.
 */
export const GST_RATES_BPS = [0, 25, 150, 300, 500, 1200, 1800, 2800, 4000] as const;

export type SupplyType = "intra" | "inter";

/** Same state for supplier and place of supply means CGST+SGST, otherwise IGST. */
export function supplyType(supplierState: string, placeOfSupply: string | null | undefined): SupplyType {
  return !placeOfSupply || placeOfSupply === supplierState ? "intra" : "inter";
}

export interface LineInput {
  quantity: number;
  unitPrice: Paise;
  /** Discount in basis points, 1000 = 10%. */
  discountBps?: number;
  gstRateBps: number;
}

export interface LineTax {
  /** Value before GST, after discount. */
  taxable: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  total: Paise;
}

export function computeLine(line: LineInput, type: SupplyType): LineTax {
  assertPaise(line.unitPrice, "unit price");
  if (!(line.quantity > 0)) throw new Error("Quantity must be greater than zero");
  if (!Number.isInteger(line.gstRateBps) || line.gstRateBps < 0 || line.gstRateBps > 10000) {
    throw new Error(`Invalid GST rate ${line.gstRateBps}`);
  }
  const discount = line.discountBps ?? 0;
  if (!Number.isInteger(discount) || discount < 0 || discount > 10000) {
    throw new Error(`Invalid discount ${discount}`);
  }
  // Quantity may carry up to 3 decimals (hours, kg); scale to stay in integers.
  const qtyMilli = Math.round(line.quantity * 1000);
  const gross = mulRound(line.unitPrice, qtyMilli, 1000);
  const taxable = gross - mulRound(gross, discount, 10000);

  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (type === "intra") {
    // Each half is rounded on its own so CGST always equals SGST.
    cgst = mulRound(taxable, line.gstRateBps, 20000);
    sgst = cgst;
  } else {
    igst = mulRound(taxable, line.gstRateBps, 10000);
  }
  return { taxable, cgst, sgst, igst, total: taxable + cgst + sgst + igst };
}

export interface DocumentTotals {
  lines: LineTax[];
  taxable: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  /** Adjustment to reach a whole-rupee total, between -50 and +50 paise. */
  roundOff: Paise;
  /** Amount the counterparty owes / is owed. */
  total: Paise;
}

export interface DocumentOptions {
  type: SupplyType;
  /** Round the grand total to whole rupees (default true). */
  roundToRupee?: boolean;
  /** Reverse charge: tax is computed and reported but not charged to the counterparty. */
  reverseCharge?: boolean;
}

export function computeDocument(lines: readonly LineInput[], opts: DocumentOptions): DocumentTotals {
  if (lines.length === 0) throw new Error("A document needs at least one line");
  const computed = lines.map((l) => computeLine(l, opts.type));
  const taxable = sum(computed.map((l) => l.taxable));
  const cgst = sum(computed.map((l) => l.cgst));
  const sgst = sum(computed.map((l) => l.sgst));
  const igst = sum(computed.map((l) => l.igst));
  const beforeRounding = opts.reverseCharge ? taxable : taxable + cgst + sgst + igst;
  const total = opts.roundToRupee === false ? beforeRounding : mulRound(beforeRounding, 1, 100) * 100;
  return { lines: computed, taxable, cgst, sgst, igst, roundOff: total - beforeRounding, total };
}
