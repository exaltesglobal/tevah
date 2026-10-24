"use client";

import { useActionState, type ReactNode } from "react";
import { emptyForm, type FormState } from "@/lib/form";
import { Button } from "./ui";

/** A one-click server action (post, cancel, delete) that shows its error inline. */
export function ActionButton({
  action,
  children,
  variant = "secondary",
  confirm,
}: {
  action: (prev: FormState, data: FormData) => Promise<FormState>;
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger";
  confirm?: string;
}) {
  const [state, run, pending] = useActionState(action, emptyForm);
  return (
    <form
      action={run}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className="inline-flex flex-col items-end"
    >
      <Button variant={variant} disabled={pending}>
        {children}
      </Button>
      {state.error && <span className="mt-1 max-w-56 text-right text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
