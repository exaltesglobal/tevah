import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/db";
import { memberships, orgs, sessions, users } from "@/db/schema";

const COOKIE = "tevah_session";
const SESSION_DAYS = 30;

export type Role = (typeof memberships.$inferSelect)["role"];

export interface Session {
  userId: string;
  userName: string;
  email: string;
  orgId: string;
  orgName: string;
  orgStateCode: string;
  role: Role;
}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(userId: string, orgId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await getDb().insert(sessions).values({ id: tokenHash(token), userId, orgId, expiresAt });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const [row] = await getDb()
    .select({
      userId: users.id,
      userName: users.name,
      email: users.email,
      orgId: orgs.id,
      orgName: orgs.name,
      orgStateCode: orgs.stateCode,
      role: memberships.role,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(orgs, eq(orgs.id, sessions.orgId))
    .innerJoin(memberships, and(eq(memberships.userId, sessions.userId), eq(memberships.orgId, sessions.orgId)))
    .where(and(eq(sessions.id, tokenHash(token)), gt(sessions.expiresAt, new Date())));
  return row ?? null;
});

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

const WRITE_ROLES: readonly Role[] = ["admin", "accountant", "staff"];

/** Session that may change data; viewers (e.g. a CA with read-only access) are refused. */
export async function requireWriter(): Promise<Session> {
  const session = await requireSession();
  if (!WRITE_ROLES.includes(session.role)) throw new Error("You have read-only access");
  return session;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await getDb().delete(sessions).where(eq(sessions.id, tokenHash(token)));
  jar.delete(COOKIE);
}
