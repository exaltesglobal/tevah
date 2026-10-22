import { ageing, AGEING_BUCKETS, formatINR } from "@tevah/core";
import Link from "next/link";
import { EmptyState, PageHeader, Table, Th } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { withOrg } from "@/db";
import { requireSession } from "@/lib/auth";
import { getOrg } from "@/lib/org";
import { accountByTag, balanceOf, openItems, unappliedNotes } from "@/lib/reports";
import { DatePicker, fmtDate, readDate } from "../period";
import { Check } from "../status";

export const metadata = { title: "Ageing" };

const LABEL = { current: "Not due", "1-30": "1–30 days", "31-60": "31–60 days", "61-90": "61–90 days", "90+": "Over 90 days" };

export default async function AgeingPage({ searchParams }: { searchParams: Promise<{ kind?: string; asOf?: string }> }) {
  const session = await requireSession();
  const org = await getOrg(session.orgId);
  const params = await searchParams;
  const kind = params.kind === "payable" ? "payable" : "receivable";
  const asOf = readDate(params.asOf);
  const { items, control, notes } = await withOrg(session.orgId, async (s) => {
    const account = await accountByTag(s, kind);
    const [items, balance, notes] = await Promise.all([openItems(s, kind, asOf), balanceOf(s, [account.id], asOf), unappliedNotes(s, kind, asOf)]);
    // Receivables are debit balances, payables credit balances.
    return { items, control: kind === "receivable" ? balance : -balance, notes };
  });
  const report = ageing(items, asOf);
  const tiesOut = report.total - notes === control;
  const side = kind === "receivable" ? "sales" : "purchases";

  return (
    <>
      <PageHeader
        title={kind === "receivable" ? "Receivables ageing" : "Payables ageing"}
        subtitle={`${org.legalName} · as of ${fmtDate(asOf)} · by due date`}
        actions={
          <>
            <Link href={`?kind=${kind === "receivable" ? "payable" : "receivable"}&asOf=${asOf}`} className="self-center text-sm text-brand-700 hover:underline print:hidden">
              Switch to {kind === "receivable" ? "payables" : "receivables"}
            </Link>
            <PrintButton />
          </>
        }
      />
      <DatePicker value={asOf} keep={{ kind }} />
      <Table
        head={
          <tr>
            <Th>{kind === "receivable" ? "Customer" : "Vendor"}</Th>
            {AGEING_BUCKETS.map((b) => (
              <Th key={b} className="text-right">
                {LABEL[b]}
              </Th>
            ))}
            <Th className="text-right">Total</Th>
          </tr>
        }
        empty={report.rows.length === 0 && <EmptyState>Nothing outstanding.</EmptyState>}
      >
        {report.rows.map((r) => (
          <tr key={r.contactId}>
            <td>
              <Link href={`/${side}?q=${encodeURIComponent(r.contactName)}&status=due`} className="text-brand-700 hover:underline">
                {r.contactName}
              </Link>
            </td>
            {AGEING_BUCKETS.map((b) => (
              <td key={b} className={`text-right tabular-nums ${b === "90+" && r.buckets[b] ? "text-red-700" : ""}`}>
                {r.buckets[b] ? formatINR(r.buckets[b]) : ""}
              </td>
            ))}
            <td className="text-right font-medium tabular-nums">{formatINR(r.total)}</td>
          </tr>
        ))}
        {report.rows.length > 0 && (
          <tr className="bg-stone-50 font-semibold">
            <td>Total</td>
            {AGEING_BUCKETS.map((b) => (
              <td key={b} className="text-right tabular-nums">
                {formatINR(report.totals[b])}
              </td>
            ))}
            <td className="text-right tabular-nums">{formatINR(report.total)}</td>
          </tr>
        )}
      </Table>
      {notes > 0 && (
        <p className="mt-2 text-sm text-stone-600">
          Unapplied {kind === "receivable" ? "credit" : "debit"} notes: {formatINR(notes, { symbol: true })}
        </p>
      )}
      <Check ok={tiesOut}>
        {tiesOut
          ? `Matches the ${kind === "receivable" ? "Trade Receivables" : "Trade Payables"} balance in the ledger (${formatINR(control, { symbol: true })}).`
          : `The ledger's ${kind} balance is ${formatINR(control, { symbol: true })}, which differs by ${formatINR(Math.abs(report.total - notes - control), { symbol: true })}. Check manual journal entries on that account.`}
      </Check>
    </>
  );
}
