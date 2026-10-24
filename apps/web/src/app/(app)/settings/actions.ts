"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb, withOrg } from "@/db";
import { orgs } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireWriter } from "@/lib/auth";
import { formValues, submitted, zodErrors, type FormState } from "@/lib/form";

const companyInput = z.object({
  name: z.string().min(1, "Name is required").max(200),
  legalName: z.string().min(1, "Legal name is required").max(200),
  tan: z
    .string()
    .regex(/^[A-Z]{4}\d{5}[A-Z]$/, "TAN looks like PNEE11205F")
    .optional(),
  addressLine1: z.string().max(200).optional(),
  addressLine2: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  pincode: z
    .string()
    .regex(/^\d{6}$/, "PIN code is 6 digits")
    .optional(),
  email: z.email("Enter a valid email").optional(),
  phone: z.string().max(30).optional(),
});

export async function saveCompany(_prev: FormState, data: FormData): Promise<FormState> {
  const session = await requireWriter();
  if (session.role !== "admin") return { error: "Only an admin can change company details." };
  const raw = formValues(data);
  const parsed = companyInput.safeParse({ ...raw, tan: raw.tan?.toUpperCase() });
  if (!parsed.success) return zodErrors(parsed.error, data);
  // GSTIN and state are fixed: changing them would change the tax on every document.
  const values = Object.fromEntries(Object.entries(parsed.data).map(([k, v]) => [k, v ?? null]));
  await getDb().update(orgs).set(values).where(eq(orgs.id, session.orgId));
  await withOrg(session.orgId, (s) => audit(s, session, "update", "company", session.orgId, values));
  revalidatePath("/", "layout");
  return { values: submitted(data), saved: true };
}
