"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { endOtherSessions, requireSession } from "@/lib/auth";
import { submitted, zodErrors, type FormState } from "@/lib/form";
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from "@/lib/password";

const SECRETS = ["current", "password", "confirm"] as const;

const passwordInput = z
  .object({
    current: z.string().min(1, "Enter your current password"),
    password: z.string().min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`).max(200),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match" });

export async function changePassword(_prev: FormState, data: FormData): Promise<FormState> {
  const session = await requireSession();
  const parsed = passwordInput.safeParse(Object.fromEntries(SECRETS.map((k) => [k, String(data.get(k) ?? "")])));
  if (!parsed.success) return { ...zodErrors(parsed.error), values: submitted(data, SECRETS) };
  const db = getDb();
  const [user] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, session.userId));
  if (!user || !(await verifyPassword(user.hash, parsed.data.current))) {
    return { fieldErrors: { current: "That isn't your current password" }, error: "Please fix the highlighted fields." };
  }
  await db.update(users).set({ passwordHash: await hashPassword(parsed.data.password) }).where(eq(users.id, session.userId));
  await endOtherSessions(session.userId);
  return { saved: true };
}
