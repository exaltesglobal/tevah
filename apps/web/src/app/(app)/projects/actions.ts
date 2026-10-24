"use server";

import { TASK_STATUSES, type TaskStatus } from "@tevah/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withOrg } from "@/db";
import { requireWriter } from "@/lib/auth";
import { UserError } from "@/lib/documents";
import { formValues, submitted, zodErrors, type FormState } from "@/lib/form";
import {
  createTask,
  deleteTask,
  deleteTime,
  logTime,
  moveTask,
  projectInput,
  saveProject,
  setProjectArchived,
  taskInput,
  timeInput,
  updateTask,
} from "@/lib/projects";

async function attempt<T>(fn: () => Promise<T>, data?: FormData): Promise<{ ok: T } | { error: FormState }> {
  try {
    return { ok: await fn() };
  } catch (e) {
    if (e instanceof UserError) return { error: { error: e.message, values: data && submitted(data) } };
    throw e;
  }
}

export async function saveProjectAction(id: string | null, _prev: FormState, data: FormData): Promise<FormState> {
  const session = await requireWriter();
  const parsed = projectInput.safeParse(formValues(data));
  if (!parsed.success) return zodErrors(parsed.error, data);
  const r = await attempt(() => withOrg(session.orgId, (s) => saveProject(s, session, id, parsed.data)), data);
  if ("error" in r) return r.error;
  revalidatePath("/projects");
  redirect(`/projects/${r.ok}`);
}

export async function archiveProjectAction(id: string, archived: boolean): Promise<FormState> {
  const session = await requireWriter();
  await withOrg(session.orgId, (s) => setProjectArchived(s, session, id, archived));
  revalidatePath("/projects");
  revalidatePath(`/projects/${id}`);
  return {};
}

/** Quick add from a board column: just a title. */
export async function quickAddTaskAction(projectId: string, status: TaskStatus, _prev: FormState, data: FormData): Promise<FormState> {
  const session = await requireWriter();
  const parsed = taskInput.safeParse({ title: data.get("title"), status });
  if (!parsed.success) return zodErrors(parsed.error, data);
  const r = await attempt(() => withOrg(session.orgId, (s) => createTask(s, session, projectId, parsed.data)), data);
  if ("error" in r) return r.error;
  revalidatePath(`/projects/${projectId}`);
  return { saved: true };
}

export async function saveTaskAction(projectId: string, id: string | null, _prev: FormState, data: FormData): Promise<FormState> {
  const session = await requireWriter();
  const parsed = taskInput.safeParse(formValues(data));
  if (!parsed.success) return zodErrors(parsed.error, data);
  const r = await attempt(
    () => withOrg(session.orgId, async (s) => (id ? (await updateTask(s, session, id, parsed.data), id) : createTask(s, session, projectId, parsed.data))),
    data,
  );
  if ("error" in r) return r.error;
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/tasks");
  if (!id) redirect(`/tasks/${r.ok}`);
  revalidatePath(`/tasks/${id}`);
  return { saved: true, values: submitted(data) };
}

export async function moveTaskAction(projectId: string, id: string, status: string, index: number): Promise<FormState> {
  const session = await requireWriter();
  if (!(TASK_STATUSES as readonly string[]).includes(status)) return { error: "Unknown column" };
  const r = await attempt(() => withOrg(session.orgId, (s) => moveTask(s, session, id, status as TaskStatus, index)));
  if ("error" in r) return r.error;
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/tasks");
  return {};
}

export async function deleteTaskAction(projectId: string, id: string): Promise<FormState> {
  const session = await requireWriter();
  const r = await attempt(() => withOrg(session.orgId, (s) => deleteTask(s, session, id)));
  if ("error" in r) return r.error;
  revalidatePath(`/projects/${projectId}`);
  redirect(`/projects/${projectId}`);
}

export async function logTimeAction(projectId: string, taskId: string | null, _prev: FormState, data: FormData): Promise<FormState> {
  const session = await requireWriter();
  const parsed = timeInput.safeParse({ ...formValues(data), taskId: taskId ?? data.get("taskId") ?? undefined });
  if (!parsed.success) return zodErrors(parsed.error, data);
  const r = await attempt(() => withOrg(session.orgId, (s) => logTime(s, session, projectId, parsed.data)), data);
  if ("error" in r) return r.error;
  revalidatePath(`/projects/${projectId}`);
  if (taskId) revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/timesheet");
  return { saved: true };
}

export async function deleteTimeAction(projectId: string, taskId: string | null, id: string): Promise<FormState> {
  const session = await requireWriter();
  const r = await attempt(() => withOrg(session.orgId, (s) => deleteTime(s, session, id)));
  if ("error" in r) return r.error;
  revalidatePath(`/projects/${projectId}`);
  if (taskId) revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/timesheet");
  return {};
}
