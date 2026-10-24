import { formatINR, profitAndLoss } from "@tevah/core";
import { Card, PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { withOrg } from "@/db";
import { requireSession } from "@/lib/auth";
import { getOrg } from "@/lib/org";
import { accountTotals } from "@/lib/reports";
import { fmtDate, PeriodPicker, readPeriod, type PeriodParams } from "../period";
import { StatementSection } from "../statement";

export const metadata = { title: "Profit and loss" };

export default async function ProfitAndLossPage({ searchParams }: { searchParams: PeriodParams }) {
  const session = await requireSession();
  const org = await getOrg(session.orgId);
  const period = readPeriod(await searchParams, org.fyStartMonth);
  const pl = profitAndLoss(await withOrg(session.orgId, (s) => accountTotals(s, period)));
  const q = `from=${period.from}&to=${period.to}`;
  return (
    <>
      <PageHeader
        title="Profit and loss"
        subtitle={`${org.legalName} · ${fmtDate(period.from)} to ${fmtDate(period.to)}`}
        actions={<PrintButton />}
      />
      <PeriodPicker {...period} fyStartMonth={org.fyStartMonth} />
      <Card className="max-w-3xl">
        <StatementSection title="Income" lines={pl.income} total={pl.totalIncome} totalLabel="Total income" ledgerQuery={q} />
        <StatementSection title="Expenses" lines={pl.expenses} total={pl.totalExpenses} totalLabel="Total expenses" ledgerQuery={q} />
        <div className="flex justify-between border-t-2 border-stone-800 pt-3 text-base font-semibold">
          <span>{pl.netProfit >= 0 ? "Net profit" : "Net loss"}</span>
          <span className={`tabular-nums ${pl.netProfit < 0 ? "text-red-700" : ""}`}>{formatINR(Math.abs(pl.netProfit), { symbol: true })}</span>
        </div>
        <p className="mt-2 text-xs text-stone-500">Before income tax. Figures exclude GST, which is held in the GST accounts.</p>
      </Card>
    </>
  );
}
