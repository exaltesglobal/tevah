import { formatINR, trialBalance } from "@tevah/core";
import Link from "next/link";
import { PageHeader, Table, Th } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { withOrg } from "@/db";
import { requireSession } from "@/lib/auth";
import { getOrg } from "@/lib/org";
import { accountTotals } from "@/lib/reports";
import { DatePicker, fmtDate, readPeriod, type PeriodParams } from "../period";
import { Check } from "../status";

export const metadata = { title: "Trial balance" };

export default async function TrialBalancePage({ searchParams }: { searchParams: PeriodParams }) {
  const session = await requireSession();
  const org = await getOrg(session.orgId);
  const params = await searchParams;
  const { to } = readPeriod(params, org.fyStartMonth);
  // A trial balance is cumulative: everything posted up to the date.
  const tb = trialBalance(await withOrg(session.orgId, (s) => accountTotals(s, { to })));
  const amount = (n: number) => (n ? formatINR(n) : "");
  return (
    <>
      <PageHeader title="Trial balance" subtitle={`${org.legalName} · as of ${fmtDate(to)}`} actions={<PrintButton />} />
      <DatePicker name="to" value={to} />
      <Table
        head={
          <tr>
            <Th className="w-24">Code</Th>
            <Th>Account</Th>
            <Th className="text-right">Debit</Th>
            <Th className="text-right">Credit</Th>
          </tr>
        }
      >
        {tb.rows.map((r) => (
          <tr key={r.id}>
            <td className="font-mono text-xs">{r.code}</td>
            <td>
              <Link href={`/reports/general-ledger?account=${r.id}&to=${to}`} className="hover:text-brand-700 hover:underline">
                {r.name}
              </Link>
            </td>
            <td className="text-right tabular-nums">{amount(r.balanceDebit)}</td>
            <td className="text-right tabular-nums">{amount(r.balanceCredit)}</td>
          </tr>
        ))}
        <tr className="bg-stone-50 font-semibold">
          <td />
          <td>Total</td>
          <td className="text-right tabular-nums">{formatINR(tb.totalDebit)}</td>
          <td className="text-right tabular-nums">{formatINR(tb.totalCredit)}</td>
        </tr>
      </Table>
      <Check ok={tb.balanced}>
        {tb.balanced ? "Debits equal credits." : `Out by ${formatINR(Math.abs(tb.totalDebit - tb.totalCredit), { symbol: true })}. Every posting is balanced, so please report this.`}
      </Check>
    </>
  );
}
