"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withOrg, type Scope } from "@/db";
import { requireWriter, type Session } from "@/lib/auth";
import {
  bankAccountInput,
  bookStatementLine,
  createMoneyAccount,
  deleteStatementLine,
  importStatement,
  matchStatementLine,
  quickEntryInput,
  unmatchStatementLine,
} from "@/lib/banking";
import { UserError } from "@/lib/documents";
import { formValues, submitted, zodErrors, type FormState } from "@/lib/form";

async function attempt<T>(fn: (s: Scope, session: Session) => Promise<T>): Promise<{ ok: T } | { error: string }> {
  const session = await requireWriter();
  try {
    return { ok: await withOrg(session.orgId, (s) => fn(s, session)) };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}

export async function addMoneyAccount(_prev: FormState, data: FormData): Promise<FormState> {
  const parsed = bankAccountInput.safeParse(formValues(data));
  if (!parsed.success) return zodErrors(parsed.error, data);
  const result = await attempt((s, session) => createMoneyAccount(s, session, parsed.data));
  if ("error" in result) return { error: result.error, values: submitted(data) };
  revalidatePath("/banking");
  redirect(`/banking/${result.ok}`);
}

const MAX_BYTES = 2_000_000;

export async function uploadStatement(journalId: string, _prev: FormState, data: FormData): Promise<FormState & { message?: string }> {
  const file = data.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file exported from your bank" };
  if (file.size > MAX_BYTES) return { error: "That file is over 2 MB. Export a shorter date range." };
  if (/\.(xlsx?|pdf)$/i.test(file.name)) return { error: "Save the statement as CSV first (Excel: File › Save As › CSV)." };
  const text = await file.text();
  const result = await attempt((s, session) => importStatement(s, session, journalId, text));
  if ("error" in result) return { error: result.error };
  revalidatePath(`/banking/${journalId}`);
  revalidatePath("/banking");
  const r = result.ok;
  const parts = [`Imported ${r.added} transaction${r.added === 1 ? "" : "s"}`];
  if (r.duplicates) parts.push(`skipped ${r.duplicates} already loaded`);
  if (r.skipped.length) parts.push(`couldn't read line${r.skipped.length === 1 ? "" : "s"} ${r.skipped.map((x) => x.line).join(", ")}`);
  return { saved: true, message: parts.join("; ") + "." };
}

export async function matchAction(journalId: string, statementLineId: string, journalLineId: string): Promise<FormState> {
  const result = await attempt((s, session) => matchStatementLine(s, session, statementLineId, journalLineId));
  if ("error" in result) return { error: result.error };
  revalidatePath(`/banking/${journalId}`);
  return {};
}

export async function unmatchAction(journalId: string, statementLineId: string): Promise<FormState> {
  const result = await attempt((s, session) => unmatchStatementLine(s, session, statementLineId));
  if ("error" in result) return { error: result.error };
  revalidatePath(`/banking/${journalId}`);
  return {};
}

export async function deleteLineAction(journalId: string, statementLineId: string): Promise<FormState> {
  const result = await attempt((s, session) => deleteStatementLine(s, session, statementLineId));
  if ("error" in result) return { error: result.error };
  revalidatePath(`/banking/${journalId}`);
  return {};
}

export async function bookAction(journalId: string, statementLineId: string, _prev: FormState, data: FormData): Promise<FormState> {
  const parsed = quickEntryInput.safeParse(formValues(data));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Choose an account" };
  const result = await attempt((s, session) => bookStatementLine(s, session, statementLineId, parsed.data));
  if ("error" in result) return { error: result.error };
  revalidatePath(`/banking/${journalId}`);
  revalidatePath("/banking");
  return {};
}
