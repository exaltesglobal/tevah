import { rupeesToPaise, type Paise } from "./money";

/** Split CSV text into rows of cells (quoted fields, doubled quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/**
 * Read the date formats Indian banks export: 22/10/2026, 22-10-26,
 * 22-Oct-2026, 22 Oct 2026 and 2026-10-22. Day comes before month.
 */
export function parseBankDate(input: string): string | null {
  const s = input.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[/.\- ](\d{1,2}|[A-Za-z]{3,9})[/.\- ](\d{2}|\d{4})$/.exec(s);
  if (!m) return null;
  const month = /^\d+$/.test(m[2]!) ? +m[2]! : MONTHS[m[2]!.slice(0, 3).toLowerCase()];
  if (!month) return null;
  const year = m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!;
  return iso(year, month, +m[1]!);
}

function iso(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** Amount cell to paise; blanks, dashes and "Cr"/"Dr" suffixes allowed. Null when unreadable. */
export function parseBankAmount(input: string): Paise | null {
  let s = input.replace(/[₹,\s]/g, "").replace(/^INR/i, "");
  if (s === "" || s === "-") return 0;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  const suffix = /(CR|DR)\.?$/i.exec(s);
  if (suffix) {
    if (suffix[1]!.toUpperCase() === "DR") sign = -sign;
    s = s.slice(0, suffix.index);
  }
  if (s.startsWith("-")) {
    sign = -sign;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return sign * rupeesToPaise(s);
}

export interface BankColumns {
  date: number;
  description: number;
  reference?: number;
  /** Either separate withdrawal/deposit columns, or one signed amount. */
  withdrawal?: number;
  deposit?: number;
  amount?: number;
  balance?: number;
}

const HEADER_HINTS: Record<keyof BankColumns, RegExp> = {
  date: /^(txn |transaction |value )?date|^tran date/i,
  description: /narration|description|particulars|remarks|details/i,
  reference: /ref|chq|cheque|utr/i,
  withdrawal: /withdraw|debit|dr\b|paid out/i,
  deposit: /deposit|credit|cr\b|paid in/i,
  amount: /^amount/i,
  balance: /balance/i,
};

/** Find the header row (within the first 30 rows) and which column holds what. */
export function detectBankColumns(rows: readonly string[][]): { headerRow: number; columns: BankColumns } | null {
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const cells = rows[r]!;
    const find = (key: keyof BankColumns, skip: number[] = []) =>
      cells.findIndex((c, i) => !skip.includes(i) && HEADER_HINTS[key].test(c));
    const date = find("date");
    const description = find("description");
    if (date < 0 || description < 0) continue;
    const used = [date, description];
    const balance = find("balance", used);
    if (balance >= 0) used.push(balance);
    const withdrawal = find("withdrawal", used);
    if (withdrawal >= 0) used.push(withdrawal);
    const deposit = find("deposit", used);
    if (deposit >= 0) used.push(deposit);
    const amount = find("amount", used);
    if (amount >= 0) used.push(amount);
    const reference = find("reference", used);
    const split = withdrawal >= 0 && deposit >= 0;
    if (!split && amount < 0) continue;
    const opt = (i: number) => (i >= 0 ? i : undefined);
    return {
      headerRow: r,
      columns: {
        date,
        description,
        reference: opt(reference),
        withdrawal: split ? withdrawal : undefined,
        deposit: split ? deposit : undefined,
        amount: split ? undefined : amount,
        balance: opt(balance),
      },
    };
  }
  return null;
}

export interface StatementRow {
  date: string;
  description: string;
  reference: string | null;
  /** Money in is positive, money out negative. */
  amount: Paise;
  balance: Paise | null;
}

export interface ParsedStatement {
  rows: StatementRow[];
  /** Data rows that couldn't be read, with their 1-based line number. */
  skipped: { line: number; reason: string }[];
}

/** Parse a bank statement CSV into signed rows, skipping footer and summary lines. */
export function parseBankStatement(text: string): ParsedStatement {
  const rows = parseCsv(text);
  const detected = detectBankColumns(rows);
  if (!detected) throw new Error("Couldn't find the header row. The file needs Date, Narration/Description and amount columns.");
  const { headerRow, columns: c } = detected;
  const out: StatementRow[] = [];
  const skipped: ParsedStatement["skipped"] = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const cells = rows[r]!;
    const date = parseBankDate(cells[c.date] ?? "");
    if (!date) {
      // Lines without a date are separators, totals or the bank's footer text.
      if (cells.some((x) => /\d/.test(x)) && out.length && r < rows.length - 3) skipped.push({ line: r + 1, reason: "no readable date" });
      continue;
    }
    let amount: Paise | null;
    if (c.amount !== undefined) amount = parseBankAmount(cells[c.amount] ?? "");
    else {
      const out_ = parseBankAmount(cells[c.withdrawal!] ?? "");
      const in_ = parseBankAmount(cells[c.deposit!] ?? "");
      amount = out_ === null || in_ === null ? null : Math.abs(in_) - Math.abs(out_);
    }
    if (amount === null) {
      skipped.push({ line: r + 1, reason: "amount isn't a number" });
      continue;
    }
    if (amount === 0) continue;
    out.push({
      date,
      description: (cells[c.description] ?? "").replace(/\s+/g, " ").slice(0, 300),
      reference: c.reference !== undefined ? cells[c.reference]?.slice(0, 100) || null : null,
      amount,
      balance: c.balance !== undefined ? parseBankAmount(cells[c.balance] ?? "") : null,
    });
  }
  return { rows: out, skipped };
}

/** Stable key so re-importing an overlapping statement doesn't duplicate lines. */
export function statementRowKey(row: StatementRow, occurrence: number): string {
  return [row.date, row.amount, row.description.toLowerCase(), row.reference ?? "", occurrence].join("|");
}

export interface LedgerCandidate {
  lineId: string;
  date: string;
  /** Debit minus credit on the bank account, so money in is positive. */
  amount: Paise;
  text: string;
}

/**
 * Ledger lines that could be this statement line: same amount and
 * direction, within `days` days, best first (closest date, then a
 * reference or number that appears in the narration).
 */
export function matchCandidates(
  row: { date: string; amount: Paise; description: string; reference: string | null },
  ledger: readonly LedgerCandidate[],
  days = 10,
): LedgerCandidate[] {
  const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
  const haystack = `${row.description} ${row.reference ?? ""}`.toLowerCase();
  const score = (c: LedgerCandidate) => {
    const gap = Math.abs(day(c.date) - day(row.date));
    const words = c.text.toLowerCase().split(/[\s/,]+/).filter((w) => w.length >= 4);
    const textHit = words.some((w) => haystack.includes(w)) ? 0 : 0.5;
    return gap + textHit;
  };
  return ledger
    .filter((c) => c.amount === row.amount && Math.abs(day(c.date) - day(row.date)) <= days)
    .sort((a, b) => score(a) - score(b));
}
