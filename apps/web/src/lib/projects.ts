import { randomUUID } from "node:crypto";
import { BOARD_COLUMNS, parseDuration, reorder, TASK_STATUSES, type TaskStatus } from "@tevah/core";
import { asc, desc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Scope } from "@/db";
import { contacts, memberships, projects, tasks, timeEntries, users } from "@/db/schema";
import { audit } from "./audit";
import type { Session } from "./auth";
import { UserError } from "./documents";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null);
const optionalId = z
  .string()
  .optional()
  .transform((v) => v || null)
  .pipe(z.uuid().nullable());
const optionalDate = z
  .string()
  .optional()
  .transform((v) => v || null)
  .pipe(z.iso.date("Enter a date").nullable());

export const projectInput = z
  .object({
    name: z.string().trim().min(2, "Name the project").max(200),
    contactId: optionalId,
    description: optionalText(5000),
    status: z.enum(["active", "on_hold", "done"]).default("active"),
    startDate: optionalDate,
    dueDate: optionalDate,
  })
  .refine((v) => !v.startDate || !v.dueDate || v.dueDate >= v.startDate, { path: ["dueDate"], message: "Due date is before the start" });
export type ProjectInput = z.output<typeof projectInput>;

const duration = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v?.trim()) return null;
    const minutes = parseDuration(v);
    if (minutes === null) {
      ctx.addIssue({ code: "custom", message: "Enter time like 1:30, 1.5 or 90m" });
      return z.NEVER;
    }
    return minutes;
  });

export const taskInput = z.object({
  title: z.string().trim().min(1, "Give the task a title").max(300),
  description: optionalText(20000),
  status: z.enum(TASK_STATUSES).default("todo"),
  priority: z.coerce.number().int().min(0).max(1).default(0),
  assigneeId: optionalId,
  dueDate: optionalDate,
  estimate: duration,
});
export type TaskInput = z.output<typeof taskInput>;

export const timeInput = z.object({
  date: z.iso.date("Enter a date"),
  duration: duration.refine((v) => v !== null, "Enter the time spent"),
  note: optionalText(500),
  taskId: optionalId,
  billable: z
    .string()
    .optional()
    .transform((v) => v === "on" || v === "true"),
});
export type TimeInput = z.output<typeof timeInput>;

async function assertContact(s: Scope, contactId: string | null) {
  if (!contactId) return;
  const [c] = await s.tx.select({ id: contacts.id }).from(contacts).where(s.own(contacts, eq(contacts.id, contactId)));
  if (!c) throw new UserError("Customer not found");
}

async function assertMember(s: Scope, userId: string | null) {
  if (!userId) return;
  const [m] = await s.tx.select({ id: memberships.userId }).from(memberships).where(s.own(memberships, eq(memberships.userId, userId)));
  if (!m) throw new UserError("That person isn't part of this company");
}

export async function saveProject(s: Scope, session: Session, id: string | null, input: ProjectInput): Promise<string> {
  await assertContact(s, input.contactId);
  if (id) {
    const [res] = await s.tx.update(projects).set(input).where(s.own(projects, eq(projects.id, id)));
    if (!res.affectedRows) throw new UserError("Project not found");
    await audit(s, session, "update", "project", id, input);
    return id;
  }
  const newId = randomUUID();
  await s.tx.insert(projects).values({ ...input, id: newId, orgId: s.orgId });
  await audit(s, session, "create", "project", newId, input);
  return newId;
}

export async function setProjectArchived(s: Scope, session: Session, id: string, archived: boolean): Promise<void> {
  const [res] = await s.tx.update(projects).set({ archived }).where(s.own(projects, eq(projects.id, id)));
  if (res.affectedRows) await audit(s, session, archived ? "archive" : "restore", "project", id);
}

export async function getProject(s: Scope, id: string) {
  const [row] = await s.tx
    .select({ project: projects, customer: contacts.name })
    .from(projects)
    .leftJoin(contacts, s.own(contacts, eq(contacts.id, projects.contactId)))
    .where(s.own(projects, eq(projects.id, id)));
  return row ?? null;
}

/** Projects with open and overdue task counts and the time logged on each. */
export async function listProjects(s: Scope, opts: { archived: boolean; today: string }) {
  const rows = await s.tx
    .select({
      id: projects.id,
      name: projects.name,
      status: projects.status,
      dueDate: projects.dueDate,
      customer: contacts.name,
    })
    .from(projects)
    .leftJoin(contacts, s.own(contacts, eq(contacts.id, projects.contactId)))
    .where(s.own(projects, eq(projects.archived, opts.archived)))
    .orderBy(asc(projects.status), asc(projects.name));
  const counts = await s.tx
    .select({
      projectId: tasks.projectId,
      open: sql<number>`coalesce(sum(${tasks.status} not in ('done', 'cancelled')), 0)`.mapWith(Number),
      done: sql<number>`coalesce(sum(${tasks.status} = 'done'), 0)`.mapWith(Number),
      overdue: sql<number>`coalesce(sum(${tasks.status} not in ('done', 'cancelled') and ${tasks.dueDate} < ${opts.today}), 0)`.mapWith(Number),
    })
    .from(tasks)
    .where(s.own(tasks))
    .groupBy(tasks.projectId);
  const time = await s.tx
    .select({ projectId: timeEntries.projectId, minutes: sql<number>`coalesce(sum(${timeEntries.minutes}), 0)`.mapWith(Number) })
    .from(timeEntries)
    .where(s.own(timeEntries))
    .groupBy(timeEntries.projectId);
  return rows.map((r) => {
    const c = counts.find((x) => x.projectId === r.id);
    return { ...r, open: c?.open ?? 0, done: c?.done ?? 0, overdue: c?.overdue ?? 0, minutes: time.find((t) => t.projectId === r.id)?.minutes ?? 0 };
  });
}

/** People in the company, for assigning tasks. */
export async function members(s: Scope) {
  return s.tx
    .select({ id: users.id, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(s.own(memberships))
    .orderBy(asc(users.name));
}

async function nextPosition(s: Scope, projectId: string, status: TaskStatus): Promise<number> {
  const [row] = await s.tx
    .select({ n: sql<number>`coalesce(max(${tasks.position}), 0)`.mapWith(Number) })
    .from(tasks)
    .where(s.own(tasks, eq(tasks.projectId, projectId), eq(tasks.status, status)));
  return (row?.n ?? 0) + 1000;
}

const doneAt = (status: TaskStatus, was: TaskStatus | null) => (status === "done" ? (was === "done" ? undefined : new Date()) : null);

export async function createTask(s: Scope, session: Session, projectId: string, input: TaskInput): Promise<string> {
  const project = await getProject(s, projectId);
  if (!project) throw new UserError("Project not found");
  await assertMember(s, input.assigneeId);
  const id = randomUUID();
  const { estimate, ...rest } = input;
  await s.tx.insert(tasks).values({
    ...rest,
    id,
    orgId: s.orgId,
    projectId,
    estimateMinutes: estimate,
    position: await nextPosition(s, projectId, input.status),
    completedAt: doneAt(input.status, null) ?? null,
    createdBy: session.userId,
  });
  await audit(s, session, "create", "task", id, { projectId, title: input.title });
  return id;
}

async function lockedTask(s: Scope, id: string) {
  const [task] = await s.tx.select().from(tasks).where(s.own(tasks, eq(tasks.id, id))).for("update");
  if (!task) throw new UserError("Task not found");
  return task;
}

export async function updateTask(s: Scope, session: Session, id: string, input: TaskInput): Promise<void> {
  const task = await lockedTask(s, id);
  await assertMember(s, input.assigneeId);
  const { estimate, ...rest } = input;
  const moved = task.status !== input.status;
  await s.tx
    .update(tasks)
    .set({
      ...rest,
      estimateMinutes: estimate,
      completedAt: doneAt(input.status, task.status),
      position: moved ? await nextPosition(s, task.projectId, input.status) : undefined,
    })
    .where(s.own(tasks, eq(tasks.id, id)));
  await audit(s, session, "update", "task", id, input);
}

/** Drop a task into a board column at an index, renumbering that column. */
export async function moveTask(s: Scope, session: Session, id: string, status: TaskStatus, index: number): Promise<void> {
  const task = await lockedTask(s, id);
  const column = await s.tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(s.own(tasks, eq(tasks.projectId, task.projectId), eq(tasks.status, status)))
    .orderBy(asc(tasks.position), asc(tasks.createdAt))
    .for("update");
  for (const p of reorder(
    column.map((c) => c.id),
    id,
    index,
  )) {
    await s.tx
      .update(tasks)
      .set(p.id === id ? { position: p.position, status, completedAt: doneAt(status, task.status) } : { position: p.position })
      .where(s.own(tasks, eq(tasks.id, p.id)));
  }
  if (task.status !== status) await audit(s, session, "update", "task", id, { status });
}

export async function deleteTask(s: Scope, session: Session, id: string): Promise<void> {
  await lockedTask(s, id);
  const [logged] = await s.tx.select({ id: timeEntries.id }).from(timeEntries).where(s.own(timeEntries, eq(timeEntries.taskId, id))).limit(1);
  if (logged) throw new UserError("Time is logged on this task. Cancel it instead, so the time stays on the project.");
  await s.tx.delete(tasks).where(s.own(tasks, eq(tasks.id, id)));
  await audit(s, session, "archive", "task", id, { deleted: true });
}

const taskColumns = {
  id: tasks.id,
  projectId: tasks.projectId,
  title: tasks.title,
  status: tasks.status,
  priority: tasks.priority,
  dueDate: tasks.dueDate,
  position: tasks.position,
  estimateMinutes: tasks.estimateMinutes,
  assigneeId: tasks.assigneeId,
  assignee: users.name,
};

async function loggedByTask(s: Scope, taskIds: string[]): Promise<Map<string, number>> {
  if (!taskIds.length) return new Map();
  const rows = await s.tx
    .select({ taskId: timeEntries.taskId, minutes: sql<number>`sum(${timeEntries.minutes})`.mapWith(Number) })
    .from(timeEntries)
    .where(s.own(timeEntries, inArray(timeEntries.taskId, taskIds)))
    .groupBy(timeEntries.taskId);
  return new Map(rows.map((r) => [r.taskId!, r.minutes]));
}

/** Tasks on a project's board, by column in board order. */
export async function boardTasks(s: Scope, projectId: string) {
  const rows = await s.tx
    .select(taskColumns)
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .where(s.own(tasks, eq(tasks.projectId, projectId), inArray(tasks.status, [...BOARD_COLUMNS])))
    .orderBy(asc(tasks.position), asc(tasks.createdAt));
  const logged = await loggedByTask(
    s,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({ ...r, minutes: logged.get(r.id) ?? 0 }));
}

export async function cancelledTasks(s: Scope, projectId: string) {
  return s.tx
    .select(taskColumns)
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .where(s.own(tasks, eq(tasks.projectId, projectId), eq(tasks.status, "cancelled")))
    .orderBy(desc(tasks.updatedAt));
}

/** Open tasks assigned to a person (or unassigned, with `null`), soonest due first. */
export async function openTasksFor(s: Scope, userId: string | null) {
  return s.tx
    .select({ ...taskColumns, project: projects.name })
    .from(tasks)
    .innerJoin(projects, s.own(projects, eq(projects.id, tasks.projectId), eq(projects.archived, false)))
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .where(s.own(tasks, userId ? eq(tasks.assigneeId, userId) : isNull(tasks.assigneeId), ne(tasks.status, "done"), ne(tasks.status, "cancelled")))
    .orderBy(sql`${tasks.dueDate} is null`, asc(tasks.dueDate), desc(tasks.priority), asc(projects.name));
}

export async function getTask(s: Scope, id: string) {
  const [row] = await s.tx
    .select({ task: tasks, project: projects.name, assignee: users.name })
    .from(tasks)
    .innerJoin(projects, s.own(projects, eq(projects.id, tasks.projectId)))
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .where(s.own(tasks, eq(tasks.id, id)));
  return row ?? null;
}

export async function logTime(s: Scope, session: Session, projectId: string, input: TimeInput): Promise<string> {
  const project = await getProject(s, projectId);
  if (!project) throw new UserError("Project not found");
  if (input.taskId) {
    const [t] = await s.tx.select({ id: tasks.id }).from(tasks).where(s.own(tasks, eq(tasks.id, input.taskId), eq(tasks.projectId, projectId)));
    if (!t) throw new UserError("That task isn't on this project");
  }
  const id = randomUUID();
  await s.tx.insert(timeEntries).values({
    id,
    orgId: s.orgId,
    projectId,
    taskId: input.taskId,
    userId: session.userId,
    date: input.date,
    minutes: input.duration!,
    note: input.note,
    billable: input.billable,
  });
  await audit(s, session, "create", "time_entry", id, { projectId, taskId: input.taskId, minutes: input.duration });
  return id;
}

/** People remove their own time; an admin can remove anyone's. */
export async function deleteTime(s: Scope, session: Session, id: string): Promise<void> {
  const [entry] = await s.tx.select().from(timeEntries).where(s.own(timeEntries, eq(timeEntries.id, id)));
  if (!entry) throw new UserError("Time entry not found");
  if (entry.userId !== session.userId && session.role !== "admin") throw new UserError("Only an admin can remove someone else's time");
  await s.tx.delete(timeEntries).where(s.own(timeEntries, eq(timeEntries.id, id)));
  await audit(s, session, "archive", "time_entry", id, { deleted: true, minutes: entry.minutes });
}

export interface TimeFilter {
  projectId?: string;
  taskId?: string;
  userId?: string;
  from?: string;
  to?: string;
}

export async function timeEntriesFor(s: Scope, f: TimeFilter) {
  return s.tx
    .select({
      id: timeEntries.id,
      date: timeEntries.date,
      minutes: timeEntries.minutes,
      note: timeEntries.note,
      billable: timeEntries.billable,
      userId: timeEntries.userId,
      user: users.name,
      projectId: timeEntries.projectId,
      project: projects.name,
      taskId: timeEntries.taskId,
      task: tasks.title,
    })
    .from(timeEntries)
    .innerJoin(users, eq(users.id, timeEntries.userId))
    .innerJoin(projects, s.own(projects, eq(projects.id, timeEntries.projectId)))
    .leftJoin(tasks, s.own(tasks, eq(tasks.id, timeEntries.taskId)))
    .where(
      s.own(
        timeEntries,
        f.projectId ? eq(timeEntries.projectId, f.projectId) : undefined,
        f.taskId ? eq(timeEntries.taskId, f.taskId) : undefined,
        f.userId ? eq(timeEntries.userId, f.userId) : undefined,
        f.from ? gte(timeEntries.date, f.from) : undefined,
        f.to ? lte(timeEntries.date, f.to) : undefined,
      ),
    )
    .orderBy(desc(timeEntries.date), desc(timeEntries.createdAt))
    .limit(1000);
}

/** Time per project and person over a period. */
export async function timesheet(s: Scope, f: { from: string; to: string; userId?: string }) {
  return s.tx
    .select({
      projectId: timeEntries.projectId,
      project: projects.name,
      userId: timeEntries.userId,
      user: users.name,
      minutes: sql<number>`sum(${timeEntries.minutes})`.mapWith(Number),
      billable: sql<number>`coalesce(sum(case when ${timeEntries.billable} then ${timeEntries.minutes} else 0 end), 0)`.mapWith(Number),
    })
    .from(timeEntries)
    .innerJoin(projects, s.own(projects, eq(projects.id, timeEntries.projectId)))
    .innerJoin(users, eq(users.id, timeEntries.userId))
    .where(
      s.own(
        timeEntries,
        gte(timeEntries.date, f.from),
        lte(timeEntries.date, f.to),
        f.userId ? eq(timeEntries.userId, f.userId) : undefined,
      ),
    )
    .groupBy(timeEntries.projectId, projects.name, timeEntries.userId, users.name)
    .orderBy(asc(projects.name), asc(users.name));
}

