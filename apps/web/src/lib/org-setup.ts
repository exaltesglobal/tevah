import { DEFAULT_JOURNALS, INDIA_COA, validateGstin } from "@tevah/core";
import { sql } from "drizzle-orm";
import { withOrg, type Db } from "@/db";
import { accounts, journals, memberships, orgs, users } from "@/db/schema";
import { hashPassword } from "./password";

export interface NewOrg {
  name: string;
  legalName?: string;
  gstin?: string;
  pan?: string;
  tan?: string;
  stateCode?: string;
}

export interface NewAdmin {
  email: string;
  name: string;
  password: string;
}

/** Create a company with the Indian chart of accounts, default journals and its first admin. */
export async function createOrg(db: Db, org: NewOrg, admin: NewAdmin): Promise<{ orgId: string; userId: string }> {
  let stateCode = org.stateCode;
  let pan = org.pan;
  if (org.gstin) {
    const check = validateGstin(org.gstin);
    if (!check.valid) throw new Error(check.reason);
    stateCode ??= check.stateCode;
    pan ??= check.pan;
  }
  if (!stateCode) throw new Error("A state is required when there is no GSTIN");

  const [created] = await db
    .insert(orgs)
    .values({
      name: org.name,
      legalName: org.legalName ?? org.name,
      gstin: org.gstin?.toUpperCase(),
      pan,
      tan: org.tan,
      stateCode,
    })
    .returning({ id: orgs.id });
  const orgId = created!.id;

  // An existing user (e.g. an accountant serving several companies) keeps their password.
  const email = admin.email.trim().toLowerCase();
  const [existing] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`);
  const userId =
    existing?.id ??
    (await db
      .insert(users)
      .values({ email, name: admin.name, passwordHash: await hashPassword(admin.password) })
      .returning({ id: users.id }))[0]!.id;
  await db.insert(memberships).values({ orgId, userId, role: "admin" });

  await withOrg(
    orgId,
    async (tx) => {
      const created = await tx
        .insert(accounts)
        .values(INDIA_COA.map((a) => ({ orgId, code: a.code, name: a.name, type: a.type, systemTag: a.tag ?? null })))
        .returning({ id: accounts.id, tag: accounts.systemTag });
      const byTag = new Map(created.map((a) => [a.tag, a.id]));
      await tx.insert(journals).values(
        DEFAULT_JOURNALS.map((j) => ({
          orgId,
          code: j.code,
          name: j.name,
          type: j.type,
          defaultAccountId: j.type === "bank" ? byTag.get("bank") : j.type === "cash" ? byTag.get("cash") : null,
        })),
      );
    },
    db,
  );

  return { orgId, userId };
}
