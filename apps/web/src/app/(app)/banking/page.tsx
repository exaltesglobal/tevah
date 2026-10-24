import { formatINR } from "@tevah/core";
import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader, Table, Th } from "@/components/ui";
import { withOrg } from "@/db";
import { requireSession } from "@/lib/auth";
import { moneyAccounts } from "@/lib/banking";
import { fmtDate } from "../reports/period";
import { AddAccountForm } from "./forms";

export const metadata = { title: "Banking" };

export default async function BankingPage() {
  const session = await requireSession();
  const rows = await withOrg(session.orgId, (s) => moneyAccounts(s));
  return (
    <>
      <PageHeader title="Banking" subtitle="Bank and cash accounts, statement import and reconciliation" />
      <Table
        head={
          <tr>
            <Th>Account</Th>
            <Th>Type</Th>
            <Th className="text-right">Balance in books</Th>
            <Th>Statement up to</Th>
            <Th>To reconcile</Th>
          </tr>
        }
        empty={rows.length === 0 && <EmptyState>No bank accounts yet.</EmptyState>}
      >
        {rows.map((r) => (
          <tr key={r.journalId} className="hover:bg-stone-50">
            <td>
              <Link href={`/banking/${r.journalId}`} className="font-medium text-brand-700 hover:underline">
                {r.name}
              </Link>
              <span className="ml-2 font-mono text-xs text-stone-500">{r.accountCode}</span>
            </td>
            <td className="capitalize">{r.type}</td>
            <td className={`text-right tabular-nums ${r.balance < 0 ? "text-red-700" : ""}`}>{formatINR(r.balance, { symbol: true })}</td>
            <td>{r.lastStatementDate ? fmtDate(r.lastStatementDate) : <span className="text-stone-500">Not imported</span>}</td>
            <td>{r.statementLines === 0 ? "" : r.unmatched ? <Badge tone="amber">{r.unmatched} lines</Badge> : <Badge tone="green">Reconciled</Badge>}</td>
          </tr>
        ))}
      </Table>
      {session.role !== "viewer" && (
        <Card className="mt-6">
          <h2 className="mb-3 font-semibold">Add a bank or cash account</h2>
          <AddAccountForm />
        </Card>
      )}
    </>
  );
}
