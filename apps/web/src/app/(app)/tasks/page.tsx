import { TASK_STATUS_LABEL } from "@tevah/core";
import Link from "next/link";
import { Badge, EmptyState, PageHeader, Table, Th } from "@/components/ui";
import { withOrg } from "@/db";
import { requireSession } from "@/lib/auth";
import { openTasksFor } from "@/lib/projects";
import { fmtDate, today } from "../reports/period";

export const metadata = { title: "My tasks" };

export default async function MyTasksPage({ searchParams }: { searchParams: Promise<{ who?: string }> }) {
  const session = await requireSession();
  const unassigned = (await searchParams).who === "unassigned";
  const rows = await withOrg(session.orgId, (s) => openTasksFor(s, unassigned ? null : session.userId));
  const now = today();
  const tab = (who: string | null, label: string) => (
    <Link
      href={who ? `/tasks?who=${who}` : "/tasks"}
      className={`rounded-md px-3 py-1.5 text-sm font-medium ${unassigned === Boolean(who) ? "bg-brand-50 text-brand-700" : "text-stone-600 hover:bg-stone-100"}`}
    >
      {label}
    </Link>
  );
  return (
    <>
      <PageHeader title={unassigned ? "Unassigned tasks" : "My tasks"} subtitle="Open tasks across active projects, soonest due first." />
      <nav className="mb-4 flex gap-1">
        {tab(null, "Assigned to me")}
        {tab("unassigned", "Unassigned")}
      </nav>
      <Table
        head={
          <tr>
            <Th>Task</Th>
            <Th>Project</Th>
            <Th>Status</Th>
            <Th>Due</Th>
          </tr>
        }
        empty={!rows.length && <EmptyState>Nothing open. Nice.</EmptyState>}
      >
        {rows.map((t) => {
          const overdue = t.dueDate && t.dueDate < now;
          return (
            <tr key={t.id} className="hover:bg-stone-50">
              <td>
                <Link href={`/tasks/${t.id}`} className="font-medium text-brand-700 hover:underline">
                  {t.title}
                </Link>
                {t.priority > 0 && (
                  <>
                    {" "}
                    <Badge tone="brand">High</Badge>
                  </>
                )}
              </td>
              <td>
                <Link href={`/projects/${t.projectId}`} className="text-stone-700 hover:underline">
                  {t.project}
                </Link>
              </td>
              <td>{TASK_STATUS_LABEL[t.status]}</td>
              <td className={overdue ? "font-medium text-red-700" : "text-stone-600"}>{t.dueDate ? fmtDate(t.dueDate) : ""}</td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}
