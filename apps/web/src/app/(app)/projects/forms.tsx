"use client";

import { formatDuration, TASK_STATUS_LABEL, TASK_STATUSES, type TaskStatus } from "@tevah/core";
import { useActionState, useEffect, useRef } from "react";
import { Button, ButtonLink, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import type { projects, tasks } from "@/db/schema";
import { emptyForm } from "@/lib/form";
import { logTimeAction, quickAddTaskAction, saveProjectAction, saveTaskAction } from "./actions";

type Project = typeof projects.$inferSelect;
type Task = typeof tasks.$inferSelect;
type Option = { id: string; name: string };

export function ProjectForm({ project, customers }: { project?: Project; customers: Option[] }) {
  const [state, action, pending] = useActionState(saveProjectAction.bind(null, project?.id ?? null), emptyForm);
  const err = (k: string) => state.fieldErrors?.[k];
  const v = (k: string, fallback: string | null | undefined) => state.values?.[k] ?? fallback ?? "";
  return (
    <form action={action} className="space-y-6">
      <FormError message={state.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Project name" error={err("name")} className="sm:col-span-2">
          <Input name="name" defaultValue={v("name", project?.name)} required />
        </Field>
        <Field label="Customer" error={err("contactId")} hint="Leave empty for internal work">
          <Select name="contactId" defaultValue={v("contactId", project?.contactId)}>
            <option value="">Internal</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" error={err("status")}>
          <Select name="status" defaultValue={v("status", project?.status ?? "active")}>
            <option value="active">Active</option>
            <option value="on_hold">On hold</option>
            <option value="done">Done</option>
          </Select>
        </Field>
        <Field label="Start date" error={err("startDate")}>
          <Input type="date" name="startDate" defaultValue={v("startDate", project?.startDate)} />
        </Field>
        <Field label="Due date" error={err("dueDate")}>
          <Input type="date" name="dueDate" defaultValue={v("dueDate", project?.dueDate)} />
        </Field>
        <Field label="Description" error={err("description")} className="sm:col-span-2">
          <Textarea name="description" rows={4} defaultValue={v("description", project?.description)} />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button disabled={pending}>{pending ? "Saving…" : project ? "Save project" : "Create project"}</Button>
        <ButtonLink href={project ? `/projects/${project.id}` : "/projects"} variant="secondary">
          Cancel
        </ButtonLink>
      </div>
    </form>
  );
}

export function TaskForm({ projectId, task, people }: { projectId: string; task?: Task; people: Option[] }) {
  const [state, action, pending] = useActionState(saveTaskAction.bind(null, projectId, task?.id ?? null), emptyForm);
  const err = (k: string) => state.fieldErrors?.[k];
  const v = (k: string, fallback: string | number | null | undefined) => state.values?.[k] ?? (fallback == null ? "" : String(fallback));
  // Remount after a save so selects pick up the saved values (React only reads a select's defaultValue once).
  return (
    <form key={task?.updatedAt ? new Date(task.updatedAt).getTime() : "new"} action={action} className="space-y-5">
      <FormError message={state.error} />
      {state.saved && !state.error && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">Saved.</p>}
      <Field label="Title" error={err("title")}>
        <Input name="title" defaultValue={v("title", task?.title)} required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Status" error={err("status")}>
          <Select name="status" defaultValue={v("status", task?.status ?? "todo")}>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Assigned to" error={err("assigneeId")}>
          <Select name="assigneeId" defaultValue={v("assigneeId", task?.assigneeId)}>
            <option value="">Nobody</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Priority" error={err("priority")}>
          <Select name="priority" defaultValue={v("priority", task?.priority ?? 0)}>
            <option value="0">Normal</option>
            <option value="1">High</option>
          </Select>
        </Field>
        <Field label="Due date" error={err("dueDate")}>
          <Input type="date" name="dueDate" defaultValue={v("dueDate", task?.dueDate)} />
        </Field>
        <Field label="Estimate" error={err("estimate")} hint="e.g. 2h, 1:30 or 45m">
          <Input name="estimate" defaultValue={v("estimate", task?.estimateMinutes ? formatDuration(task.estimateMinutes) : "")} />
        </Field>
      </div>
      <Field label="Description" error={err("description")}>
        <Textarea name="description" rows={8} defaultValue={v("description", task?.description)} />
      </Field>
      <div className="flex gap-2">
        <Button disabled={pending}>{pending ? "Saving…" : task ? "Save task" : "Create task"}</Button>
        <ButtonLink href={`/projects/${projectId}`} variant="secondary">
          Back to board
        </ButtonLink>
      </div>
    </form>
  );
}

export function QuickAdd({ projectId, status }: { projectId: string; status: TaskStatus }) {
  const [state, action, pending] = useActionState(quickAddTaskAction.bind(null, projectId, status), emptyForm);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.saved) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="mt-2">
      <Input name="title" placeholder="+ Add a task" aria-label={`Add a task to ${TASK_STATUS_LABEL[status]}`} disabled={pending} className="border-dashed bg-transparent" />
      {state.error && <span className="mt-1 block text-xs text-red-600">{state.fieldErrors?.title ?? state.error}</span>}
    </form>
  );
}

export function TimeForm({ projectId, taskId, taskOptions, today }: { projectId: string; taskId?: string; taskOptions?: Option[]; today: string }) {
  const [state, action, pending] = useActionState(logTimeAction.bind(null, projectId, taskId ?? null), emptyForm);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.saved) ref.current?.reset();
  }, [state]);
  const err = (k: string) => state.fieldErrors?.[k];
  return (
    <form ref={ref} action={action} className="space-y-3">
      <FormError message={state.error && !state.fieldErrors ? state.error : undefined} />
      <div className="flex flex-wrap items-start gap-2">
        <Field label="Date" error={err("date")} className="w-40">
          <Input type="date" name="date" defaultValue={state.values?.date ?? today} required />
        </Field>
        <Field label="Time" error={err("duration")} className="w-28">
          <Input name="duration" defaultValue={state.values?.duration} placeholder="1:30" required />
        </Field>
        {taskOptions && (
          <Field label="Task" error={err("taskId")} className="w-56">
            <Select name="taskId" defaultValue={state.values?.taskId ?? ""}>
              <option value="">No particular task</option>
              {taskOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Note" error={err("note")} className="min-w-48 flex-1">
          <Input name="note" defaultValue={state.values?.note} />
        </Field>
      </div>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input type="checkbox" name="billable" defaultChecked className="accent-brand-600" /> Billable
        </label>
        <Button disabled={pending}>{pending ? "Logging…" : "Log time"}</Button>
      </div>
    </form>
  );
}
