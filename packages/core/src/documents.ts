import type { Paise } from "./money";

export const DOCUMENT_TYPES = ["invoice", "credit_note", "bill", "debit_note"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** Sales-side documents charge output tax; purchase-side ones claim input tax. */
export const isSalesDocument = (type: DocumentType) => type === "invoice" || type === "credit_note";

export const NUMBER_PREFIX: Record<DocumentType, string> = {
  invoice: "INV",
  credit_note: "CN",
  bill: "BILL",
  debit_note: "DN",
};

/** Financial year label for an ISO date, e.g. "2026-10-22" -> "2026-27" (April start). */
export function financialYear(isoDate: string, startMonth = 4): string {
  const [y, m] = isoDate.split("-").map(Number) as [number, number];
  const start = m >= startMonth ? y : y - 1;
  return startMonth === 1 ? String(start) : `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/**
 * GST invoice numbers must be unique per financial year and at most
 * 16 characters, so the year is shortened: "INV/26-27/0001".
 */
export function formatDocumentNumber(prefix: string, fy: string, sequence: number): string {
  const shortFy = /^\d{4}-\d{2}$/.test(fy) ? fy.slice(2) : fy;
  const number = `${prefix}/${shortFy}/${String(sequence).padStart(4, "0")}`;
  if (number.length > 16) throw new Error(`Document number ${number} is longer than 16 characters`);
  return number;
}

export type PaymentStatus = "unpaid" | "partial" | "paid";

export function paymentStatus(total: Paise, paid: Paise): PaymentStatus {
  if (paid <= 0) return "unpaid";
  return paid >= total ? "paid" : "partial";
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number): string {
  return n < 20 ? ONES[n]! : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
}

function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds]} Hundred` : "", rest ? belowHundred(rest) : ""].filter(Boolean).join(" ");
}

/** Whole number in the Indian system (crore, lakh, thousand). */
function indianWords(n: number): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 1_00_00_000);
  const lakh = Math.floor((n % 1_00_00_000) / 1_00_000);
  const thousand = Math.floor((n % 1_00_000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${indianWords(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (rest) parts.push(belowThousand(rest));
  return parts.join(" ");
}

/** "Rupees One Lakh Twenty Thousand and Fifty Paise Only" style text for invoices. */
export function amountInWords(paise: Paise): string {
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  const words = `Rupees ${indianWords(rupees)}${p ? ` and ${belowHundred(p)} Paise` : ""} Only`;
  return paise < 0 ? `Minus ${words}` : words;
}
