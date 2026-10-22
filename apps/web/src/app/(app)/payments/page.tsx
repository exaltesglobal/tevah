import { formatINR } from "@tevah/core";
import { desc, eq, type SQL } from "drizzle-orm";
import Link from "next/link";
import { Badge, Button, ButtonLink, EmptyState, PageHeader, Select, Table, Th } from "@/components/ui";
import { withOrg } from "@/db";
import { contacts, journals, payments } from "@/db/schema";
import { requireSession } from "@/lib/auth";

export const metadata = { title: "Payments" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ direction?: string }> }) {
  const session = await requireSession();
  const { direction } = await searchParams;
  const filters: SQL[] = [];
  if (direction === "received" || direction === "paid") filters.push(eq(payments.direction, direction));

  const rows = await withOrg(session.orgId, (s) =>
    s.tx
      .select({ payment: payments, contactName: contacts.name, journalName: journals.name })
      .from(payments)
      .innerJoin(contacts, s.own(contacts, eq(contacts.id, payments.contactId)))
      .innerJoin(journals, s.own(journals, eq(journals.id, payments.journalId)))
      .where(s.own(payments, ...filters))
      .orderBy(desc(payments.date), desc(payments.createdAt))
      .limit(500),
  );

  return (
    <>
      <PageHeader
        title="Payments"
        subtitle="Money received from customers and paid to vendors"
        actions={
          <>
            <ButtonLink href="/payments/new?direction=paid" variant="secondary">
              Pay a vendor
            </ButtonLink>
            <ButtonLink href="/payments/new?direction=received">Record a receipt</ButtonLink>
          </>
        }
      />
      <form className="mb-4 flex gap-2">
        <Select name="direction" defaultValue={direction ?? ""} className="w-auto!">
          <option value="">All</option>
          <option value="received">Received</option>
          <option value="paid">Paid</option>
        </Select>
        <Button variant="secondary">Filter</Button>
      </form>
      <Table
        head={
          <tr>
            <Th>Number</Th>
            <Th>Date</Th>
            <Th>Contact</Th>
            <Th>Account</Th>
            <Th className="text-right">Amount</Th>
            <Th />
          </tr>
        }
        empty={rows.length === 0 && <EmptyState>No payments yet.</EmptyState>}
      >
        {rows.map(({ payment: p, contactName, journalName }) => (
          <tr key={p.id} className="hover:bg-stone-50">
            <td>
              <Link href={`/payments/${p.id}`} className="font-medium text-brand-700 hover:underline">
                {p.number}
              </Link>
            </td>
            <td className="tabular-nums">{p.date}</td>
            <td>{contactName}</td>
            <td className="text-stone-600">{journalName}</td>
            <td className={`text-right tabular-nums ${p.direction === "paid" ? "text-stone-700" : "text-brand-700"}`}>
              {p.direction === "paid" ? "−" : "+"}
              {formatINR(p.amount)}
              {p.tdsAmount > 0 && <span className="block text-xs text-stone-500">+ TDS {formatINR(p.tdsAmount)}</span>}
            </td>
            <td>{p.status === "cancelled" && <Badge>Cancelled</Badge>}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
