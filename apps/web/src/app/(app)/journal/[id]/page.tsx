import { formatINR } from "@tevah/core";
import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/action-button";
import { Badge, Card, PageHeader, Table, Th } from "@/components/ui";
import { withOrg } from "@/db";
import { accounts, contacts, journalEntries, journalLines, journals } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { isUuid } from "@/lib/doc-kinds";
import { entrySources } from "@/lib/journal";
import { fmtDate } from "../../reports/period";
import { cancelJournalAction } from "../actions";

export const metadata = { title: "Journal entry" };

export default async function JournalEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await withOrg(session.orgId, async (s) => {
    const [entry] = await s.tx
      .select({ entry: journalEntries, journalName: journals.name })
      .from(journalEntries)
      .innerJoin(journals, s.own(journals, eq(journals.id, journalEntries.journalId)))
      .where(s.own(journalEntries, eq(journalEntries.id, id)));
    if (!entry) return null;
    const lines = await s.tx
      .select({ line: journalLines, code: accounts.code, account: accounts.name, contact: contacts.name })
      .from(journalLines)
      .innerJoin(accounts, s.own(accounts, eq(accounts.id, journalLines.accountId)))
      .leftJoin(contacts, s.own(contacts, eq(contacts.id, journalLines.contactId)))
      .where(s.own(journalLines, eq(journalLines.entryId, id)))
      .orderBy(asc(journalLines.credit), asc(accounts.code));
    const source = (await entrySources(s, [id])).get(id);
    return { ...entry, lines, source };
  });
  if (!data) notFound();
  const { entry, lines, source } = data;
  const manual = entry.sourceRef === "manual" || entry.sourceRef === "odoo" || entry.sourceRef?.startsWith("bank:");
  const canCancel = entry.status === "posted" && manual && (session.role === "admin" || session.role === "accountant");
  const total = lines.reduce((n, l) => n + l.line.debit, 0);

  return (
    <>
      <PageHeader
        title={`Journal entry ${entry.number ?? ""}`}
        subtitle={
          <>
            {fmtDate(entry.date)} · {data.journalName} {entry.status === "cancelled" && <Badge>Cancelled</Badge>}
          </>
        }
        actions={
          canCancel && (
            <ActionButton action={cancelJournalAction.bind(null, entry.id)} variant="danger" confirm="Cancel this entry? It stays on record but stops counting in balances.">
              Cancel entry
            </ActionButton>
          )
        }
      />
      <Card className="mb-4">
        <p className="text-sm">{entry.narration ?? "No narration"}</p>
        {entry.reference && <p className="mt-1 text-sm text-stone-500">Reference: {entry.reference}</p>}
        {source && (
          <p className="mt-1 text-sm">
            Posted from{" "}
            <Link href={source.href} className="text-brand-700 hover:underline">
              {source.label}
            </Link>
            ; change or cancel it there.
          </p>
        )}
      </Card>
      <Table
        head={
          <tr>
            <Th>Account</Th>
            <Th>Contact</Th>
            <Th>Note</Th>
            <Th className="text-right">Debit</Th>
            <Th className="text-right">Credit</Th>
          </tr>
        }
      >
        {lines.map(({ line, code, account, contact }) => (
          <tr key={line.id}>
            <td>
              <Link href={`/reports/general-ledger?account=${line.accountId}&from=${entry.date}&to=${entry.date}`} className="hover:text-brand-700 hover:underline">
                <span className="font-mono text-xs text-stone-500">{code}</span> {account}
              </Link>
            </td>
            <td>{contact ?? ""}</td>
            <td className="text-stone-600">{line.description ?? ""}</td>
            <td className="text-right tabular-nums">{line.debit ? formatINR(line.debit) : ""}</td>
            <td className="text-right tabular-nums">{line.credit ? formatINR(line.credit) : ""}</td>
          </tr>
        ))}
        <tr className="bg-stone-50 font-semibold">
          <td colSpan={3}>Total</td>
          <td className="text-right tabular-nums">{formatINR(total)}</td>
          <td className="text-right tabular-nums">{formatINR(total)}</td>
        </tr>
      </Table>
    </>
  );
}
