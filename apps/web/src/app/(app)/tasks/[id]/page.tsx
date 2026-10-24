import { formatDuration } from "@tevah/core";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/action-button";
import { Card, PageHeader } from "@/components/ui";
import { withOrg } from "@/db";
import { requireSession } from "@/lib/auth";
import { isUuid } from "@/lib/doc-kinds";
import { getTask, members, timeEntriesFor } from "@/lib/projects";
import { deleteTaskAction } from "../../projects/actions";
import { TaskForm, TimeForm } from "../../projects/forms";
import { TimeTable } from "../../projects/time-table";
import { today } from "../../reports/period";

export const metadata = { title: "Task" };

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await withOrg(session.orgId, async (s) => {
    const row = await getTask(s, id);
    if (!row) return null;
    const [people, time] = await Promise.all([members(s), timeEntriesFor(s, { taskId: id })]);
    return { ...row, people, time };
  });
  if (!data) notFound();
  const { task, project, people, time } = data;
  const canEdit = session.role !== "viewer";
  const logged = time.reduce((n, t) => n + t.minutes, 0);

  return (
    <>
      <PageHeader
        title={task.title}
        subtitle={
          <>
            <Link href={`/projects/${task.projectId}`} className="text-brand-700 hover:underline">
              {project}
            </Link>
            {" · "}
            {formatDuration(logged)} logged
            {task.estimateMinutes ? ` of ${formatDuration(task.estimateMinutes)} estimated` : ""}
          </>
        }
        actions={
          canEdit &&
          !time.length && (
            <ActionButton action={deleteTaskAction.bind(null, task.projectId, id)} variant="danger" confirm="Delete this task? This can't be undone.">
              Delete task
            </ActionButton>
          )
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          {canEdit ? (
            <TaskForm projectId={task.projectId} task={task} people={people.map((p) => ({ id: p.id, name: p.name }))} />
          ) : (
            <p className="whitespace-pre-line text-sm text-stone-700">{task.description || "No description."}</p>
          )}
        </Card>
        <div className="space-y-4">
          {canEdit && (
            <Card>
              <h2 className="mb-3 font-semibold">Log time on this task</h2>
              <TimeForm projectId={task.projectId} taskId={id} today={today()} />
            </Card>
          )}
          <TimeTable rows={time} projectId={task.projectId} sessionUserId={session.userId} isAdmin={session.role === "admin"} canEdit={canEdit} />
        </div>
      </div>
    </>
  );
}
