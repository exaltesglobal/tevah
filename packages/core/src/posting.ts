import type { DocumentTotals } from "./gst";
import { assertBalanced, compactLines, type EntryLine, type SystemTag } from "./ledger";
import type { Paise } from "./money";

export type SystemAccounts = Record<SystemTag, string>;

export interface SalesInvoicePosting {
  totals: DocumentTotals;
  /** Income account for each line, same order as totals.lines. */
  lineAccountIds: readonly string[];
  customerId: string;
  accounts: SystemAccounts;
}

/** Dr Receivable / Cr Income per line / Cr Output GST / round-off. */
export function postSalesInvoice(p: SalesInvoicePosting): EntryLine[] {
  const { totals, accounts: a, customerId } = p;
  if (p.lineAccountIds.length !== totals.lines.length) throw new Error("One income account per line is required");
  const lines: EntryLine[] = [
    { accountId: a.receivable, debit: totals.total, credit: 0, contactId: customerId },
    ...totals.lines.map((l, i) => ({ accountId: p.lineAccountIds[i]!, debit: 0, credit: l.taxable })),
    { accountId: a.output_cgst, debit: 0, credit: totals.cgst },
    { accountId: a.output_sgst, debit: 0, credit: totals.sgst },
    { accountId: a.output_igst, debit: 0, credit: totals.igst },
    roundOffLine(a.round_off, -totals.roundOff),
  ];
  return finish(lines);
}

/** A credit note is the sales invoice posting reversed. */
export function postCreditNote(p: SalesInvoicePosting): EntryLine[] {
  return finish(postSalesInvoice(p).map((l) => ({ ...l, debit: l.credit, credit: l.debit })));
}

export interface VendorBillPosting {
  totals: DocumentTotals;
  /** Expense or asset account for each line, same order as totals.lines. */
  lineAccountIds: readonly string[];
  vendorId: string;
  accounts: SystemAccounts;
  /** TDS withheld from the vendor, in paise. */
  tds?: Paise;
  reverseCharge?: boolean;
}

/**
 * Dr Expense per line / Dr Input GST / Cr Payable (net of TDS) / Cr TDS payable.
 * Under reverse charge the input credit is matched by an RCM liability instead of the vendor.
 */
export function postVendorBill(p: VendorBillPosting): EntryLine[] {
  const { totals, accounts: a, vendorId } = p;
  if (p.lineAccountIds.length !== totals.lines.length) throw new Error("One expense account per line is required");
  const tds = p.tds ?? 0;
  if (tds < 0 || tds > totals.total) throw new Error("TDS must be between zero and the bill total");
  const lines: EntryLine[] = [
    ...totals.lines.map((l, i) => ({ accountId: p.lineAccountIds[i]!, debit: l.taxable, credit: 0 })),
    { accountId: a.input_cgst, debit: totals.cgst, credit: 0 },
    { accountId: a.input_sgst, debit: totals.sgst, credit: 0 },
    { accountId: a.input_igst, debit: totals.igst, credit: 0 },
    roundOffLine(a.round_off, totals.roundOff),
    { accountId: a.payable, debit: 0, credit: totals.total - tds, contactId: vendorId },
    { accountId: a.tds_payable, debit: 0, credit: tds, contactId: vendorId },
  ];
  if (p.reverseCharge) {
    lines.push(
      { accountId: a.rcm_cgst_payable, debit: 0, credit: totals.cgst },
      { accountId: a.rcm_sgst_payable, debit: 0, credit: totals.sgst },
      { accountId: a.rcm_igst_payable, debit: 0, credit: totals.igst },
    );
  }
  return finish(lines);
}

/** A debit note (goods/services returned to a vendor) is the vendor bill posting reversed. */
export function postDebitNote(p: VendorBillPosting): EntryLine[] {
  return finish(postVendorBill(p).map((l) => ({ ...l, debit: l.credit, credit: l.debit })));
}

export interface PaymentPosting {
  amount: Paise;
  contactId: string;
  /** Bank or cash account the money moved through. */
  moneyAccountId: string;
  accounts: SystemAccounts;
  /** TDS the customer deducted before paying; it settles the receivable too. */
  tds?: Paise;
}

/** Customer receipt: Dr Bank / Dr TDS receivable / Cr Receivable. */
export function postCustomerReceipt(p: PaymentPosting): EntryLine[] {
  const tds = p.tds ?? 0;
  if (tds < 0) throw new Error("TDS can't be negative");
  return finish([
    { accountId: p.moneyAccountId, debit: p.amount, credit: 0 },
    { accountId: p.accounts.tds_receivable, debit: tds, credit: 0, contactId: p.contactId },
    { accountId: p.accounts.receivable, debit: 0, credit: p.amount + tds, contactId: p.contactId },
  ]);
}

/** Vendor payment: Dr Payable / Cr Bank. */
export function postVendorPayment(p: PaymentPosting): EntryLine[] {
  return finish([
    { accountId: p.accounts.payable, debit: p.amount, credit: 0, contactId: p.contactId },
    { accountId: p.moneyAccountId, debit: 0, credit: p.amount },
  ]);
}

/** Positive amount debits round-off, negative credits it. */
function roundOffLine(accountId: string, amount: Paise): EntryLine {
  return amount >= 0
    ? { accountId, debit: amount, credit: 0 }
    : { accountId, debit: 0, credit: -amount };
}

function finish(lines: EntryLine[]): EntryLine[] {
  const compact = compactLines(lines);
  assertBalanced(compact);
  return compact;
}
