import { formatINR } from "@tevah/core";
import { EmptyState, PageHeader, Table, Th } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { withOrg } from "@/db";
import { requireSession } from "@/lib/auth";
import { getOrg } from "@/lib/org";
import { tdsByContact, type TdsRow } from "@/lib/reports";
import { fmtDate, PeriodPicker, readPeriod, type PeriodParams } from "../period";

export const metadata = { title: "TDS summary" };

export default async function TdsPage({ searchParams }: { searchParams: PeriodParams }) {
  const session = await requireSession();
  const org = await getOrg(session.orgId);
  const period = readPeriod(await searchParams, org.fyStartMonth);
  const { payable, receivable } = await withOrg(session.orgId, async (s) => ({
    payable: await tdsByContact(s, "tds_payable", period),
    receivable: await tdsByContact(s, "tds_receivable", period),
  }));
  return (
    <>
      <PageHeader title="TDS summary" subtitle={`${org.legalName} · TAN ${org.tan ?? "not set"} · ${fmtDate(period.from)} to ${fmtDate(period.to)}`} actions={<PrintButton />} />
      <PeriodPicker {...period} fyStartMonth={org.fyStartMonth} />
      <TdsTable
        title="TDS you deducted (payable to the government)"
        hint="Deducted on vendor bills. Deposit by the 7th of the next month and file in Form 26Q."
        rows={payable}
        who="Vendor"
      />
      <TdsTable
        title="TDS deducted by your customers (claimable)"
        hint="Recorded on customer receipts. Check it against Form 26AS before claiming."
        rows={receivable}
        who="Customer"
      />
    </>
  );
}

function TdsTable({ title, hint, rows, who }: { title: string; hint: string; rows: TdsRow[]; who: string }) {
  const total = rows.reduce((n, r) => n + r.amount, 0);
  return (
    <section className="mb-8">
      <h2 className="font-semibold">{title}</h2>
      <p className="mb-2 text-sm text-stone-500">{hint}</p>
      <Table
        head={
          <tr>
            <Th>{who}</Th>
            <Th>PAN</Th>
            <Th className="text-right">Entries</Th>
            <Th className="text-right">TDS</Th>
          </tr>
        }
        empty={rows.length === 0 && <EmptyState>None in this period.</EmptyState>}
      >
        {rows.map((r) => (
          <tr key={r.contactId ?? "none"}>
            <td>{r.contactName ?? "No contact"}</td>
            <td className="font-mono text-xs">{r.pan ?? <span className="text-amber-700">missing</span>}</td>
            <td className="text-right tabular-nums">{r.entries}</td>
            <td className="text-right tabular-nums">{formatINR(r.amount)}</td>
          </tr>
        ))}
        {rows.length > 0 && (
          <tr className="bg-stone-50 font-semibold">
            <td colSpan={3}>Total</td>
            <td className="text-right tabular-nums">{formatINR(total)}</td>
          </tr>
        )}
      </Table>
    </section>
  );
}
