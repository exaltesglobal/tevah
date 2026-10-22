import { eq } from "drizzle-orm";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withOrg, type Db } from "@/db";
import * as schema from "@/db/schema";
import type { Session } from "@/lib/auth";
import { createOrg } from "@/lib/org-setup";
import {
  boardTasks,
  createTask,
  deleteTask,
  deleteTime,
  listProjects,
  logTime,
  moveTask,
  openTasksFor,
  projectInput,
  saveProject,
  taskInput,
  timeInput,
  timesheet,
  updateTask,
} from "@/lib/projects";
import { freshDatabase } from "./db";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("projects, tasks and time against MySQL", () => {
  let pool: mysql.Pool;
  let db: Db;
  let session: Session;
  let other: Session;
  let project: string;
  const ids: Record<string, string> = {};

  const as = <T>(who: Session, fn: Parameters<typeof withOrg<T>>[1]) => withOrg(who.orgId, fn, db);
  const task = (title: string, extra: Record<string, string> = {}) => taskInput.parse({ title, ...extra });

  beforeAll(async () => {
    ({ db, pool } = await freshDatabase(url!));
    const pw = "test-password-123";
    const a = await createOrg(db, { name: "Exaltes", gstin: "27AAJCE3276G1ZH" }, { email: "a@test.in", name: "Anup", password: pw });
    const b = await createOrg(db, { name: "Other", stateCode: "29" }, { email: "b@test.in", name: "B", password: pw });
    const base = { userName: "Anup", email: "a@test.in", orgName: "Exaltes", orgStateCode: "27", role: "admin" as const };
    session = { ...base, userId: a.userId, orgId: a.orgId };
    other = { ...base, userId: b.userId, orgId: b.orgId };
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("validates and creates a project", async () => {
    expect(projectInput.safeParse({ name: "X", startDate: "2026-10-10", dueDate: "2026-10-01" }).success).toBe(false);
    project = await as(session, (s) => saveProject(s, session, null, projectInput.parse({ name: "Tevah ERP", dueDate: "2026-12-31" })));
    expect(await as(other, (s) => listProjects(s, { archived: false, today: "2026-10-22" }))).toEqual([]);
  });

  it("adds tasks to the end of their column and keeps people within the company", async () => {
    for (const t of ["Reports", "GST returns", "Banking"]) ids[t] = await as(session, (s) => createTask(s, session, project, task(t)));
    const board = await as(session, (s) => boardTasks(s, project));
    expect(board.map((t) => [t.title, t.position])).toEqual([
      ["Reports", 1000],
      ["GST returns", 2000],
      ["Banking", 3000],
    ]);
    await expect(as(session, (s) => createTask(s, session, project, task("Spy", { assigneeId: other.userId })))).rejects.toThrow("isn't part of this company");
    await expect(as(other, (s) => createTask(s, other, project, task("Nope")))).rejects.toThrow("Project not found");
    expect(taskInput.safeParse({ title: "x", estimate: "soon" }).success).toBe(false);
  });

  it("moves cards on the board and stamps completion", async () => {
    await as(session, (s) => moveTask(s, session, ids.Banking!, "todo", 0));
    expect((await as(session, (s) => boardTasks(s, project))).map((t) => t.title)).toEqual(["Banking", "Reports", "GST returns"]);
    await as(session, (s) => moveTask(s, session, ids.Reports!, "done", 0));
    const [done] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, ids.Reports!));
    expect(done!.status).toBe("done");
    expect(done!.completedAt).toBeInstanceOf(Date);
    await as(session, (s) => updateTask(s, session, ids.Reports!, task("Reports", { status: "in_progress", assigneeId: session.userId, dueDate: "2026-10-20" })));
    const [reopened] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, ids.Reports!));
    expect(reopened!.completedAt).toBeNull();
    const mine = await as(session, (s) => openTasksFor(s, session.userId));
    expect(mine.map((t) => t.title)).toEqual(["Reports"]);
    const list = await as(session, (s) => listProjects(s, { archived: false, today: "2026-10-22" }));
    expect(list[0]).toMatchObject({ open: 3, done: 0, overdue: 1 });
  });

  it("logs time, summarises it and protects tasks that have time", async () => {
    expect(timeInput.safeParse({ date: "2026-10-22", duration: "" }).success).toBe(false);
    const entry = await as(session, (s) =>
      logTime(s, session, project, timeInput.parse({ date: "2026-10-22", duration: "1:30", taskId: ids.Reports, billable: "on", note: "TB and P&L" })),
    );
    await as(session, (s) => logTime(s, session, project, timeInput.parse({ date: "2026-10-21", duration: "45m" })));
    const sheet = await as(session, (s) => timesheet(s, { from: "2026-10-01", to: "2026-10-31" }));
    expect(sheet).toEqual([expect.objectContaining({ project: "Tevah ERP", user: "Anup", minutes: 135, billable: 90 })]);
    expect((await as(session, (s) => boardTasks(s, project))).find((t) => t.id === ids.Reports)!.minutes).toBe(90);

    await expect(as(session, (s) => deleteTask(s, session, ids.Reports!))).rejects.toThrow("Time is logged");
    await as(session, (s) => deleteTask(s, session, ids["GST returns"]!));

    const staff = { ...session, userId: other.userId, role: "staff" as const };
    await expect(as(session, (s) => deleteTime(s, staff, entry))).rejects.toThrow("Only an admin");
    await as(session, (s) => deleteTime(s, session, entry));
    expect((await as(session, (s) => timesheet(s, { from: "2026-10-01", to: "2026-10-31" })))[0]!.minutes).toBe(45);
  });
});
