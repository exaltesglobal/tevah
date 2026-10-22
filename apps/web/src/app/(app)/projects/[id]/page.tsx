import { formatDuration, TASK_STATUS_LABEL } from "@tevah/core";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, Table, Th } from "@/components/ui";
import { withOrg } from "@/db";
import { requireSession } from "@/lib/auth";
import { isUuid } from "@/lib/doc-kinds";
import { boardTasks, cancelledTasks, getProject, timeEntriesFor } from "@/lib/projects";
import { fmtDate, today } from "../../reports/period";
import { TimeForm } from "../forms";
import { TimeTable } from "../time-table";
import { PROJECT_STATUS } from "../status";
import { Board } from "./board";

export const metadata = { title: "Project" };

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ view?: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const view = (await searchParams).view === "time" ? "time" : "board";
  const data = await withOrg(session.orgId, async (s) => {
    const row = await getProject(s, id);
    if (!row) return null;
    const [tasks, cancelled, time] = await Promise.all([boardTasks(s, id), cancelledTasks(s, id), view === "time" ? timeEntriesFor(s, { projectId: id }) : []]);
    return { ...row, tasks, cancelled, time };
  });
  if (!data) notFound();
  const { project, customer, tasks, cancelled, time } = data;
  const canEdit = session.role !== "viewer";
  const logged = time.reduce((n, t) => n + t.minutes, 0);
  const tab = (v: string, label: string) => (
    <Link
      href={v === "board" ? `/projects/${id}` : `/projects/${id}?view=${v}`}
      className={`rounded-md px-3 py-1.5 text-sm font-medium ${view === v ? "bg-brand-50 text-brand-700" : "text-stone-600 hover:bg-stone-100"}`}
    >
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        title={project.name}
        subtitle={
          <>
            <Link href="/projects" className="text-brand-700 hover:underline">
              Projects
            </Link>
            {" · "}
            {customer ?? "Internal"}
            {project.dueDate && ` · due ${fmtDate(project.dueDate)}`}
            {" · "}
            <Badge tone={PROJECT_STATUS[project.status].tone}>{PROJECT_STATUS[project.status].label}</Badge>
            {project.archived && (
              <>
                {" "}
                <Badge>Archived</Badge>
              </>
            )}
          </>
        }
        actions={
          canEdit && (
            <ButtonLink href={`/projects/${id}/edit`} variant="secondary">
              Edit project
            </ButtonLink>
          )
        }
      />
      {project.description && <p className="-mt-3 mb-5 max-w-3xl whitespace-pre-line text-sm text-stone-600">{project.description}</p>}
      <nav className="mb-4 flex gap-1">
        {tab("board", "Board")}
        {tab("time", "Time")}
      </nav>

      {view === "board" ? (
        <>
          <Board projectId={id} today={today()} canEdit={canEdit} tasks={tasks} />
          {cancelled.length > 0 && (
            <details className="mt-6 text-sm">
              <summary className="cursor-pointer text-stone-500">{cancelled.length} cancelled</summary>
              <ul className="mt-2 space-y-1">
                {cancelled.map((t) => (
                  <li key={t.id}>
                    <Link href={`/tasks/${t.id}`} className="text-stone-600 line-through hover:underline">
                      {t.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      ) : (
        <div className="space-y-6">
          {canEdit && (
            <Card>
              <h2 className="mb-3 font-semibold">Log time</h2>
              <TimeForm
                projectId={id}
                today={today()}
                taskOptions={tasks.filter((t) => t.status !== "done").map((t) => ({ id: t.id, name: `${t.title} (${TASK_STATUS_LABEL[t.status]})` }))}
              />
            </Card>
          )}
          <TimeTable rows={time} projectId={id} sessionUserId={session.userId} isAdmin={session.role === "admin"} canEdit={canEdit} />
          {time.length > 0 && <p className="text-sm text-stone-600">Total {formatDuration(logged)} across {time.length} entries.</p>}
        </div>
      )}
    </>
  );
}
