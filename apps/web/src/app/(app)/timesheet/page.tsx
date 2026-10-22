import { formatDuration, monthRange } from "@tevah/core";
import Link from "next/link";
import { ButtonLink, EmptyState, PageHeader, Table, Th } from "@/components/ui";
import { withOrg } from "@/db";
import { requireSession } from "@/lib/auth";
import { members, timeEntriesFor, timesheet } from "@/lib/projects";
import { TimeTable } from "../projects/time-table";
import { fmtDate, PeriodPicker, readDate, today } from "../reports/period";

export const metadata = { title: "Timesheet" };

export default async function TimesheetPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; user?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const month = monthRange(today());
  const from = sp.from ? readDate(sp.from) : month.from;
  const to = sp.to ? readDate(sp.to) : month.to;
  const data = await withOrg(session.orgId, async (s) => {
    const people = await members(s);
    const userId = people.some((p) => p.id === sp.user) ? sp.user : undefined;
    const [summary, entries] = await Promise.all([timesheet(s, { from, to, userId }), timeEntriesFor(s, { from, to, userId })]);
    return { people, userId, summary, entries };
  });
  const { people, userId, summary, entries } = data;
  const total = summary.reduce((n, r) => n + r.minutes, 0);
  const billable = summary.reduce((n, r) => n + r.billable, 0);
  const exportHref = `/timesheet/export?${new URLSearchParams({ from, to, ...(userId ? { user: userId } : {}) })}`;

  return (
    <>
      <PageHeader
        title="Timesheet"
        subtitle={`${fmtDate(from)} to ${fmtDate(to)}`}
        actions={
          <ButtonLink href={exportHref} variant="secondary" prefetch={false}>
            Download CSV
          </ButtonLink>
        }
      />
      <PeriodPicker from={from} to={to} keep={{ user: userId }} />
      {people.length > 1 && (
        <nav className="-mt-2 mb-5 flex flex-wrap gap-1 text-sm">
          {[{ id: "", name: "Everyone" }, ...people].map((p) => (
            <Link
              key={p.id}
              href={`/timesheet?${new URLSearchParams({ from, to, ...(p.id ? { user: p.id } : {}) })}`}
              className={`rounded-md px-2 py-1 ${(userId ?? "") === p.id ? "bg-brand-50 font-medium text-brand-700" : "text-stone-600 hover:bg-stone-100"}`}
            >
              {p.name}
            </Link>
          ))}
        </nav>
      )}
      <div className="space-y-6">
        <Table
          head={
            <tr>
              <Th>Project</Th>
              <Th>Person</Th>
              <Th className="text-right">Billable</Th>
              <Th className="text-right">Total</Th>
            </tr>
          }
          empty={!summary.length && <EmptyState>No time logged in this period.</EmptyState>}
        >
          {summary.map((r) => (
            <tr key={`${r.projectId}${r.userId}`}>
              <td>
                <Link href={`/projects/${r.projectId}?view=time`} className="text-brand-700 hover:underline">
                  {r.project}
                </Link>
              </td>
              <td>{r.user}</td>
              <td className="text-right tabular-nums">{formatDuration(r.billable)}</td>
              <td className="text-right tabular-nums">{formatDuration(r.minutes)}</td>
            </tr>
          ))}
          {summary.length > 0 && (
            <tr className="font-semibold">
              <td colSpan={2}>Total</td>
              <td className="text-right tabular-nums">{formatDuration(billable)}</td>
              <td className="text-right tabular-nums">{formatDuration(total)}</td>
            </tr>
          )}
        </Table>
        {entries.length > 0 && (
          <>
            <h2 className="font-semibold">Entries</h2>
            <TimeTable rows={entries} sessionUserId={session.userId} isAdmin={session.role === "admin"} canEdit={session.role !== "viewer"} showProject />
          </>
        )}
      </div>
    </>
  );
}
