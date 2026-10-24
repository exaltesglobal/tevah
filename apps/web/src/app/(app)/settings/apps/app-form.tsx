"use client";

import { GST_RATES_BPS } from "@tevah/core";
import { useActionState } from "react";
import { Button, Field, FormError, Input, Select } from "@/components/ui";
import type { ConnectedApp } from "@/lib/connected-apps";
import { emptyForm, type FormState } from "@/lib/form";
import type { AppFormOptions } from "./options";

export function AppForm({
  app,
  options,
  action,
}: {
  app: ConnectedApp | null;
  options: AppFormOptions;
  action: (prev: FormState, data: FormData) => Promise<FormState>;
}) {
  const [state, run, pending] = useActionState(action, emptyForm);
  const err = (k: string) => state.fieldErrors?.[k];
  const v = (k: string, fallback: string | number | null | undefined) => state.values?.[k] ?? (fallback == null ? "" : String(fallback));
  const defaultFee = options.expense.find((a) => a.code === "5370")?.id ?? "";
  const defaultIncome = options.income.find((a) => a.code === "4100")?.id ?? options.income[0]?.id ?? "";
  const source = state.values?.source ?? app?.source ?? "razorpay";
  const journalLabel = (j: AppFormOptions["journals"][number]) => `${j.name}${j.type === "cash" ? " (cash)" : ""}`;

  return (
    <form action={run} className="space-y-6">
      <FormError message={state.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="App name" error={err("name")} hint="Printed on every invoice line, so customers see what they paid for">
          <Input name="name" defaultValue={v("name", app?.name)} required autoFocus={!app} />
        </Field>
        <Field label="How payments arrive" error={err("source")} hint={app ? "Fixed once the app is connected" : "Razorpay posts webhooks; any other app calls Tevah's API"}>
          {app ? (
            <>
              <input type="hidden" name="source" value={app.source} />
              <Input value={app.source === "razorpay" ? "Razorpay webhook" : "Tevah API"} disabled />
            </>
          ) : (
            <Select name="source" defaultValue={source}>
              <option value="razorpay">Razorpay webhook</option>
              <option value="api">Tevah API (the app reports payments)</option>
            </Select>
          )}
        </Field>
        <Field
          label="Razorpay notes tag"
          error={err("notesFilter")}
          hint="Leave blank to book every payment on the account. If several apps share one Razorpay account, each app adds notes.app = this value to its payments and Tevah books only those."
        >
          <Input name="notesFilter" defaultValue={v("notesFilter", app?.notesFilter)} placeholder="e.g. chitthi" />
        </Field>
        <Field label="SAC" error={err("sac")} hint="998315 is online software/SaaS subscriptions">
          <Input name="sac" inputMode="numeric" defaultValue={v("sac", app?.sac ?? "998315")} required />
        </Field>
        <Field label="GST rate" error={err("gstRateBps")} hint="The customer's payment includes GST; Tevah works the taxable value back from it">
          <Select name="gstRateBps" defaultValue={v("gstRateBps", app?.gstRateBps ?? 1800)}>
            {GST_RATES_BPS.map((r) => (
              <option key={r} value={r}>
                {r / 100}%
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Income account" error={err("incomeAccountId")}>
          <Select name="incomeAccountId" defaultValue={v("incomeAccountId", app?.incomeAccountId ?? defaultIncome)} required>
            {options.income.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Receiving account"
          error={err("journalId")}
          hint={app || source !== "razorpay" ? "Where the money lands when the customer pays" : "Leave blank and Tevah makes a Razorpay Balance clearing account; settlements move it to your bank"}
        >
          <Select name="journalId" defaultValue={v("journalId", app?.journalId)}>
            <option value="">{source === "razorpay" ? "Razorpay Balance (made for you)" : "Choose…"}</option>
            {options.journals.map((j) => (
              <option key={j.id} value={j.id}>
                {journalLabel(j)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Settlement bank account" error={err("bankJournalId")} hint="Razorpay settlements (settlement.processed) are booked from the receiving account into this bank">
          <Select name="bankJournalId" defaultValue={v("bankJournalId", app?.bankJournalId)}>
            <option value="">Don't book settlements</option>
            {options.journals
              .filter((j) => j.type === "bank")
              .map((j) => (
                <option key={j.id} value={j.id}>
                  {journalLabel(j)}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Gateway fee account" error={err("feeAccountId")} hint="Razorpay's fee and the GST on it are booked per payment; input IGST is claimed">
          <Select name="feeAccountId" defaultValue={v("feeAccountId", app ? app.feeAccountId : defaultFee)}>
            <option value="">Don't book fees</option>
            {options.expense.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="space-y-3 pt-6">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="emailInvoices" value="on" defaultChecked={state.values ? state.values.emailInvoices === "on" : (app?.emailInvoices ?? true)} />
            Email each invoice to the customer
          </label>
          {/* The hidden "off" comes first so an unticked box still sends a value; a ticked box overrides it. */}
          <input type="hidden" name="active" value="off" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" value="on" defaultChecked={state.values ? state.values.active === "on" : (app?.active ?? true)} />
            Active (events for a paused app are answered 410 and not booked)
          </label>
        </div>
      </div>
      <div className="flex justify-end">
        <Button disabled={pending}>{app ? "Save" : "Connect app"}</Button>
      </div>
    </form>
  );
}
