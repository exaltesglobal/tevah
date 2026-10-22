import { formatINR, paymentStatus, type DocumentType } from "@tevah/core";
import { and, desc, eq, inArray, like, or, sql, type SQL } from "drizzle-orm";
import Link from "next/link";
import { Badge, Button, ButtonLink, EmptyState, Input, PageHeader, Select, Table, Th } from "@/components/ui";
import { withOrg } from "@/db";
import { contacts, documents } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { SIDES, TYPE_LABEL, type Side } from "@/lib/doc-kinds";
import { outstanding } from "@/lib/documents";

export type ListParams = Promise<{ q?: string; type?: string; status?: string }>;

export async function DocumentList({ side, searchParams }: { side: Side; searchParams: ListParams }) {
  const session = await requireSession();
  const { q, type, status } = await searchParams;
  const config = SIDES[side];
  const types: readonly DocumentType[] = config.types.includes(type as never) ? [type as DocumentType] : config.types;
  const filters: SQL[] = [inArray(documents.type, [...types])];
  if (status === "draft" || status === "posted" || status === "cancelled") filters.push(eq(documents.status, status));
  if (status === "due") {
    filters.push(eq(documents.status, "posted"), sql`${documents.total} - ${documents.tdsAmount} - ${documents.amountPaid} > 0`);
  }
  if (q) filters.push(or(like(contacts.name, `%${q}%`), like(documents.number, `%${q}%`))!);

  const { rows, due } = await withOrg(session.orgId, async (s) => {
    const rows = await s.tx
      .select({ doc: documents, contactName: contacts.name })
      .from(documents)
      .innerJoin(contacts, s.own(contacts, eq(contacts.id, documents.contactId)))
      .where(s.own(documents, ...filters))
      .orderBy(desc(documents.date), desc(documents.createdAt))
      .limit(500);
    const [d] = await s.tx
      .select({ due: sql<string>`coalesce(sum(${documents.total} - ${documents.tdsAmount} - ${documents.amountPaid}), 0)` })
      .from(documents)
      .where(s.own(documents, and(eq(documents.type, config.types[0]), eq(documents.status, "posted"))));
    return { rows, due: Number(d?.due ?? 0) };
  });

  return (
    <>
      <PageHeader
        title={config.title}
        subtitle={
          <>
            {config.subtitle} · {side === "sales" ? "Receivable" : "Payable"}{" "}
            <span className="font-medium text-stone-800">{formatINR(due, { symbol: true })}</span>
          </>
        }
        actions={config.types.map((t, i) => (
          <ButtonLink key={t} href={`/${side}/new?type=${t}`} variant={i === 0 ? "primary" : "secondary"}>
            New {TYPE_LABEL[t].toLowerCase()}
          </ButtonLink>
        ))}
      />
      <form className="mb-4 flex flex-wrap gap-2">
        <Input name="q" defaultValue={q} placeholder="Search number or name" className="max-w-xs" />
        <Select name="type" defaultValue={type ?? ""} className="w-auto!">
          <option value="">All types</option>
          {config.types.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </Select>
        <Select name="status" defaultValue={status ?? ""} className="w-auto!">
          <option value="">Any status</option>
          <option value="due">Unpaid</option>
          <option value="draft">Draft</option>
          <option value="posted">Posted</option>
          <option value="cancelled">Cancelled</option>
        </Select>
        <Button variant="secondary">Filter</Button>
      </form>
      <Table
        head={
          <tr>
            <Th>Number</Th>
            <Th>Date</Th>
            <Th>{config.contactLabel}</Th>
            <Th className="text-right">Total</Th>
            <Th className="text-right">Due</Th>
            <Th>Status</Th>
          </tr>
        }
        empty={rows.length === 0 && <EmptyState>Nothing here yet.</EmptyState>}
      >
        {rows.map(({ doc, contactName }) => (
          <tr key={doc.id} className="hover:bg-stone-50">
            <td>
              <Link href={`/${side}/${doc.id}`} className="font-medium text-brand-700 hover:underline">
                {doc.number ?? "Draft"}
              </Link>
              {doc.type !== config.types[0] && <span className="ml-2 text-xs text-stone-500">{TYPE_LABEL[doc.type]}</span>}
            </td>
            <td className="tabular-nums">{doc.date}</td>
            <td>{contactName}</td>
            <td className="text-right tabular-nums">{formatINR(doc.total)}</td>
            <td className="text-right tabular-nums">{doc.status === "posted" ? formatINR(outstanding(doc)) : "—"}</td>
            <td>
              <StatusBadge doc={doc} />
            </td>
          </tr>
        ))}
      </Table>
    </>
  );
}

export function StatusBadge({ doc }: { doc: typeof documents.$inferSelect }) {
  if (doc.status !== "posted") return <Badge tone={doc.status === "draft" ? "amber" : "stone"}>{doc.status === "draft" ? "Draft" : "Cancelled"}</Badge>;
  const isNote = doc.type === "credit_note" || doc.type === "debit_note";
  const paid = paymentStatus(doc.total - doc.tdsAmount, doc.amountPaid);
  const label = isNote
    ? { unpaid: "Unapplied", partial: "Part applied", paid: "Applied" }[paid]
    : { unpaid: "Unpaid", partial: "Part paid", paid: "Paid" }[paid];
  return <Badge tone={paid === "paid" ? "brand" : "amber"}>{label}</Badge>;
}
