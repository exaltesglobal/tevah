import { formatINR, runningBalances } from "@tevah/core";
import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { Button, EmptyState, Input, PageHeader, Select, Table, Th } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { withOrg } from "@/db";
import { accounts } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { isUuid } from "@/lib/doc-kinds";
import { entrySources } from "@/lib/journal";
import { getOrg } from "@/lib/org";
import { balanceOf, ledgerRows } from "@/lib/reports";
import { fmtDate, presets, readPeriod, type PeriodParams } from "../period";

export const metadata = { title: "General ledger" };

export default async function GeneralLedgerPage({ searchParams }: { searchParams: PeriodParams }) {
  const session = await requireSession();
  const org = await getOrg(session.orgId);
  const params = await searchParams;
  const period = readPeriod(params, org.fyStartMonth);
  const accountId = isUuid(params.account) ? params.account : undefined;

  const data = await withOrg(session.orgId, async (s) => {
    const list = await s.tx
      .select({ id: accounts.id, code: accounts.code, name: accounts.name, type: accounts.type })
      .from(accounts)
      .where(s.own(accounts))
      .orderBy(asc(accounts.code));
    const account = list.find((a) => a.id === accountId);
    if (!account) return { list };
    const [opening, rows] = await Promise.all([balanceOf(s, [account.id], period.from, true), ledgerRows(s, account.id, period)]);
    const sources = await entrySources(s, [...new Set(rows.map((r) => r.entryId))]);
    return { list, account, opening, rows, sources };
  });

  // Balances show on the account's natural side: debit for assets and expenses, credit otherwise.
  const flip = data.account && !(data.account.type === "asset" || data.account.type === "expense") ? -1 : 1;
  const running = data.rows ? runningBalances(data.opening!, data.rows) : [];
  const show = (n: number) => formatINR(flip * n);
  const closing = running.at(-1) ?? data.opening ?? 0;

  return (
    <>
      <PageHeader
        title="General ledger"
        subtitle={data.account ? `${data.account.code} ${data.account.name} · ${fmtDate(period.from)} to ${fmtDate(period.to)}` : "Choose an account"}
        actions={data.account && <PrintButton />}
      />
      <form className="mb-5 flex flex-wrap items-end gap-2 print:hidden">
        <label className="text-xs text-stone-500">
          Account
          <Select name="account" defaultValue={accountId ?? ""} className="mt-1 w-72!">
            <option value="">Choose…</option>
            {data.list.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} {a.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-xs text-stone-500">
          From
          <Input type="date" name="from" defaultValue={period.from} className="mt-1 w-auto!" />
        </label>
        <label className="text-xs text-stone-500">
          To
          <Input type="date" name="to" defaultValue={period.to} className="mt-1 w-auto!" />
        </label>
        <Button variant="secondary">Show</Button>
        <div className="flex gap-1 text-sm">
          {presets(org.fyStartMonth).map((p) => (
            <Link
              key={p.label}
              href={`?${new URLSearchParams({ ...(accountId ? { account: accountId } : {}), from: p.from, to: p.to })}`}
              className="rounded-md px-2 py-1 text-brand-700 hover:bg-brand-50"
            >
              {p.label}
            </Link>
          ))}
        </div>
      </form>
      {data.account && (
        <Table
          head={
            <tr>
              <Th>Date</Th>
              <Th>Entry</Th>
              <Th>Details</Th>
              <Th className="text-right">Debit</Th>
              <Th className="text-right">Credit</Th>
              <Th className="text-right">Balance</Th>
            </tr>
          }
          empty={data.rows!.length === 0 && <EmptyState>No entries in this period.</EmptyState>}
        >
          <tr className="bg-stone-50 text-stone-600">
            <td>{fmtDate(period.from)}</td>
            <td colSpan={4}>Opening balance</td>
            <td className="text-right tabular-nums">{show(data.opening!)}</td>
          </tr>
          {data.rows!.map((r, i) => {
            const source = data.sources!.get(r.entryId);
            return (
              <tr key={r.lineId}>
                <td className="whitespace-nowrap">{fmtDate(r.date)}</td>
                <td className="whitespace-nowrap">
                  <Link href={source?.href ?? `/journal/${r.entryId}`} className="text-brand-700 hover:underline">
                    {source?.label ?? r.number ?? r.journalCode}
                  </Link>
                </td>
                <td className="text-stone-600">{[r.contactName, r.description ?? r.narration].filter(Boolean).join(" · ")}</td>
                <td className="text-right tabular-nums">{r.debit ? formatINR(r.debit) : ""}</td>
                <td className="text-right tabular-nums">{r.credit ? formatINR(r.credit) : ""}</td>
                <td className="text-right tabular-nums">{show(running[i]!)}</td>
              </tr>
            );
          })}
          <tr className="bg-stone-50 font-semibold">
            <td>{fmtDate(period.to)}</td>
            <td colSpan={2}>Closing balance</td>
            <td className="text-right tabular-nums">{formatINR(data.rows!.reduce((n, r) => n + r.debit, 0))}</td>
            <td className="text-right tabular-nums">{formatINR(data.rows!.reduce((n, r) => n + r.credit, 0))}</td>
            <td className="text-right tabular-nums">{show(closing)}</td>
          </tr>
        </Table>
      )}
      {data.account && (
        <p className="mt-2 text-xs text-stone-500">
          Balances are shown on the account's natural side ({flip === 1 ? "debit" : "credit"} for {data.account.type} accounts).
        </p>
      )}
    </>
  );
}
