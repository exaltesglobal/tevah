import { randomUUID } from "node:crypto";
import { DEFAULT_JOURNALS, INDIA_COA, validateGstin } from "@tevah/core";
import { eq } from "drizzle-orm";
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

  const orgId = randomUUID();
  await db.insert(orgs).values({
    id: orgId,
    name: org.name,
    legalName: org.legalName ?? org.name,
    gstin: org.gstin?.toUpperCase(),
    pan,
    tan: org.tan,
    stateCode,
  });

  // An existing user (e.g. an accountant serving several companies) keeps their password.
  const email = admin.email.trim().toLowerCase();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  let userId = existing?.id;
  if (!userId) {
    userId = randomUUID();
    await db.insert(users).values({ id: userId, email, name: admin.name, passwordHash: await hashPassword(admin.password) });
  }
  await db.insert(memberships).values({ orgId, userId, role: "admin" });

  await withOrg(
    orgId,
    async ({ tx }) => {
      const coa = INDIA_COA.map((a) => ({
        id: randomUUID(),
        orgId,
        code: a.code,
        name: a.name,
        type: a.type,
        systemTag: a.tag ?? null,
      }));
      await tx.insert(accounts).values(coa);
      const byTag = new Map(coa.map((a) => [a.systemTag, a.id]));
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
