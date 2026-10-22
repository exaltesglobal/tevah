"use client";

import { useActionState } from "react";
import { Button, Field, FormError, Input, Select } from "@/components/ui";
import { emptyForm, type FormState } from "@/lib/form";
import { addMoneyAccount, bookAction, uploadStatement } from "./actions";

export function AddAccountForm() {
  const [state, action, pending] = useActionState(addMoneyAccount, emptyForm);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      {state.error && <div className="w-full"><FormError message={state.error} /></div>}
      <Field label="Account name" error={state.fieldErrors?.name} className="min-w-64 flex-1">
        <Input name="name" defaultValue={state.values?.name} placeholder="e.g. HDFC Current 1234" required />
      </Field>
      <Field label="Type">
        <Select name="type" defaultValue={state.values?.type ?? "bank"} className="w-auto!">
          <option value="bank">Bank</option>
          <option value="cash">Cash</option>
        </Select>
      </Field>
      <Button disabled={pending}>Add account</Button>
    </form>
  );
}

export function UploadForm({ journalId }: { journalId: string }) {
  const [state, action, pending] = useActionState<FormState & { message?: string }, FormData>(uploadStatement.bind(null, journalId), emptyForm);
  return (
    <form action={action} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="file" name="file" accept=".csv,text/csv" required className="max-w-sm" />
        <Button disabled={pending}>{pending ? "Importing…" : "Import statement"}</Button>
      </div>
      <FormError message={state.error} />
      {state.message && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{state.message}</p>}
      <p className="text-xs text-stone-500">
        CSV from net banking with Date, Narration/Description and Withdrawal/Deposit (or Amount) columns. Lines already imported are skipped.
      </p>
    </form>
  );
}

export function BookForm({ journalId, lineId, accounts }: { journalId: string; lineId: string; accounts: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState(bookAction.bind(null, journalId, lineId), emptyForm);
  return (
    <form action={action} className="flex flex-wrap items-center gap-1">
      <Select name="accountId" required className="w-56! py-1! text-xs" defaultValue="">
        <option value="" disabled>
          Book to account…
        </option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
      </Select>
      <Button variant="secondary" disabled={pending} className="px-2! py-1! text-xs">
        Book
      </Button>
      {state.error && <span className="w-full text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
