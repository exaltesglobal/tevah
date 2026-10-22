import { formatDuration } from "@tevah/core";
import Link from "next/link";
import { Badge, ButtonLink, EmptyState, PageHeader, Table, Th } from "@/components/ui";
import { withOrg } from "@/db";
import { requireSession } from "@/lib/auth";
import { listProjects } from "@/lib/projects";
import { fmtDate, today } from "../reports/period";
import { PROJECT_STATUS } from "./status";

export const metadata = { title: "Projects" };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const session = await requireSession();
  const archived = (await searchParams).archived === "1";
  const rows = await withOrg(session.orgId, (s) => listProjects(s, { archived, today: today() }));
  return (
    <>
      <PageHeader
        title={archived ? "Archived projects" : "Projects"}
        actions={
          <>
            <ButtonLink href="/tasks" variant="secondary">
              My tasks
            </ButtonLink>
            <ButtonLink href="/timesheet" variant="secondary">
              Timesheet
            </ButtonLink>
            {session.role !== "viewer" && <ButtonLink href="/projects/new">New project</ButtonLink>}
          </>
        }
      />
      <Table
        head={
          <tr>
            <Th>Project</Th>
            <Th>Customer</Th>
            <Th>Status</Th>
            <Th className="text-right">Open tasks</Th>
            <Th className="text-right">Overdue</Th>
            <Th className="text-right">Done</Th>
            <Th className="text-right">Time logged</Th>
            <Th>Due</Th>
          </tr>
        }
        empty={!rows.length && <EmptyState>{archived ? "No archived projects." : "No projects yet. Create one to start tracking tasks and time."}</EmptyState>}
      >
        {rows.map((p) => (
          <tr key={p.id} className="hover:bg-stone-50">
            <td>
              <Link href={`/projects/${p.id}`} className="font-medium text-brand-700 hover:underline">
                {p.name}
              </Link>
            </td>
            <td className="text-stone-600">{p.customer ?? "Internal"}</td>
            <td>
              <Badge tone={PROJECT_STATUS[p.status].tone}>{PROJECT_STATUS[p.status].label}</Badge>
            </td>
            <td className="text-right tabular-nums">{p.open}</td>
            <td className={`text-right tabular-nums ${p.overdue ? "font-medium text-red-700" : "text-stone-400"}`}>{p.overdue}</td>
            <td className="text-right tabular-nums text-stone-500">{p.done}</td>
            <td className="text-right tabular-nums">{p.minutes ? formatDuration(p.minutes) : "—"}</td>
            <td className="text-stone-600">{p.dueDate ? fmtDate(p.dueDate) : ""}</td>
          </tr>
        ))}
      </Table>
      <p className="mt-4 text-sm">
        <Link href={archived ? "/projects" : "/projects?archived=1"} className="text-brand-700 hover:underline">
          {archived ? "Back to projects" : "Show archived projects"}
        </Link>
      </p>
    </>
  );
}
