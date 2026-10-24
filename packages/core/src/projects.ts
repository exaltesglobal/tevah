export const TASK_STATUSES = ["todo", "in_progress", "waiting", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  waiting: "Waiting",
  done: "Done",
  cancelled: "Cancelled",
};

/** Columns shown on the board; cancelled tasks stay off it. */
export const BOARD_COLUMNS: readonly TaskStatus[] = ["todo", "in_progress", "waiting", "done"];

/**
 * Read a duration typed by a person into whole minutes: "1:30", "1h 30m",
 * "1.5" or "1.5h" (hours), "90m", "45 min". Null when unreadable or zero.
 */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, " ");
  let m: RegExpExecArray | null;
  let minutes: number | null = null;
  if ((m = /^(\d{1,2}):([0-5]\d)$/.exec(s))) minutes = +m[1]! * 60 + +m[2]!;
  else if ((m = /^(\d+(?:\.\d+)?) ?h(?:rs?|ours?)?(?: ?(\d+) ?m(?:ins?|inutes?)?)?$/.exec(s))) minutes = Math.round(+m[1]! * 60) + (m[2] ? +m[2] : 0);
  else if ((m = /^(\d+) ?m(?:ins?|inutes?)?$/.exec(s))) minutes = +m[1]!;
  else if ((m = /^(\d+(?:\.\d+)?)$/.exec(s))) minutes = Math.round(+m[1]! * 60);
  if (minutes === null || minutes <= 0 || minutes > 24 * 60) return null;
  return minutes;
}

/** 90 → "1h 30m", 45 → "45m", 120 → "2h". */
export function formatDuration(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (!h) return `${sign}${m}m`;
  return m ? `${sign}${h}h ${m}m` : `${sign}${h}h`;
}

/** Hours with two decimals, for exports and invoices: 90 → 1.5. */
export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

/**
 * Positions for a column after moving `id` to index `to`. Positions are
 * rewritten as 1000, 2000, … so later inserts at the end stay cheap.
 */
export function reorder(ids: readonly string[], id: string, to: number): { id: string; position: number }[] {
  const rest = ids.filter((x) => x !== id);
  const at = Math.max(0, Math.min(to, rest.length));
  const next = [...rest.slice(0, at), id, ...rest.slice(at)];
  return next.map((x, i) => ({ id: x, position: (i + 1) * 1000 }));
}

/** Whether a task is overdue on a given day (open and due before it). */
export function isOverdue(task: { status: TaskStatus; dueDate: string | null }, today: string): boolean {
  return Boolean(task.dueDate) && task.dueDate! < today && task.status !== "done" && task.status !== "cancelled";
}
