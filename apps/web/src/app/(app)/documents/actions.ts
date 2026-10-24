"use server";

import type { DocumentType } from "@tevah/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withOrg, type Scope } from "@/db";
import { requireWriter, type Session } from "@/lib/auth";
import { docPath, sideOf } from "@/lib/doc-kinds";
import { cancelDocument, deleteDraft, documentInput, postDocument, saveDraft, UserError } from "@/lib/documents";
import { zodErrors, type FormState } from "@/lib/form";

/** Run a document change, turning user-facing failures into form errors. */
async function attempt<T>(fn: (s: Scope, session: Session) => Promise<T>): Promise<{ ok: T } | { error: string }> {
  const session = await requireWriter();
  try {
    return { ok: await withOrg(session.orgId, (s) => fn(s, session)) };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}

export async function saveDocument(type: DocumentType, id: string | null, _prev: FormState, data: FormData): Promise<FormState> {
  let raw: unknown;
  try {
    raw = JSON.parse(String(data.get("payload")));
  } catch {
    return { error: "The form didn't send properly. Please try again." };
  }
  const parsed = documentInput.safeParse(raw);
  if (!parsed.success) return zodErrors(parsed.error);
  const post = data.get("intent") === "post";

  const result = await attempt(async (s, session) => {
    const docId = await saveDraft(s, session, type, id, parsed.data);
    if (post) await postDocument(s, session, docId);
    return docId;
  });
  if ("error" in result) return { error: result.error };
  revalidatePath(`/${sideOf(type)}`);
  redirect(docPath(type, result.ok));
}

export async function postDocumentAction(type: DocumentType, id: string): Promise<FormState> {
  const result = await attempt((s, session) => postDocument(s, session, id));
  if ("error" in result) return { error: result.error };
  revalidatePath(`/${sideOf(type)}`);
  revalidatePath(docPath(type, id));
  return {};
}

export async function cancelDocumentAction(type: DocumentType, id: string): Promise<FormState> {
  const result = await attempt((s, session) => cancelDocument(s, session, id));
  if ("error" in result) return { error: result.error };
  revalidatePath(`/${sideOf(type)}`);
  revalidatePath(docPath(type, id));
  return {};
}

export async function deleteDraftAction(type: DocumentType, id: string): Promise<FormState> {
  const result = await attempt((s, session) => deleteDraft(s, session, id));
  if ("error" in result) return { error: result.error };
  revalidatePath(`/${sideOf(type)}`);
  redirect(`/${sideOf(type)}`);
}
