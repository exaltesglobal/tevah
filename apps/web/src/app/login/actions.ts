"use server";

import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { memberships, users } from "@/db/schema";
import { createSession, destroySession } from "@/lib/auth";
import { submitted, type FormState } from "@/lib/form";
import { verifyPassword } from "@/lib/password";

export async function login(_prev: FormState, data: FormData): Promise<FormState> {
  const email = String(data.get("email") ?? "").trim().toLowerCase();
  const password = String(data.get("password") ?? "");
  const db = getDb();
  const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
  if (!user || !(await verifyPassword(user.passwordHash, password))) {
    return { error: "Email or password is incorrect.", values: submitted(data) };
  }
  const [membership] = await db
    .select({ orgId: memberships.orgId })
    .from(memberships)
    .where(sql`${memberships.userId} = ${user.id}`)
    .orderBy(memberships.createdAt)
    .limit(1);
  if (!membership) return { error: "Your account isn't linked to a company yet." };
  await createSession(user.id, membership.orgId);
  redirect("/");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}
