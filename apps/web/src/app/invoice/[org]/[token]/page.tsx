import { isSalesDocument } from "@tevah/core";
import { and, eq, ne } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InvoicePrint } from "@/components/invoice-print";
import { PrintButton } from "@/components/print-button";
import { withOrg } from "@/db";
import { contacts, documents, orgs } from "@/db/schema";
import { outstanding } from "@/lib/documents";
import { loadInvoiceDesign, upiQrSvg } from "@/lib/invoice-design-server";
import { loadDocument } from "../../../(app)/documents/load";

export const metadata: Metadata = { title: "Invoice", robots: { index: false, follow: false } };

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * A customer's copy of an invoice or credit note, reached from the link in
 * their email. The token is a 192-bit secret set when an app books the
 * document, so no sign-in is needed; drafts and purchase documents never get one.
 */
export default async function PublicInvoicePage({ params }: { params: Promise<{ org: string; token: string }> }) {
  const { org: orgId, token } = await params;
  if (!isUuid(orgId) || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) notFound();
  const data = await withOrg(orgId, async (s) => {
    const [found] = await s.tx
      .select({ id: documents.id })
      .from(documents)
      .where(s.own(documents, and(eq(documents.shareToken, token), ne(documents.status, "draft"))));
    if (!found) return null;
    const loaded = await loadDocument(s, found.id);
    if (!loaded || !isSalesDocument(loaded.doc.type)) return null;
    const [[org], [contact], design] = await Promise.all([
      s.tx.select().from(orgs).where(eq(orgs.id, s.orgId)),
      s.tx.select().from(contacts).where(s.own(contacts, eq(contacts.id, loaded.doc.contactId))),
      loadInvoiceDesign(s),
    ]);
    return { ...loaded, org: org!, contact: contact!, design };
  });
  if (!data) notFound();
  const { doc, lines, org, contact, design } = data;
  const due = outstanding(doc);
  const qr = doc.type === "invoice" && doc.status === "posted" && due > 0 ? await upiQrSvg(design, org.legalName, due, `Invoice ${doc.number ?? ""}`.trim()) : null;

  return (
    <main className="mx-auto max-w-4xl p-4 print:p-0 sm:p-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="text-sm text-stone-600">
          {doc.status === "cancelled" ? (
            <span className="font-medium text-amber-700">This document was cancelled.</span>
          ) : doc.type === "invoice" ? (
            due > 0 ? (
              <span>Amount due: a payment is still pending on this invoice.</span>
            ) : (
              <span>Paid in full. Nothing is due.</span>
            )
          ) : (
            <span>Credit note issued against your invoice.</span>
          )}
        </div>
        <PrintButton />
      </div>
      <InvoicePrint design={design} doc={doc} lines={lines} seller={org} buyer={contact} sales upiQrSvg={qr} />
      <p className="mt-6 text-center text-xs text-stone-400 print:hidden">Issued with Tevah</p>
    </main>
  );
}
