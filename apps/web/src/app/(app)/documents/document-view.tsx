import { amountInWords, formatINR, isSalesDocument, stateName } from "@tevah/core";
import { and, eq, ne } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/action-button";
import { PrintButton } from "@/components/print-button";
import { Badge, ButtonLink, Card, PageHeader, Table, Th } from "@/components/ui";
import { withOrg } from "@/db";
import { contacts, documents, orgs, paymentAllocations, payments } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { docPath, isUuid, sideOf, TYPE_LABEL, type Side } from "@/lib/doc-kinds";
import { outstanding } from "@/lib/documents";
import { formatRate } from "@/lib/products";
import { cancelDocumentAction, deleteDraftAction, postDocumentAction } from "./actions";
import { StatusBadge } from "./document-list";
import { loadDocument } from "./load";

const PRINT_TITLE = { invoice: "Tax Invoice", credit_note: "Credit Note", bill: "Purchase Bill", debit_note: "Debit Note" } as const;

export async function DocumentView({ side, id }: { side: Side; id: string }) {
  const session = await requireSession();
  if (!isUuid(id)) notFound();
  const data = await withOrg(session.orgId, async (s) => {
    const loaded = await loadDocument(s, id);
    if (!loaded || sideOf(loaded.doc.type) !== side) return null;
    const { doc } = loaded;
    const [[org], [contact], settlements, notes, [original]] = await Promise.all([
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
    ]);
    return { ...loaded, org: org!, contact: contact!, settlements, notes, original };
  });
  if (!data) notFound();
  const { doc, lines, org, contact, settlements, notes, original } = data;
  const sales = isSalesDocument(doc.type);
  const due = outstanding(doc);
  const canSettle = doc.status === "posted" && due > 0 && (doc.type === "invoice" || doc.type === "bill");
  const noteType = doc.type === "invoice" ? "credit_note" : doc.type === "bill" ? "debit_note" : null;
  const [seller, buyer] = sales ? [org, contact] : [contact, org];

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

      <Card className="print:border-0 print:p-0">
        <div className="flex flex-wrap justify-between gap-6 border-b border-stone-200 pb-5">
          <Party label={sales ? undefined : "Supplier"} party={seller} large={sales} />
          <div className="text-right">
            <div className="text-xl font-semibold tracking-tight">{PRINT_TITLE[doc.type]}</div>
            <dl className="mt-2 grid grid-cols-[auto_auto] justify-end gap-x-4 gap-y-0.5 text-sm">
              <dt className="text-stone-500">Number</dt>
              <dd className="font-medium">{doc.number ?? "Draft"}</dd>
              <dt className="text-stone-500">Date</dt>
              <dd>{doc.date}</dd>
              {doc.dueDate && (
                <>
                  <dt className="text-stone-500">Due</dt>
                  <dd>{doc.dueDate}</dd>
                </>
              )}
              {doc.vendorReference && (
                <>
                  <dt className="text-stone-500">Vendor bill no.</dt>
                  <dd>{doc.vendorReference}</dd>
                </>
              )}
              {original && (
                <>
                  <dt className="text-stone-500">Against</dt>
                  <dd>
                    <Link href={docPath(original.type, original.id)} className="text-brand-700 hover:underline">
                      {original.number}
                    </Link>
                  </dd>
                </>
              )}
              <dt className="text-stone-500">Place of supply</dt>
              <dd>
                {stateName(doc.placeOfSupply)} ({doc.placeOfSupply})
              </dd>
              <dt className="text-stone-500">Reverse charge</dt>
              <dd>{doc.reverseCharge ? "Yes" : "No"}</dd>
            </dl>
          </div>
        </div>
        <div className="border-b border-stone-200 py-4">
          <Party label={sales ? "Bill to" : "Billed to"} party={buyer} />
        </div>

        <div className="-mx-5 overflow-x-auto print:mx-0">
          <table className="w-full text-sm">
            <thead className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr className="[&_th]:px-3 [&_th]:py-2 [&_th]:font-medium">
                <th className="pl-5!">#</th>
                <th>Item</th>
                <th>HSN/SAC</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Rate</th>
                <th className="text-right">Disc</th>
                <th className="text-right">Taxable</th>
                <th className="text-right">GST</th>
                <th className="pr-5! text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 [&_td]:px-3 [&_td]:py-2">
              {lines.map((l, i) => (
                <tr key={l.id}>
                  <td className="pl-5! text-stone-500">{i + 1}</td>
                  <td>{l.description}</td>
                  <td className="font-mono text-xs">{l.hsnSac ?? "—"}</td>
                  <td className="text-right tabular-nums whitespace-nowrap">
                    {Number((l.quantityMilli / 1000).toFixed(3))} {l.unit}
                  </td>
                  <td className="text-right tabular-nums">{formatINR(l.unitPrice)}</td>
                  <td className="text-right tabular-nums">{l.discountBps ? `${l.discountBps / 100}%` : "—"}</td>
                  <td className="text-right tabular-nums">{formatINR(l.taxable)}</td>
                  <td className="text-right tabular-nums whitespace-nowrap">
                    {formatRate(l.gstRateBps)}
                    <span className="block text-xs text-stone-500">{formatINR(l.cgst + l.sgst + l.igst)}</span>
                  </td>
                  <td className="pr-5! text-right tabular-nums">{formatINR(l.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap justify-between gap-6 border-t border-stone-200 pt-4">
          <div className="max-w-md space-y-2 text-sm">
            <p>
              <span className="text-stone-500">Amount in words: </span>
              {amountInWords(doc.total)}
            </p>
            {doc.reverseCharge && <p className="text-amber-800">Tax on this supply is payable by the recipient under reverse charge.</p>}
            {doc.notes && <p className="whitespace-pre-line text-stone-600">{doc.notes}</p>}
          </div>
          <dl className="min-w-64 space-y-1 text-sm">
            <Total label="Taxable value" value={doc.taxable} />
            {doc.supplyType === "intra" ? (
              <>
                <Total label="CGST" value={doc.cgst} />
                <Total label="SGST" value={doc.sgst} />
              </>
            ) : (
              <Total label="IGST" value={doc.igst} />
            )}
            {doc.roundOff !== 0 && <Total label="Round off" value={doc.roundOff} />}
            <Total label="Total" value={doc.total} strong />
            {doc.tdsAmount > 0 && (
              <>
                <Total label={`TDS ${doc.tdsSection ?? ""} @ ${doc.tdsRateBps / 100}%`} value={-doc.tdsAmount} />
                <Total label="Net payable" value={doc.total - doc.tdsAmount} strong />
              </>
            )}
          </dl>
        </div>
        {sales && (
          <p className="mt-10 hidden text-right text-sm print:block">
            For {org.legalName}
            <br />
            <br />
            <br />
            Authorised signatory
          </p>
        )}
      </Card>

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

interface PartyInfo {
  name: string;
  legalName?: string;
  gstin: string | null;
  pan?: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  pincode: string | null;
  stateCode: string | null;
  email: string | null;
  phone: string | null;
}

function Party({ label, party, large }: { label?: string; party: PartyInfo; large?: boolean }) {
  const place = [party.city, party.pincode].filter(Boolean).join(" ");
  return (
    <div className="text-sm leading-relaxed">
      {label && <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>}
      <div className={large ? "text-lg font-semibold" : "font-semibold"}>{party.legalName ?? party.name}</div>
      {party.addressLine1 && <div>{party.addressLine1}</div>}
      {party.addressLine2 && <div>{party.addressLine2}</div>}
      {place && <div>{place}</div>}
      {party.stateCode && (
        <div>
          {stateName(party.stateCode)} ({party.stateCode})
        </div>
      )}
      <div className="font-mono text-xs">{party.gstin ? `GSTIN ${party.gstin}` : "Unregistered"}</div>
      {(party.email || party.phone) && <div className="text-stone-600">{[party.email, party.phone].filter(Boolean).join(" · ")}</div>}
    </div>
  );
}

function Total({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-6 ${strong ? "border-t border-stone-200 pt-1 font-semibold" : ""}`}>
      <dt className={strong ? undefined : "text-stone-500"}>{label}</dt>
      <dd className="tabular-nums">{formatINR(value, { symbol: true })}</dd>
    </div>
  );
}
