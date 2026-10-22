"use server";

import { and, eq } from "drizzle-orm";
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

  const savedId = await withOrg(session.orgId, async (tx) => {
    if (id) {
      const [row] = await tx
        .update(contacts)
        .set(values)
        .where(and(eq(contacts.id, id), eq(contacts.orgId, session.orgId)))
        .returning({ id: contacts.id });
      if (!row) throw new Error("Contact not found");
      await audit(tx, session, "update", "contact", row.id, values);
      return row.id;
    }
    const [row] = await tx
      .insert(contacts)
      .values({ ...values, orgId: session.orgId })
      .returning({ id: contacts.id });
    await audit(tx, session, "create", "contact", row!.id, values);
    return row!.id;
  });

  revalidatePath("/contacts");
  redirect(`/contacts/${savedId}`);
}

export async function setContactArchived(id: string, archived: boolean): Promise<void> {
  const session = await requireWriter();
  await withOrg(session.orgId, async (tx) => {
    await tx.update(contacts).set({ archived }).where(eq(contacts.id, id));
    await audit(tx, session, archived ? "archive" : "restore", "contact", id);
  });
  revalidatePath("/contacts");
  revalidatePath(`/contacts/${id}`);
}
