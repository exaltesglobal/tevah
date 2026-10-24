"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withOrg } from "@/db";
import { requireWriter } from "@/lib/auth";
import { UserError } from "@/lib/documents";
import { zodErrors, type FormState } from "@/lib/form";
import { cancelJournalVoucher, journalInput, postJournalVoucher } from "@/lib/journal";

export async function saveJournal(_prev: FormState, data: FormData): Promise<FormState> {
  const session = await requireWriter();
  if (session.role === "staff") return { error: "Only an admin or accountant can post journal entries." };
  let raw: unknown;
  try {
    raw = JSON.parse(String(data.get("payload")));
  } catch {
    return { error: "The form didn't send properly. Please try again." };
  }
  const parsed = journalInput.safeParse(raw);
  if (!parsed.success) {
    const state = zodErrors(parsed.error);
    const balance = parsed.error.issues.find((i) => i.path.length === 1 && i.path[0] === "lines");
    return balance ? { ...state, error: balance.message } : state;
  }
  let id: string;
  try {
    id = await withOrg(session.orgId, (s) => postJournalVoucher(s, session, parsed.data));
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/journal");
  redirect(`/journal/${id}`);
}

export async function cancelJournalAction(id: string): Promise<FormState> {
  const session = await requireWriter();
  if (session.role === "staff") return { error: "Only an admin or accountant can cancel journal entries." };
  try {
    await withOrg(session.orgId, (s) => cancelJournalVoucher(s, session, id));
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/journal");
  revalidatePath(`/journal/${id}`);
  return {};
}
