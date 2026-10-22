"use client";

import { useActionState } from "react";
import { Button, Field, FormError, Input } from "@/components/ui";
import { emptyForm } from "@/lib/form";
import { login } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, emptyForm);
  return (
    <form action={action} className="space-y-4">
      <FormError message={state.error} />
      <Field label="Email">
        <Input name="email" type="email" autoComplete="email" defaultValue={state.values?.email} required autoFocus />
      </Field>
      <Field label="Password">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
