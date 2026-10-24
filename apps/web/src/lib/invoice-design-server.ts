import QRCode from "qrcode";
import type { Scope } from "@/db";
import { invoiceDesigns } from "@/db/schema";
import { DEFAULT_DESIGN, upiPayLink, type InvoiceDesign } from "./invoice-design";

/** The org's saved invoice design, or the defaults before anyone has opened the designer. */
export async function loadInvoiceDesign(s: Scope): Promise<InvoiceDesign> {
  const [row] = await s.tx.select().from(invoiceDesigns).where(s.own(invoiceDesigns));
  if (!row) return DEFAULT_DESIGN;
  const { id: _id, orgId: _org, updatedAt: _at, ...design } = row;
  return design;
}

/** SVG QR code for a UPI payment, rendered on the server so printing needs no script. */
export async function upiQrSvg(design: InvoiceDesign, payee: string, amountPaise: number, note: string): Promise<string | null> {
  if (!design.showUpiQr || !design.upiId || amountPaise <= 0) return null;
  const link = upiPayLink({ upiId: design.upiId, payee, amountPaise, note });
  return QRCode.toString(link, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
}
