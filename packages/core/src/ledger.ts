import { assertPaise, sum, type Paise } from "./money";

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Accounts the posting rules look up by role rather than by code. */
export const SYSTEM_TAGS = [
  "receivable",
  "payable",
  "bank",
  "cash",
  "sales",
  "purchases",
  "output_cgst",
  "output_sgst",
  "output_igst",
  "input_cgst",
  "input_sgst",
  "input_igst",
  "rcm_cgst_payable",
  "rcm_sgst_payable",
  "rcm_igst_payable",
  "tds_payable",
  "tds_receivable",
  "round_off",
  "retained_earnings",
] as const;
export type SystemTag = (typeof SYSTEM_TAGS)[number];

export interface EntryLine {
  accountId: string;
  debit: Paise;
  credit: Paise;
  contactId?: string | null;
  description?: string | null;
}

/** Throws unless the lines form a balanced double-entry posting. */
export function assertBalanced(lines: readonly EntryLine[]): void {
  if (lines.length < 2) throw new Error("A journal entry needs at least two lines");
  for (const [i, line] of lines.entries()) {
    assertPaise(line.debit, `line ${i + 1} debit`);
    assertPaise(line.credit, `line ${i + 1} credit`);
    if (line.debit < 0 || line.credit < 0) throw new Error(`Line ${i + 1} has a negative amount`);
    if ((line.debit > 0) === (line.credit > 0)) {
      throw new Error(`Line ${i + 1} must have either a debit or a credit`);
    }
  }
  const debits = sum(lines.map((l) => l.debit));
  const credits = sum(lines.map((l) => l.credit));
  if (debits !== credits) {
    throw new Error(`Entry does not balance: debits ${debits} vs credits ${credits} paise`);
  }
}

/**
 * Signed balance in the account's natural direction:
 * debit-normal for assets and expenses, credit-normal for the rest.
 */
export function naturalBalance(type: AccountType, debit: Paise, credit: Paise): Paise {
  return type === "asset" || type === "expense" ? debit - credit : credit - debit;
}

/** Collapse lines that hit the same account and side, and drop zero lines. */
export function compactLines(lines: readonly EntryLine[]): EntryLine[] {
  const merged = new Map<string, EntryLine>();
  for (const line of lines) {
    if (line.debit === 0 && line.credit === 0) continue;
    const side = line.debit > 0 ? "D" : "C";
    const key = `${line.accountId}|${side}|${line.contactId ?? ""}|${line.description ?? ""}`;
    const existing = merged.get(key);
    if (existing) {
      existing.debit += line.debit;
      existing.credit += line.credit;
    } else {
      merged.set(key, { ...line });
    }
  }
  return [...merged.values()];
}
