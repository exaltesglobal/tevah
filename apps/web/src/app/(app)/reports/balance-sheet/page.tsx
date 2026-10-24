import { balanceSheet, formatINR } from "@tevah/core";
import { Card, PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { withOrg } from "@/db";
import { requireSession } from "@/lib/auth";
import { getOrg } from "@/lib/org";
import { accountTotals } from "@/lib/reports";
import { DatePicker, fmtDate, readDate, type PeriodParams } from "../period";
import { StatementSection } from "../statement";
import { Check } from "../status";

export const metadata = { title: "Balance sheet" };

export default async function BalanceSheetPage({ searchParams }: { searchParams: PeriodParams }) {
  const session = await requireSession();
  const org = await getOrg(session.orgId);
  const asOf = readDate((await searchParams).to);
  const bs = balanceSheet(await withOrg(session.orgId, (s) => accountTotals(s, { to: asOf })));
  const q = `to=${asOf}`;
  const profitRow = (
    <tr>
      <td />
      <td className="py-1.5">Profit and loss to date</td>
      <td className="py-1.5 text-right tabular-nums">{formatINR(bs.profitToDate)}</td>
    </tr>
  );
  const equityTotal = bs.equity.reduce((n, l) => n + l.amount, 0) + bs.profitToDate;
  return (
    <>
      <PageHeader title="Balance sheet" subtitle={`${org.legalName} · as of ${fmtDate(asOf)}`} actions={<PrintButton />} />
      <DatePicker name="to" value={asOf} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <StatementSection title="Assets" lines={bs.assets} total={bs.totalAssets} totalLabel="Total assets" ledgerQuery={q} />
        </Card>
        <Card>
          <StatementSection
            title="Liabilities"
            lines={bs.liabilities}
            total={bs.liabilities.reduce((n, l) => n + l.amount, 0)}
            totalLabel="Total liabilities"
            ledgerQuery={q}
          />
          <StatementSection title="Equity" lines={bs.equity} total={equityTotal} totalLabel="Total equity" ledgerQuery={q} extra={profitRow} />
          <div className="flex justify-between border-t-2 border-stone-800 pt-3 font-semibold">
            <span>Total liabilities and equity</span>
            <span className="tabular-nums">{formatINR(bs.totalLiabilitiesAndEquity)}</span>
          </div>
        </Card>
      </div>
      <Check ok={bs.balanced}>
        {bs.balanced
          ? "Assets equal liabilities plus equity."
          : `Out by ${formatINR(Math.abs(bs.totalAssets - bs.totalLiabilitiesAndEquity), { symbol: true })}.`}
      </Check>
    </>
  );
}
