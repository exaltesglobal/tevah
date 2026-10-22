import { formatINR } from "@tevah/core";
import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/action-button";
import { Badge, Card, EmptyState, PageHeader, Table, Th } from "@/components/ui";
import { withOrg } from "@/db";
import { accounts } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { bankJournal, reconciliationSummary, statementLines, suggestMatches, unmatchedLedger, type StatementFilter } from "@/lib/banking";
import { isUuid } from "@/lib/doc-kinds";
import { UserError } from "@/lib/documents";
import { fmtDate } from "../../reports/period";
import { deleteLineAction, matchAction, unmatchAction } from "../actions";
import { BookForm, UploadForm } from "../forms";

export const metadata = { title: "Bank reconciliation" };

export default async function BankAccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ show?: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sp = await searchParams;
  const show: StatementFilter = (["matched", "all"] as const).find((f) => f === sp.show) ?? "unmatched";
  const data = await withOrg(session.orgId, async (s) => {
    try {
      const bank = await bankJournal(s, id);
      const [lines, ledger, summary, bookable] = await Promise.all([
        statementLines(s, id, show),
        unmatchedLedger(s, id),
        reconciliationSummary(s, id),
        s.tx
          .select({ id: accounts.id, code: accounts.code, name: accounts.name, tag: accounts.systemTag })
          .from(accounts)
          .where(s.own(accounts, eq(accounts.archived, false)))
          .orderBy(asc(accounts.code)),
      ]);
      return { bank, lines, ledger, summary, bookable };
    } catch (e) {
      if (e instanceof UserError) return null;
      throw e;
    }
  });
  if (!data) notFound();
  const { bank, lines, ledger, summary } = data;
  const suggestions = suggestMatches(lines, ledger);
  const canEdit = session.role !== "viewer";
  const bookable = data.bookable
    .filter((a) => a.id !== bank.account.id && a.tag !== "receivable" && a.tag !== "payable")
    .map((a) => ({ id: a.id, label: `${a.code} ${a.name}` }));
  const difference = summary?.statementBalance != null ? summary.statementBalance - summary.ledgerBalance : null;

  return (
    <>
      <PageHeader
        title={bank.account.name}
        subtitle={
          <>
            <Link href="/banking" className="text-brand-700 hover:underline">
              Banking
            </Link>{" "}
            · account {bank.account.code} ·{" "}
            <Link href={`/reports/general-ledger?account=${bank.account.id}`} className="text-brand-700 hover:underline">
              ledger
            </Link>
          </>
        }
      />
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Import a statement</h2>
          {canEdit ? <UploadForm journalId={id} /> : <p className="text-sm text-stone-500">You have read-only access.</p>}
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Reconciliation</h2>
          {summary ? (
            <dl className="space-y-1.5 text-sm">
              <Row label={`Statement balance on ${fmtDate(summary.asOf)}`} value={summary.statementBalance != null ? formatINR(summary.statementBalance, { symbol: true }) : "not in file"} />
              <Row label={`Balance in books on ${fmtDate(summary.asOf)}`} value={formatINR(summary.ledgerBalance, { symbol: true })} />
              <Row label={`Statement lines not yet matched (${summary.unmatchedCount})`} value={formatINR(summary.unmatchedTotal, { symbol: true })} />
              {difference != null && (
                <p className={`mt-2 rounded-md px-3 py-2 ${difference === 0 ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>
                  {difference === 0
                    ? "✓ Books agree with the bank."
                    : `Books differ from the bank by ${formatINR(Math.abs(difference), { symbol: true })}. Match or book the open lines below, and check for entries dated after the statement.`}
                </p>
              )}
            </dl>
          ) : (
            <p className="text-sm text-stone-500">Import a statement to start reconciling.</p>
          )}
        </Card>
      </div>

      <nav className="mb-3 flex gap-1 text-sm">
        {(["unmatched", "matched", "all"] as const).map((f) => (
          <Link key={f} href={`?show=${f}`} className={`rounded-md px-3 py-1.5 capitalize ${show === f ? "bg-brand-50 font-medium text-brand-700" : "text-stone-600 hover:bg-stone-100"}`}>
            {f === "unmatched" ? "To reconcile" : f}
          </Link>
        ))}
      </nav>
      <Table
        head={
          <tr>
            <Th>Date</Th>
            <Th>Narration</Th>
            <Th className="text-right">Out</Th>
            <Th className="text-right">In</Th>
            <Th>Match</Th>
          </tr>
        }
        empty={lines.length === 0 && <EmptyState>{show === "unmatched" ? "Nothing left to reconcile." : "No statement lines."}</EmptyState>}
      >
        {lines.map((l) => {
          const options = suggestions.get(l.id) ?? [];
          return (
            <tr key={l.id} className="align-top">
              <td className="whitespace-nowrap">{fmtDate(l.date)}</td>
              <td className="max-w-md">
                <div className="break-words">{l.description}</div>
                {l.reference && <div className="text-xs text-stone-500">Ref {l.reference}</div>}
              </td>
              <td className="text-right tabular-nums">{l.amount < 0 ? formatINR(-l.amount) : ""}</td>
              <td className="text-right tabular-nums">{l.amount > 0 ? formatINR(l.amount) : ""}</td>
              <td className="min-w-72">
                {l.matchedLineId ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="green">Matched</Badge>
                    <Link href={`/journal/${l.entryId}`} className="text-sm text-brand-700 hover:underline">
                      {l.entryNumber ?? l.entryNarration ?? "entry"}
                    </Link>
                    {canEdit && (
                      <ActionButton action={unmatchAction.bind(null, id, l.id)} variant="secondary">
                        Unmatch
                      </ActionButton>
                    )}
                  </div>
                ) : canEdit ? (
                  <div className="space-y-1.5">
                    {options.map((o) => (
                      <div key={o.lineId} className="flex items-center gap-2 text-sm">
                        <ActionButton action={matchAction.bind(null, id, l.id, o.lineId)} variant="primary">
                          Match
                        </ActionButton>
                        <span className="text-stone-600">
                          {fmtDate(o.date)} · {o.text || "entry"}
                        </span>
                      </div>
                    ))}
                    {options.length === 0 && <div className="text-xs text-stone-500">No entry in the books with this amount nearby.</div>}
                    <BookForm journalId={id} lineId={l.id} accounts={bookable} />
                    {l.amount > 0 ? (
                      <Link href="/payments/new?direction=received" className="mr-3 text-xs text-brand-700 hover:underline">
                        Record a customer receipt
                      </Link>
                    ) : (
                      <Link href="/payments/new?direction=paid" className="mr-3 text-xs text-brand-700 hover:underline">
                        Record a vendor payment
                      </Link>
                    )}
                    <ActionButton action={deleteLineAction.bind(null, id, l.id)} variant="secondary" confirm="Delete this statement line? Use this only for lines imported by mistake.">
                      Delete line
                    </ActionButton>
                  </div>
                ) : null}
              </td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-stone-500">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
