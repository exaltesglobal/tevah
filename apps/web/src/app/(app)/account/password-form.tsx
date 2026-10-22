"use client";

import { useActionState } from "react";
import { Button, Field, FormError, Input } from "@/components/ui";
import { emptyForm } from "@/lib/form";
import { changePassword } from "./actions";

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePassword, emptyForm);
  const err = (k: string) => state.fieldErrors?.[k];
  return (
    <form action={action} className="max-w-sm space-y-4">
      <FormError message={state.error} />
      {state.saved && (
        <div className="rounded-md border border-brand-100 bg-brand-50 px-3 py-2 text-sm text-brand-700">
          Password changed. Other devices were signed out.
        </div>
      )}
      <Field label="Current password" error={err("current")}>
        <Input name="current" type="password" autoComplete="current-password" required />
      </Field>
      <Field label="New password" error={err("password")} hint="At least 10 characters">
        <Input name="password" type="password" autoComplete="new-password" required />
      </Field>
      <Field label="Confirm new password" error={err("confirm")}>
        <Input name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      <Button disabled={pending}>{pending ? "Saving…" : "Change password"}</Button>
    </form>
  );
}
