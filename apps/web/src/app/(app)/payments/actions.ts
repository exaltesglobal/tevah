"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withOrg } from "@/db";
import { requireWriter } from "@/lib/auth";
import { UserError } from "@/lib/documents";
import { zodErrors, type FormState } from "@/lib/form";
import { cancelPayment, paymentInput, recordPayment, type PaymentDirection } from "@/lib/payments";

export async function savePayment(direction: PaymentDirection, _prev: FormState, data: FormData): Promise<FormState> {
  const session = await requireWriter();
  let raw: unknown;
  try {
    raw = JSON.parse(String(data.get("payload")));
  } catch {
    return { error: "The form didn't send properly. Please try again." };
  }
  const parsed = paymentInput.safeParse(raw);
  if (!parsed.success) return zodErrors(parsed.error);
  let id: string;
  try {
    id = await withOrg(session.orgId, (s) => recordPayment(s, session, direction, parsed.data));
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/payments");
  revalidatePath("/sales");
  revalidatePath("/purchases");
  redirect(`/payments/${id}`);
}

export async function cancelPaymentAction(id: string): Promise<FormState> {
  const session = await requireWriter();
  try {
    await withOrg(session.orgId, (s) => cancelPayment(s, session, id));
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/payments");
  revalidatePath(`/payments/${id}`);
  revalidatePath("/sales");
  revalidatePath("/purchases");
  return {};
}
