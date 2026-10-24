import { computeDocument } from "@tevah/core";
import { eq } from "drizzle-orm";
import { PageHeader } from "@/components/ui";
import type { PrintDoc, PrintLine, PrintParty } from "@/components/invoice-print";
import { withOrg } from "@/db";
import { orgs } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { loadInvoiceDesign } from "@/lib/invoice-design-server";
import { Designer } from "./designer";

const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

export const metadata = { title: "Invoice design" };

/** A made-up customer and two lines, so the preview shows every part of the layout. */
const SAMPLE_LINES = [
  { description: "Consulting services, October", hsnSac: "998311", quantity: 4, unit: "DAY", unitPrice: 2500000, discountBps: 0, gstRateBps: 1800 },
  { description: "Annual software licence", hsnSac: "997331", quantity: 1, unit: "NOS", unitPrice: 4800000, discountBps: 1000, gstRateBps: 1800 },
];

export default async function InvoiceDesignPage() {
  const session = await requireSession();
  const { org, design } = await withOrg(session.orgId, async (s) => {
    const [org] = await s.tx.select().from(orgs).where(eq(orgs.id, s.orgId));
    return { org: org!, design: await loadInvoiceDesign(s) };
  });

  const totals = computeDocument(SAMPLE_LINES, { type: "intra" });
  const today = todayIST();
  const sampleDoc: PrintDoc = {
    type: "invoice",
    number: "INV/2026-27/0042",
    date: today,
    dueDate: today,
    vendorReference: null,
    placeOfSupply: org.stateCode,
    supplyType: "intra",
    reverseCharge: false,
    taxable: totals.taxable,
    cgst: totals.cgst,
    sgst: totals.sgst,
    igst: totals.igst,
    roundOff: totals.roundOff,
    total: totals.total,
    tdsAmount: 0,
    tdsSection: null,
    tdsRateBps: 0,
    notes: null,
  };
  const sampleLines: PrintLine[] = SAMPLE_LINES.map((l, i) => ({
    ...l,
    id: String(i),
    quantityMilli: l.quantity * 1000,
    ...totals.lines[i]!,
  }));
  const customer: PrintParty = {
    name: "Sample Customer Pvt Ltd",
    gstin: `${org.stateCode}AABCS1234K1Z5`,
    addressLine1: "4th Floor, Sample Towers",
    addressLine2: null,
    city: "Pune",
    pincode: "411001",
    stateCode: org.stateCode,
    email: "accounts@example.com",
    phone: null,
  };

  return (
    <>
      <PageHeader
        title="Invoice design"
        subtitle="How your tax invoices and credit notes look when printed or saved as PDF"
      />
      <Designer
        initial={design}
        canEdit={session.role === "admin"}
        seller={org}
        sample={{ doc: sampleDoc, lines: sampleLines, buyer: customer }}
      />
    </>
  );
}
