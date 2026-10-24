"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withOrg } from "@/db";
import { requireWriter, type Session } from "@/lib/auth";
import { baseUrl } from "@/lib/base-url";
import { appInput, createApp, getApp, replayAppEvent, rotateSecret, updateApp } from "@/lib/connected-apps";
import { sendDocumentEmail } from "@/lib/document-email";
import { UserError } from "@/lib/documents";
import { formValues, submitted, zodErrors, type FormState } from "@/lib/form";

async function admin(): Promise<Session> {
  const session = await requireWriter();
  if (session.role !== "admin") throw new UserError("Only an admin can manage connected apps.");
  return session;
}

const failed = (err: unknown): FormState => {
  if (err instanceof UserError) return { error: err.message };
  throw err;
};

export async function createAppAction(_prev: FormState, data: FormData): Promise<FormState> {
  let id: string;
  try {
    const session = await admin();
    const parsed = appInput.safeParse(formValues(data));
    if (!parsed.success) return zodErrors(parsed.error, data);
    id = await withOrg(session.orgId, (s) => createApp(s, session, parsed.data));
  } catch (err) {
    return { ...failed(err), values: submitted(data) };
  }
  revalidatePath("/settings/apps");
  redirect(`/settings/apps/${id}`);
}

export async function updateAppAction(id: string, _prev: FormState, data: FormData): Promise<FormState> {
  try {
    const session = await admin();
    const parsed = appInput.safeParse(formValues(data));
    if (!parsed.success) return zodErrors(parsed.error, data);
    await withOrg(session.orgId, (s) => updateApp(s, session, id, parsed.data));
  } catch (err) {
    return { ...failed(err), values: submitted(data) };
  }
  revalidatePath("/settings/apps");
  redirect(`/settings/apps/${id}`);
}

export async function rotateSecretAction(id: string): Promise<FormState> {
  try {
    const session = await admin();
    await withOrg(session.orgId, (s) => rotateSecret(s, session, id));
  } catch (err) {
    return failed(err);
  }
  revalidatePath(`/settings/apps/${id}`);
  return { saved: true };
}

/** Send (or send again) the invoice email for one booked payment. */
export async function resendEmailAction(appId: string, appPaymentId: string): Promise<FormState> {
  try {
    const session = await admin();
    await sendDocumentEmail(session.orgId, appPaymentId, await baseUrl());
  } catch (err) {
    return failed(err);
  }
  revalidatePath(`/settings/apps/${appId}`);
  return { saved: true };
}

/** Book a failed or ignored event again from the body Tevah kept. */
export async function replayEventAction(appId: string, appPaymentId: string): Promise<FormState> {
  try {
    const session = await admin();
    const booked = await withOrg(session.orgId, async (s) => {
      const app = await getApp(s, appId);
      if (!app) throw new UserError("App not found");
      return replayAppEvent(s, app, appPaymentId);
    });
    if (booked.emailPending) await sendDocumentEmail(session.orgId, booked.appPaymentId, await baseUrl());
  } catch (err) {
    return failed(err);
  }
  revalidatePath(`/settings/apps/${appId}`);
  return { saved: true };
}
