"use client";

import { BOARD_COLUMNS, formatDuration, TASK_STATUS_LABEL, type TaskStatus } from "@tevah/core";
import Link from "next/link";
import { useOptimistic, useState, useTransition, type DragEvent } from "react";
import { moveTaskAction } from "../actions";
import { QuickAdd } from "../forms";

export interface BoardTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: number;
  dueDate: string | null;
  assignee: string | null;
  minutes: number;
  estimateMinutes: number | null;
}

const fmt = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y!.slice(2)}`;
};

/**
 * Kanban board. Drag a card to another column or position; the move is
 * shown at once and saved in the background. Cards can also be moved from
 * the task page, so the board works without drag and drop.
 */
export function Board({ projectId, tasks, today, canEdit }: { projectId: string; tasks: BoardTask[]; today: string; canEdit: boolean }) {
  const [optimistic, move] = useOptimistic(tasks, (state, m: { id: string; status: TaskStatus; index: number }) => {
    const card = state.find((t) => t.id === m.id);
    if (!card) return state;
    const rest = state.filter((t) => t.id !== m.id);
    const column = rest.filter((t) => t.status === m.status);
    const before = column[m.index];
    const moved = { ...card, status: m.status };
    if (!before) return [...rest, moved];
    const at = rest.indexOf(before);
    return [...rest.slice(0, at), moved, ...rest.slice(at)];
  });
  const [, startTransition] = useTransition();
  const [dragging, setDragging] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Drop before the card `beforeId`, or at the end of the column. */
  const drop = (status: TaskStatus, beforeId: string | null) => (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const id = e.dataTransfer.getData("text/plain");
    setDragging(null);
    if (!id || id === beforeId) return;
    const column = optimistic.filter((t) => t.status === status && t.id !== id);
    const index = beforeId ? Math.max(0, column.findIndex((t) => t.id === beforeId)) : column.length;
    startTransition(async () => {
      move({ id, status, index });
      const r = await moveTaskAction(projectId, id, status, index);
      setError(r.error ?? null);
    });
  };

  return (
    <div>
      {error && <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {BOARD_COLUMNS.map((status) => {
          const cards = optimistic.filter((t) => t.status === status);
          return (
            <section
              key={status}
              aria-label={TASK_STATUS_LABEL[status]}
              className="flex min-h-40 flex-col rounded-lg border border-stone-200 bg-stone-50 p-3"
              onDragOver={canEdit ? (e) => e.preventDefault() : undefined}
              onDrop={canEdit ? drop(status, null) : undefined}
            >
              <h2 className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-stone-500">
                {TASK_STATUS_LABEL[status]}
                <span className="rounded bg-white px-1.5 py-0.5 text-stone-500">{cards.length}</span>
              </h2>
              <ul className="space-y-2">
                {cards.map((t) => {
                  const overdue = t.dueDate && t.dueDate < today && status !== "done";
                  return (
                    <li
                      key={t.id}
                      draggable={canEdit}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", t.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDragging(t.id);
                      }}
                      onDragEnd={() => setDragging(null)}
                      onDragOver={canEdit ? (e) => e.preventDefault() : undefined}
                      onDrop={canEdit ? drop(status, t.id) : undefined}
                      className={`rounded-md border bg-white p-3 text-sm shadow-xs ${dragging === t.id ? "opacity-40" : ""} ${t.priority ? "border-l-4 border-l-brand-600 border-stone-200" : "border-stone-200"} ${canEdit ? "cursor-grab active:cursor-grabbing" : ""}`}
                    >
                      <Link href={`/tasks/${t.id}`} className={`block font-medium hover:underline ${status === "done" ? "text-stone-500 line-through" : "text-stone-900"}`}>
                        {t.title}
                      </Link>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
                        {t.assignee && <span>{t.assignee}</span>}
                        {t.dueDate && <span className={overdue ? "font-medium text-red-700" : ""}>Due {fmt(t.dueDate)}</span>}
                        {(t.minutes > 0 || t.estimateMinutes) && (
                          <span>
                            {formatDuration(t.minutes)}
                            {t.estimateMinutes ? ` / ${formatDuration(t.estimateMinutes)}` : ""}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {canEdit && <QuickAdd projectId={projectId} status={status} />}
            </section>
          );
        })}
      </div>
    </div>
  );
}
