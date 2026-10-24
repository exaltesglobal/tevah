import { formatINR, isSalesDocument } from "@tevah/core";
import { and, eq, ne } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/action-button";
import { PrintButton } from "@/components/print-button";
import { InvoicePrint } from "@/components/invoice-print";
import { Badge, ButtonLink, PageHeader, Table, Th } from "@/components/ui";
import { withOrg } from "@/db";
import { contacts, documents, orgs, paymentAllocations, payments } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { docPath, isUuid, sideOf, TYPE_LABEL, type Side } from "@/lib/doc-kinds";
import { outstanding } from "@/lib/documents";
import { loadInvoiceDesign, upiQrSvg } from "@/lib/invoice-design-server";
import { cancelDocumentAction, deleteDraftAction, postDocumentAction } from "./actions";
import { StatusBadge } from "./document-list";
import { loadDocument } from "./load";

export async function DocumentView({ side, id }: { side: Side; id: string }) {
  const session = await requireSession();
  if (!isUuid(id)) notFound();
  const data = await withOrg(session.orgId, async (s) => {
    const loaded = await loadDocument(s, id);
    if (!loaded || sideOf(loaded.doc.type) !== side) return null;
    const { doc } = loaded;
    const [[org], [contact], settlements, notes, [original], design] = await Promise.all([
      s.tx.select().from(orgs).where(eq(orgs.id, s.orgId)),
      s.tx.select().from(contacts).where(s.own(contacts, eq(contacts.id, doc.contactId))),
      s.tx
        .select({ id: payments.id, number: payments.number, date: payments.date, amount: paymentAllocations.amount, status: payments.status })
        .from(paymentAllocations)
        .innerJoin(payments, s.own(payments, eq(payments.id, paymentAllocations.paymentId)))
        .where(s.own(paymentAllocations, eq(paymentAllocations.documentId, id))),
      s.tx
        .select({ id: documents.id, number: documents.number, type: documents.type, total: documents.total, status: documents.status })
        .from(documents)
        .where(s.own(documents, eq(documents.originalDocumentId, id), ne(documents.status, "draft"))),
      doc.originalDocumentId
        ? s.tx
            .select({ id: documents.id, number: documents.number, type: documents.type })
            .from(documents)
            .where(s.own(documents, and(eq(documents.id, doc.originalDocumentId))))
        : Promise.resolve([]),
      loadInvoiceDesign(s),
    ]);
    return { ...loaded, org: org!, contact: contact!, settlements, notes, original, design };
  });
  if (!data) notFound();
  const { doc, lines, org, contact, settlements, notes, original, design } = data;
  const sales = isSalesDocument(doc.type);
  const due = outstanding(doc);
  const canSettle = doc.status === "posted" && due > 0 && (doc.type === "invoice" || doc.type === "bill");
  const noteType = doc.type === "invoice" ? "credit_note" : doc.type === "bill" ? "debit_note" : null;
  const [seller, buyer] = sales ? [org, contact] : [contact, org];
  const toCollect = doc.status === "posted" ? due : doc.total - doc.tdsAmount;
  const qr =
    doc.type === "invoice" && doc.status !== "cancelled"
      ? await upiQrSvg(design, org.legalName, toCollect, `Invoice ${doc.number ?? ""}`.trim())
      : null;

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={`${TYPE_LABEL[doc.type]} ${doc.number ?? "(draft)"}`}
          subtitle={
            <span className="inline-flex items-center gap-2">
              <StatusBadge doc={doc} />
              {doc.status === "posted" && due !== 0 && <span>Due {formatINR(due, { symbol: true })}</span>}
            </span>
          }
          actions={
            <div className="flex flex-wrap items-start gap-2">
              {doc.status === "draft" && (
                <>
                  <ActionButton action={deleteDraftAction.bind(null, doc.type, doc.id)} variant="danger" confirm="Delete this draft?">
                    Delete
                  </ActionButton>
                  <ButtonLink href={`/${side}/${doc.id}/edit`} variant="secondary">
                    Edit
                  </ButtonLink>
                  <ActionButton action={postDocumentAction.bind(null, doc.type, doc.id)} variant="primary">
                    Post
                  </ActionButton>
                </>
              )}
              {doc.status === "posted" && (
                <>
                  <ActionButton
                    action={cancelDocumentAction.bind(null, doc.type, doc.id)}
                    variant="danger"
                    confirm="Cancel this document? Its number stays used and its ledger entry is reversed."
                  >
                    Cancel
                  </ActionButton>
                  {noteType && (
                    <ButtonLink href={`/${side}/new?type=${noteType}&original=${doc.id}`} variant="secondary">
                      {TYPE_LABEL[noteType]}
                    </ButtonLink>
                  )}
                  <PrintButton />
                  {canSettle && (
                    <ButtonLink href={`/payments/new?direction=${sales ? "received" : "paid"}&document=${doc.id}`}>
                      {sales ? "Record receipt" : "Record payment"}
                    </ButtonLink>
                  )}
                </>
              )}
            </div>
          }
        />
      </div>

      <InvoicePrint
        design={design}
        doc={doc}
        lines={lines}
        seller={seller}
        buyer={buyer}
        sales={sales}
        upiQrSvg={qr}
        against={original ? { number: original.number, href: docPath(original.type, original.id) } : null}
      />

      {(settlements.length > 0 || notes.length > 0) && (
        <div className="mt-6 print:hidden">
          <h2 className="mb-2 font-semibold">Settled by</h2>
          <Table
            head={
              <tr>
                <Th>Document</Th>
                <Th>Date</Th>
                <Th className="text-right">Amount</Th>
                <Th />
              </tr>
            }
          >
            {settlements.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/payments/${p.id}`} className="text-brand-700 hover:underline">
                    {p.number}
                  </Link>
                </td>
                <td>{p.date}</td>
                <td className="text-right tabular-nums">{formatINR(p.amount)}</td>
                <td>{p.status === "cancelled" && <Badge>Cancelled</Badge>}</td>
              </tr>
            ))}
            {notes.map((n) => (
              <tr key={n.id}>
                <td>
                  <Link href={docPath(n.type, n.id)} className="text-brand-700 hover:underline">
                    {n.number}
                  </Link>{" "}
                  <span className="text-xs text-stone-500">{TYPE_LABEL[n.type]}</span>
                </td>
                <td />
                <td className="text-right tabular-nums">{formatINR(n.total)}</td>
                <td>{n.status === "cancelled" && <Badge>Cancelled</Badge>}</td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </>
  );
}
