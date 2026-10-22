import { formatINR } from "@tevah/core";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/action-button";
import { Badge, Card, PageHeader, Table, Th } from "@/components/ui";
import { withOrg } from "@/db";
import { contacts, documents, journals, paymentAllocations, payments } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { docPath, isUuid } from "@/lib/doc-kinds";
import { cancelPaymentAction } from "../actions";

export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await withOrg(session.orgId, async (s) => {
    const [row] = await s.tx
      .select({ payment: payments, contactName: contacts.name, journalName: journals.name })
      .from(payments)
      .innerJoin(contacts, s.own(contacts, eq(contacts.id, payments.contactId)))
      .innerJoin(journals, s.own(journals, eq(journals.id, payments.journalId)))
      .where(s.own(payments, eq(payments.id, id)));
    if (!row) return null;
    const settled = await s.tx
      .select({ id: documents.id, type: documents.type, number: documents.number, date: documents.date, amount: paymentAllocations.amount })
      .from(paymentAllocations)
      .innerJoin(documents, s.own(documents, eq(documents.id, paymentAllocations.documentId)))
      .where(s.own(paymentAllocations, eq(paymentAllocations.paymentId, id)));
    return { ...row, settled };
  });
  if (!data) notFound();
  const { payment: p, contactName, journalName, settled } = data;
  const received = p.direction === "received";
  const allocated = settled.reduce((n, d) => n + d.amount, 0);
  const unallocated = p.amount + p.tdsAmount - allocated;

  return (
    <>
      <PageHeader
        title={`${received ? "Receipt" : "Payment"} ${p.number}`}
        subtitle={p.status === "cancelled" ? <Badge>Cancelled</Badge> : undefined}
        actions={
          p.status === "posted" && (
            <ActionButton
              action={cancelPaymentAction.bind(null, p.id)}
              variant="danger"
              confirm="Cancel this payment? The documents it settled become due again."
            >
              Cancel payment
            </ActionButton>
          )
        }
      />
      <Card>
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <Item label={received ? "From" : "To"} value={contactName} />
          <Item label="Date" value={p.date} />
          <Item label={received ? "Deposited in" : "Paid from"} value={journalName} />
          <Item label="Amount" value={formatINR(p.amount, { symbol: true })} />
          {p.tdsAmount > 0 && <Item label="TDS deducted by customer" value={formatINR(p.tdsAmount, { symbol: true })} />}
          {p.reference && <Item label="Reference" value={p.reference} />}
          {unallocated > 0 && <Item label="Unallocated (advance)" value={formatINR(unallocated, { symbol: true })} />}
        </dl>
        {p.notes && <p className="mt-4 whitespace-pre-line text-sm text-stone-600">{p.notes}</p>}
      </Card>
      {settled.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 font-semibold">Settled</h2>
          <Table
            head={
              <tr>
                <Th>Document</Th>
                <Th>Date</Th>
                <Th className="text-right">Amount</Th>
              </tr>
            }
          >
            {settled.map((d) => (
              <tr key={d.id}>
                <td>
                  <Link href={docPath(d.type, d.id)} className="text-brand-700 hover:underline">
                    {d.number}
                  </Link>
                </td>
                <td>{d.date}</td>
                <td className="text-right tabular-nums">{formatINR(d.amount)}</td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-stone-100 py-1.5">
      <dt className="text-stone-500">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
