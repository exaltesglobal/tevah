/**
 * All money is stored and computed as integer paise (1 rupee = 100 paise).
 * Floating point never touches a stored amount.
 */
export type Paise = number;

export function assertPaise(value: number, label = "amount"): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a whole number of paise, got ${value}`);
  }
}

/** Parse a rupee string like "1,234.50" or "1234.5" into paise. */
export function rupeesToPaise(input: string | number): Paise {
  const text = String(input).replace(/[,\s₹]/g, "");
  if (!/^-?\d+(\.\d{0,2})?$/.test(text)) {
    throw new Error(`Not a valid rupee amount: ${input}`);
  }
  const negative = text.startsWith("-");
  const [whole = "0", frac = ""] = text.replace("-", "").split(".");
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return negative ? -paise : paise;
}

/** Format paise in Indian digit grouping, e.g. 12345678 -> "1,23,456.78". */
export function formatINR(paise: Paise, opts: { symbol?: boolean } = {}): string {
  assertPaise(paise);
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100).toString();
  const frac = (abs % 100).toString().padStart(2, "0");
  const last3 = rupees.slice(-3);
  const rest = rupees.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
  return `${negative ? "-" : ""}${opts.symbol ? "₹" : ""}${grouped}.${frac}`;
}

/** Multiply paise by a rational factor and round half away from zero. */
export function mulRound(paise: Paise, numerator: number, denominator: number): Paise {
  const exact = (paise * numerator) / denominator;
  return Math.sign(exact) * Math.round(Math.abs(exact));
}

export function sum(values: readonly Paise[]): Paise {
  return values.reduce((a, b) => a + b, 0);
}
