import { ACCOUNT_TYPES, formatINR, naturalBalance, type AccountType } from "@tevah/core";
import { asc, eq, sql } from "drizzle-orm";
import { Badge, PageHeader, Table, Th } from "@/components/ui";
import { withOrg } from "@/db";
import { accounts, journalEntries, journalLines } from "@/db/schema";
import { requireSession } from "@/lib/auth";

export const metadata = { title: "Chart of accounts" };

const TYPE_LABEL: Record<AccountType, string> = {
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
  income: "Income",
  expense: "Expenses",
};

export default async function AccountsPage() {
  const session = await requireSession();
  const rows = await withOrg(session.orgId, (s) => {
    const posted = sql`${journalEntries.id} is not null`;
    return s.tx
      .select({
        id: accounts.id,
        code: accounts.code,
        name: accounts.name,
        type: accounts.type,
        systemTag: accounts.systemTag,
        debit: sql<number>`coalesce(sum(case when ${posted} then ${journalLines.debit} end), 0)`.mapWith(Number),
        credit: sql<number>`coalesce(sum(case when ${posted} then ${journalLines.credit} end), 0)`.mapWith(Number),
      })
      .from(accounts)
      .leftJoin(journalLines, s.own(journalLines, eq(journalLines.accountId, accounts.id)))
      .leftJoin(
        journalEntries,
        s.own(journalEntries, eq(journalEntries.id, journalLines.entryId), eq(journalEntries.status, "posted")),
      )
      .where(s.own(accounts, eq(accounts.archived, false)))
      .groupBy(accounts.id)
      .orderBy(asc(accounts.code));
  });

  return (
    <>
      <PageHeader title="Chart of accounts" subtitle="Balances include posted entries only" />
      <div className="space-y-8">
        {ACCOUNT_TYPES.map((type) => {
          const group = rows.filter((r) => r.type === type);
          return (
            <section key={type}>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">{TYPE_LABEL[type]}</h2>
              <Table
                head={
                  <tr>
                    <Th className="w-24">Code</Th>
                    <Th>Name</Th>
                    <Th className="text-right">Balance</Th>
                  </tr>
                }
              >
                {group.map((a) => (
                  <tr key={a.id}>
                    <td className="font-mono text-xs">{a.code}</td>
                    <td>
                      {a.name} {a.systemTag && <Badge>system</Badge>}
                    </td>
                    <td className="text-right tabular-nums">{formatINR(naturalBalance(a.type, a.debit, a.credit))}</td>
                  </tr>
                ))}
              </Table>
            </section>
          );
        })}
      </div>
    </>
  );
}
