"use server";

import { revalidatePath } from "next/cache";
import { withOrg } from "@/db";
import { invoiceDesigns } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireWriter } from "@/lib/auth";
import { zodErrors, type FormState } from "@/lib/form";
import { designInput } from "@/lib/invoice-design";

export async function saveInvoiceDesign(_prev: FormState, data: FormData): Promise<FormState> {
  const session = await requireWriter();
  if (session.role !== "admin") return { error: "Only an admin can change the invoice design." };
  let raw: unknown;
  try {
    raw = JSON.parse(String(data.get("payload") ?? ""));
  } catch {
    return { error: "Could not read the form. Reload the page and try again." };
  }
  const parsed = designInput.safeParse(raw);
  if (!parsed.success) return zodErrors(parsed.error);
  const values = parsed.data;
  await withOrg(session.orgId, async (s) => {
    await s.tx
      .insert(invoiceDesigns)
      .values({ ...values, orgId: s.orgId })
      .onDuplicateKeyUpdate({ set: values });
    // Images are large and already visible in the design; log only that they changed.
    const { logo, signature, ...rest } = values;
    await audit(s, session, "update", "invoice_design", session.orgId, { ...rest, logo: Boolean(logo), signature: Boolean(signature) });
  });
  revalidatePath("/", "layout");
  return { saved: true };
}
