import { eq } from "drizzle-orm";
import { cache } from "react";
import { getDb } from "@/db";
import { orgs } from "@/db/schema";

/** The signed-in company's details, once per request. */
export const getOrg = cache(async (orgId: string) => {
  const [org] = await getDb().select().from(orgs).where(eq(orgs.id, orgId));
  if (!org) throw new Error("Company not found");
  return org;
});
