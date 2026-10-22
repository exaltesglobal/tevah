"use server";

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withOrg } from "@/db";
import { contacts } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireWriter } from "@/lib/auth";
import { contactInput } from "@/lib/contacts";
import { formValues, submitted, zodErrors, type FormState } from "@/lib/form";

export async function saveContact(id: string | null, _prev: FormState, data: FormData): Promise<FormState> {
  const session = await requireWriter();
  const parsed = contactInput.safeParse(formValues(data));
  if (!parsed.success) return zodErrors(parsed.error, data);
  const values = parsed.data;

  const savedId = await withOrg(session.orgId, async (s) => {
    if (id) {
      const [existing] = await s.tx.select({ id: contacts.id }).from(contacts).where(s.own(contacts, eq(contacts.id, id)));
      if (!existing) return null;
      await s.tx.update(contacts).set(values).where(s.own(contacts, eq(contacts.id, id)));
      await audit(s, session, "update", "contact", id, values);
      return id;
    }
    const newId = randomUUID();
    await s.tx.insert(contacts).values({ ...values, id: newId, orgId: s.orgId });
    await audit(s, session, "create", "contact", newId, values);
    return newId;
  });
  if (!savedId) return { error: "Contact not found.", values: submitted(data) };

  revalidatePath("/contacts");
  redirect(`/contacts/${savedId}`);
}

export async function setContactArchived(id: string, archived: boolean): Promise<void> {
  const session = await requireWriter();
  await withOrg(session.orgId, async (s) => {
    const [res] = await s.tx.update(contacts).set({ archived }).where(s.own(contacts, eq(contacts.id, id)));
    if (res.affectedRows) await audit(s, session, archived ? "archive" : "restore", "contact", id);
  });
  revalidatePath("/contacts");
  revalidatePath(`/contacts/${id}`);
}
