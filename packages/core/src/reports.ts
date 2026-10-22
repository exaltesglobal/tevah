import { naturalBalance, type AccountType } from "./ledger";
import { sum, type Paise } from "./money";

/** Posted debits and credits on one account over a period. */
export interface AccountTotals {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  debit: Paise;
  credit: Paise;
}

export interface TrialBalanceRow extends AccountTotals {
  /** Net balance shown on its natural side. */
  balanceDebit: Paise;
  balanceCredit: Paise;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  totalDebit: Paise;
  totalCredit: Paise;
  balanced: boolean;
}

/** Net each account to one side; accounts with no movement are left out. */
export function trialBalance(accounts: readonly AccountTotals[]): TrialBalance {
  const rows = accounts
    .filter((a) => a.debit !== 0 || a.credit !== 0)
    .map((a) => {
      const net = a.debit - a.credit;
      return { ...a, balanceDebit: net > 0 ? net : 0, balanceCredit: net < 0 ? -net : 0 };
    })
    .sort((x, y) => x.code.localeCompare(y.code));
  const totalDebit = sum(rows.map((r) => r.balanceDebit));
  const totalCredit = sum(rows.map((r) => r.balanceCredit));
  return { rows, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
}

export interface StatementLine {
  id: string;
  code: string;
  name: string;
  amount: Paise;
}

const lines = (accounts: readonly AccountTotals[], type: AccountType): StatementLine[] =>
  accounts
    .filter((a) => a.type === type)
    .map((a) => ({ id: a.id, code: a.code, name: a.name, amount: naturalBalance(type, a.debit, a.credit) }))
    .filter((l) => l.amount !== 0)
    .sort((x, y) => x.code.localeCompare(y.code));

export interface ProfitAndLoss {
  income: StatementLine[];
  expenses: StatementLine[];
  totalIncome: Paise;
  totalExpenses: Paise;
  /** Positive is a profit, negative a loss. */
  netProfit: Paise;
}

/** Profit and loss from movements within the period. */
export function profitAndLoss(accounts: readonly AccountTotals[]): ProfitAndLoss {
  const income = lines(accounts, "income");
  const expenses = lines(accounts, "expense");
  const totalIncome = sum(income.map((l) => l.amount));
  const totalExpenses = sum(expenses.map((l) => l.amount));
  return { income, expenses, totalIncome, totalExpenses, netProfit: totalIncome - totalExpenses };
}

export interface BalanceSheet {
  assets: StatementLine[];
  liabilities: StatementLine[];
  equity: StatementLine[];
  /** Income less expenses not yet closed to reserves. */
  profitToDate: Paise;
  totalAssets: Paise;
  totalLiabilitiesAndEquity: Paise;
  balanced: boolean;
}

/** Balance sheet from cumulative balances up to the report date. */
export function balanceSheet(accounts: readonly AccountTotals[]): BalanceSheet {
  const assets = lines(accounts, "asset");
  const liabilities = lines(accounts, "liability");
  const equity = lines(accounts, "equity");
  const { netProfit } = profitAndLoss(accounts);
  const totalAssets = sum(assets.map((l) => l.amount));
  const totalLiabilitiesAndEquity = sum([...liabilities, ...equity].map((l) => l.amount)) + netProfit;
  return {
    assets,
    liabilities,
    equity,
    profitToDate: netProfit,
    totalAssets,
    totalLiabilitiesAndEquity,
    balanced: totalAssets === totalLiabilitiesAndEquity,
  };
}

export interface LedgerMovement {
  date: string;
  debit: Paise;
  credit: Paise;
}

/** Running balance (debit minus credit) after each movement, starting from an opening balance. */
export function runningBalances(opening: Paise, movements: readonly LedgerMovement[]): Paise[] {
  let balance = opening;
  return movements.map((m) => (balance += m.debit - m.credit));
}

export const AGEING_BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];

export interface OpenItem {
  contactId: string;
  contactName: string;
  /** Due date, or the document date when there is none. */
  dueDate: string;
  amount: Paise;
}

export interface AgeingRow {
  contactId: string;
  contactName: string;
  buckets: Record<AgeingBucket, Paise>;
  total: Paise;
}

const DAY_MS = 86_400_000;

/** Days from the due date to the as-of date; zero or less is not yet due. */
export function daysOverdue(dueDate: string, asOf: string): number {
  return Math.round((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / DAY_MS);
}

export function ageingBucket(days: number): AgeingBucket {
  if (days <= 0) return "current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

const emptyBuckets = (): Record<AgeingBucket, Paise> => ({ current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 });

/** Group open items by contact and age, largest balance first. */
export function ageing(items: readonly OpenItem[], asOf: string): { rows: AgeingRow[]; totals: Record<AgeingBucket, Paise>; total: Paise } {
  const byContact = new Map<string, AgeingRow>();
  const totals = emptyBuckets();
  for (const item of items) {
    if (item.amount === 0) continue;
    let row = byContact.get(item.contactId);
    if (!row) {
      row = { contactId: item.contactId, contactName: item.contactName, buckets: emptyBuckets(), total: 0 };
      byContact.set(item.contactId, row);
    }
    const bucket = ageingBucket(daysOverdue(item.dueDate, asOf));
    row.buckets[bucket] += item.amount;
    row.total += item.amount;
    totals[bucket] += item.amount;
  }
  const rows = [...byContact.values()].sort((a, b) => b.total - a.total || a.contactName.localeCompare(b.contactName));
  return { rows, totals, total: sum(rows.map((r) => r.total)) };
}

/** First and last day of the financial year containing a date, e.g. 2026-04-01 to 2027-03-31. */
export function financialYearRange(isoDate: string, startMonth = 4): { from: string; to: string } {
  const [y, m] = isoDate.split("-").map(Number) as [number, number];
  const startYear = m >= startMonth ? y : y - 1;
  const from = `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
  const end = new Date(Date.UTC(startYear + 1, startMonth - 1, 0));
  return { from, to: end.toISOString().slice(0, 10) };
}

/** First and last day of the calendar month containing a date. */
export function monthRange(isoDate: string): { from: string; to: string } {
  const [y, m] = isoDate.split("-").map(Number) as [number, number];
  const end = new Date(Date.UTC(y, m, 0));
  return { from: `${y}-${String(m).padStart(2, "0")}-01`, to: end.toISOString().slice(0, 10) };
}
