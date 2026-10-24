import { buildGstr1, buildGstr3b, gstr1Json, monthRange, portalDate, stateName, type Gstr1 } from "@tevah/core";
import { withOrg } from "@/db";
import { gstDocuments, gstLedgerMovements } from "@/lib/reports";

/** "2026-10" from the query string, defaulting to last month (returns are filed for the month just ended). */
export function readMonth(value: string | undefined, today: string): string {
  if (value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return value;
  const [y, m] = today.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export async function loadReturns(orgId: string, month: string) {
  const period = monthRange(`${month}-01`);
  return withOrg(orgId, async (s) => {
    const docs = await gstDocuments(s, period);
    const ledger = await gstLedgerMovements(s, period);
    return { period, docs, gstr1: buildGstr1(docs), gstr3b: buildGstr3b(docs), ledger };
  });
}

/** "MMYYYY", the return period format the portal uses. */
export const portalPeriod = (month: string) => `${month.slice(5, 7)}${month.slice(0, 4)}`;

export { gstr1Json };

const money = (p: number) => (p / 100).toFixed(2);
const pct = (bps: number) => String(bps / 100);
const pos = (code: string) => `${code}-${stateName(code)}`;

/** CSV tables in the column order of the GST offline tool's Excel template. */
export function gstr1Csv(r: Gstr1, section: string): { name: string; rows: (string | number)[][] } | null {
  switch (section) {
    case "b2b":
      return {
        name: "b2b",
        rows: [
          ["GSTIN/UIN of Recipient", "Receiver Name", "Invoice Number", "Invoice date", "Invoice Value", "Place Of Supply", "Reverse Charge", "Invoice Type", "Rate", "Taxable Value", "Integrated Tax", "Central Tax", "State/UT Tax"],
          ...r.b2b.flatMap((i) =>
            i.items.map((it) => [i.gstin!, i.contactName, i.number, portalDate(i.date), money(i.value), pos(i.placeOfSupply), i.reverseCharge ? "Y" : "N", "Regular B2B", pct(it.rateBps), money(it.taxable), money(it.igst), money(it.cgst), money(it.sgst)]),
          ),
        ],
      };
    case "b2cl":
      return {
        name: "b2cl",
        rows: [
          ["Invoice Number", "Invoice date", "Invoice Value", "Place Of Supply", "Rate", "Taxable Value", "Integrated Tax"],
          ...r.b2cl.flatMap((i) => i.items.map((it) => [i.number, portalDate(i.date), money(i.value), pos(i.placeOfSupply), pct(it.rateBps), money(it.taxable), money(it.igst)])),
        ],
      };
    case "b2cs":
      return {
        name: "b2cs",
        rows: [
          ["Type", "Place Of Supply", "Rate", "Taxable Value", "Integrated Tax", "Central Tax", "State/UT Tax"],
          ...r.b2cs.map((b) => ["OE", pos(b.placeOfSupply), pct(b.rateBps), money(b.taxable), money(b.igst), money(b.cgst), money(b.sgst)]),
        ],
      };
    case "cdnr":
      return {
        name: "cdnr",
        rows: [
          ["GSTIN/UIN of Recipient", "Receiver Name", "Note Number", "Note Date", "Note Type", "Place Of Supply", "Reverse Charge", "Note Value", "Rate", "Taxable Value", "Integrated Tax", "Central Tax", "State/UT Tax"],
          ...r.cdnr.flatMap((n) =>
            n.items.map((it) => [n.gstin!, n.contactName, n.number, portalDate(n.date), "C", pos(n.placeOfSupply), n.reverseCharge ? "Y" : "N", money(n.value), pct(it.rateBps), money(it.taxable), money(it.igst), money(it.cgst), money(it.sgst)]),
          ),
        ],
      };
    case "exp":
      return {
        name: "exp",
        rows: [
          ["Export Type", "Invoice Number", "Invoice date", "Invoice Value", "Port Code", "Shipping Bill Number", "Shipping Bill Date", "Rate", "Taxable Value", "Integrated Tax"],
          ...r.exp.flatMap((i) => i.items.map((it) => ["WOPAY", i.number, portalDate(i.date), money(i.value), "", "", "", pct(it.rateBps), money(it.taxable), "0.00"])),
        ],
      };
    case "hsn":
      return {
        name: "hsn",
        rows: [
          ["Table", "HSN", "Description", "UQC", "Total Quantity", "Rate", "Taxable Value", "Integrated Tax Amount", "Central Tax Amount", "State/UT Tax Amount"],
          ...(["B2B", "B2C"] as const).flatMap((t) =>
            (t === "B2B" ? r.hsnB2b : r.hsnB2c).map((h) => [t, h.hsnSac, h.description, h.uqc, h.quantityMilli / 1000, pct(h.rateBps), money(h.taxable), money(h.igst), money(h.cgst), money(h.sgst)]),
          ),
        ],
      };
    case "docs":
      return {
        name: "docs",
        rows: [
          ["Nature of Document", "Sr. No. From", "Sr. No. To", "Total Number", "Cancelled"],
          ...r.documents.map((d) => [d.kind === "invoice" ? "Invoices for outward supply" : "Credit Note", d.from, d.to, d.total, d.cancelled]),
        ],
      };
    default:
      return null;
  }
}

export const toCsv = (rows: (string | number)[][]) =>
  rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(",")).join("\r\n") + "\r\n";
