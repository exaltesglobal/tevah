import { formatINR } from "@tevah/core";
import { and, desc, eq, gte, like, lte, sql } from "drizzle-orm";
import Link from "next/link";
import { Badge, Button, ButtonLink, EmptyState, Input, PageHeader, Select, Table, Th } from "@/components/ui";
import { withOrg } from "@/db";
import { journalEntries, journalLines, journals } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { entrySources } from "@/lib/journal";
import { getOrg } from "@/lib/org";
import { fmtDate, readPeriod } from "../reports/period";

export const metadata = { title: "Journal" };

export default async function JournalPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; show?: string; q?: string }> }) {
  const session = await requireSession();
  const org = await getOrg(session.orgId);
  const params = await searchParams;
  const period = readPeriod(params, org.fyStartMonth);
  const manualOnly = params.show !== "all";
  const { rows, sources } = await withOrg(session.orgId, async (s) => {
    const rows = await s.tx
      .select({
        id: journalEntries.id,
        date: journalEntries.date,
        number: journalEntries.number,
        narration: journalEntries.narration,
        status: journalEntries.status,
        sourceRef: journalEntries.sourceRef,
        journalCode: journals.code,
        amount: sql<string>`(select coalesce(sum(${journalLines.debit}), 0) from ${journalLines} where ${journalLines.entryId} = ${journalEntries.id} and ${journalLines.orgId} = ${journalEntries.orgId})`,
      })
      .from(journalEntries)
      .innerJoin(journals, s.own(journals, eq(journals.id, journalEntries.journalId)))
      .where(
        s.own(
          journalEntries,
          gte(journalEntries.date, period.from),
          lte(journalEntries.date, period.to),
          manualOnly ? sql`(${journalEntries.sourceRef} in ('manual', 'odoo') or ${journalEntries.sourceRef} like 'bank:%')` : undefined,
          params.q ? and(like(journalEntries.narration, `%${params.q}%`)) : undefined,
        ),
      )
      .orderBy(desc(journalEntries.date), desc(journalEntries.createdAt))
      .limit(500);
    return { rows, sources: await entrySources(s, rows.map((r) => r.id)) };
  });

  return (
    <>
      <PageHeader
        title="Journal"
        subtitle="Manual entries, and every posting when showing all"
        actions={
          session.role !== "viewer" && session.role !== "staff" && <ButtonLink href="/journal/new">New journal entry</ButtonLink>
        }
      />
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <Input name="q" defaultValue={params.q} placeholder="Search narration" className="max-w-xs" />
        <Input type="date" name="from" defaultValue={period.from} className="w-auto!" aria-label="From" />
        <Input type="date" name="to" defaultValue={period.to} className="w-auto!" aria-label="To" />
        <Select name="show" defaultValue={manualOnly ? "manual" : "all"} className="w-auto!">
          <option value="manual">Manual, bank and imported entries</option>
          <option value="all">All postings</option>
        </Select>
        <Button variant="secondary">Filter</Button>
      </form>
      <Table
        head={
          <tr>
            <Th>Date</Th>
            <Th>Number</Th>
            <Th>Narration</Th>
            <Th>Journal</Th>
            <Th className="text-right">Amount</Th>
            <Th>Status</Th>
          </tr>
        }
        empty={rows.length === 0 && <EmptyState>No entries in this period.</EmptyState>}
      >
        {rows.map((r) => {
          const source = sources.get(r.id);
          return (
            <tr key={r.id} className="hover:bg-stone-50">
              <td className="whitespace-nowrap">{fmtDate(r.date)}</td>
              <td className="whitespace-nowrap">
                <Link href={`/journal/${r.id}`} className="font-medium text-brand-700 hover:underline">
                  {r.number ?? source?.label ?? "Entry"}
                </Link>
              </td>
              <td className="text-stone-600">{source ? `From ${source.label}` : r.narration}</td>
              <td>{r.journalCode}</td>
              <td className="text-right tabular-nums">{formatINR(Number(r.amount))}</td>
              <td>{r.status === "cancelled" ? <Badge>Cancelled</Badge> : <Badge tone="green">Posted</Badge>}</td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}
