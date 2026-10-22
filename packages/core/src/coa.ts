import type { AccountType, SystemTag } from "./ledger";

export interface AccountTemplate {
  code: string;
  name: string;
  type: AccountType;
  tag?: SystemTag;
}

/**
 * Starter chart of accounts for an Indian services or trading company,
 * grouped the way Schedule III presents the balance sheet.
 */
export const INDIA_COA: readonly AccountTemplate[] = [
  // Assets
  { code: "1100", name: "Cash in Hand", type: "asset", tag: "cash" },
  { code: "1110", name: "Bank Account", type: "asset", tag: "bank" },
  { code: "1200", name: "Trade Receivables (Debtors)", type: "asset", tag: "receivable" },
  { code: "1300", name: "Input CGST", type: "asset", tag: "input_cgst" },
  { code: "1301", name: "Input SGST", type: "asset", tag: "input_sgst" },
  { code: "1302", name: "Input IGST", type: "asset", tag: "input_igst" },
  { code: "1310", name: "TDS Receivable", type: "asset", tag: "tds_receivable" },
  { code: "1400", name: "Advances to Suppliers", type: "asset" },
  { code: "1410", name: "Prepaid Expenses", type: "asset" },
  { code: "1420", name: "Security Deposits", type: "asset" },
  { code: "1500", name: "Inventory", type: "asset" },
  { code: "1600", name: "Computers and Equipment", type: "asset" },
  { code: "1610", name: "Furniture and Fixtures", type: "asset" },
  { code: "1690", name: "Accumulated Depreciation", type: "asset" },
  // Liabilities
  { code: "2100", name: "Trade Payables (Creditors)", type: "liability", tag: "payable" },
  { code: "2200", name: "Output CGST", type: "liability", tag: "output_cgst" },
  { code: "2201", name: "Output SGST", type: "liability", tag: "output_sgst" },
  { code: "2202", name: "Output IGST", type: "liability", tag: "output_igst" },
  { code: "2210", name: "CGST Payable (Reverse Charge)", type: "liability", tag: "rcm_cgst_payable" },
  { code: "2211", name: "SGST Payable (Reverse Charge)", type: "liability", tag: "rcm_sgst_payable" },
  { code: "2212", name: "IGST Payable (Reverse Charge)", type: "liability", tag: "rcm_igst_payable" },
  { code: "2300", name: "TDS Payable", type: "liability", tag: "tds_payable" },
  { code: "2310", name: "Professional Tax Payable", type: "liability" },
  { code: "2400", name: "Advances from Customers", type: "liability" },
  { code: "2500", name: "Loans from Directors", type: "liability" },
  { code: "2600", name: "Outstanding Expenses", type: "liability" },
  // Equity
  { code: "3100", name: "Share Capital", type: "equity" },
  { code: "3200", name: "Reserves and Surplus", type: "equity", tag: "retained_earnings" },
  // Income
  { code: "4100", name: "Revenue from Services", type: "income", tag: "sales" },
  { code: "4110", name: "Sale of Goods", type: "income" },
  { code: "4200", name: "Interest Income", type: "income" },
  { code: "4300", name: "Other Income", type: "income" },
  // Expenses
  { code: "5100", name: "Purchases", type: "expense", tag: "purchases" },
  { code: "5200", name: "Salaries and Wages", type: "expense" },
  { code: "5300", name: "Professional and Consultancy Fees", type: "expense" },
  { code: "5310", name: "Software and Subscriptions", type: "expense" },
  { code: "5320", name: "Rent", type: "expense" },
  { code: "5330", name: "Internet and Telephone", type: "expense" },
  { code: "5340", name: "Travel and Conveyance", type: "expense" },
  { code: "5350", name: "Advertising and Marketing", type: "expense" },
  { code: "5360", name: "Office Expenses", type: "expense" },
  { code: "5370", name: "Bank Charges", type: "expense" },
  { code: "5380", name: "Rates and Taxes", type: "expense" },
  { code: "5390", name: "Depreciation", type: "expense" },
  { code: "5900", name: "Round Off", type: "expense", tag: "round_off" },
];

export const DEFAULT_JOURNALS = [
  { code: "INV", name: "Sales", type: "sales" },
  { code: "BILL", name: "Purchases", type: "purchase" },
  { code: "BNK", name: "Bank", type: "bank" },
  { code: "CSH", name: "Cash", type: "cash" },
  { code: "MISC", name: "Miscellaneous", type: "general" },
] as const;
