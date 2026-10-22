import { formatDuration } from "@tevah/core";
import Link from "next/link";
import { ActionButton } from "@/components/action-button";
import { Badge, EmptyState, Table, Th } from "@/components/ui";
import type { timeEntriesFor } from "@/lib/projects";
import { fmtDate } from "../reports/period";
import { deleteTimeAction } from "./actions";

export function TimeTable({
  rows,
  projectId,
  sessionUserId,
  isAdmin,
  canEdit,
  showProject = false,
}: {
  rows: Awaited<ReturnType<typeof timeEntriesFor>>;
  projectId?: string;
  sessionUserId: string;
  isAdmin: boolean;
  canEdit: boolean;
  showProject?: boolean;
}) {
  return (
    <Table
      head={
        <tr>
          <Th>Date</Th>
          <Th>Person</Th>
          {showProject && <Th>Project</Th>}
          <Th>Task</Th>
          <Th>Note</Th>
          <Th className="text-right">Time</Th>
          <Th />
        </tr>
      }
      empty={!rows.length && <EmptyState>No time logged yet.</EmptyState>}
    >
      {rows.map((t) => (
        <tr key={t.id}>
          <td className="whitespace-nowrap">{fmtDate(t.date)}</td>
          <td>{t.user}</td>
          {showProject && (
            <td>
              <Link href={`/projects/${t.projectId}?view=time`} className="text-brand-700 hover:underline">
                {t.project}
              </Link>
            </td>
          )}
          <td>
            {t.taskId ? (
              <Link href={`/tasks/${t.taskId}`} className="text-brand-700 hover:underline">
                {t.task}
              </Link>
            ) : (
              <span className="text-stone-400">—</span>
            )}
          </td>
          <td className="text-stone-600">
            {t.note}
            {!t.billable && (
              <>
                {" "}
                <Badge>Non-billable</Badge>
              </>
            )}
          </td>
          <td className="text-right tabular-nums">{formatDuration(t.minutes)}</td>
          <td className="text-right">
            {canEdit && (t.userId === sessionUserId || isAdmin) && (
              <ActionButton action={deleteTimeAction.bind(null, projectId ?? t.projectId, t.taskId, t.id)} confirm="Remove this time entry?">
                Remove
              </ActionButton>
            )}
          </td>
        </tr>
      ))}
    </Table>
  );
}
