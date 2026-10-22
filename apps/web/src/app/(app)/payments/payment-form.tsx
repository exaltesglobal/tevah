"use client";

import { formatINR, rupeesToPaise } from "@tevah/core";
import { useActionState, useState } from "react";
import { Button, ButtonLink, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import { emptyForm } from "@/lib/form";
import type { PaymentDirection } from "@/lib/payments";
import { savePayment } from "./actions";

export interface OpenDocument {
  id: string;
  number: string;
  contactId: string;
  date: string;
  outstanding: number;
}

export interface PaymentFormState {
  contactId: string;
  date: string;
  journalId: string;
  amount: string;
  tds: string;
  reference: string;
  notes: string;
  allocations: Record<string, string>;
}

const paiseOr0 = (v: string) => {
  try {
    return rupeesToPaise(v || "0");
  } catch {
    return 0;
  }
};
const toRupees = (paise: number) => (paise > 0 ? (paise / 100).toFixed(2) : "");

/** Settle the oldest documents first, up to the money available. */
function autoAllocate(docs: OpenDocument[], available: number): Record<string, string> {
  const out: Record<string, string> = {};
  let left = available;
  for (const d of [...docs].sort((a, b) => a.date.localeCompare(b.date))) {
    const take = Math.min(left, d.outstanding);
    out[d.id] = toRupees(take);
    left -= take;
  }
  return out;
}

export function PaymentForm({
  direction,
  initial,
  contacts,
  journals,
  openDocuments,
}: {
  direction: PaymentDirection;
  initial: PaymentFormState;
  contacts: { id: string; name: string }[];
  journals: { id: string; name: string }[];
  openDocuments: OpenDocument[];
}) {
  const received = direction === "received";
  const [form, setForm] = useState(initial);
  const [touched, setTouched] = useState(false);
  const [state, action, pending] = useActionState(savePayment.bind(null, direction), emptyForm);
  const err = (k: string) => state.fieldErrors?.[k];

  const docs = openDocuments.filter((d) => d.contactId === form.contactId);
  const available = paiseOr0(form.amount) + (received ? paiseOr0(form.tds) : 0);
  const allocated = docs.reduce((n, d) => n + paiseOr0(form.allocations[d.id] ?? ""), 0);

  function update(patch: Partial<PaymentFormState>) {
    setForm((f) => {
      const next = { ...f, ...patch };
      if (!touched || patch.contactId !== undefined) {
        const nextDocs = openDocuments.filter((d) => d.contactId === next.contactId);
        next.allocations = autoAllocate(nextDocs, paiseOr0(next.amount) + (received ? paiseOr0(next.tds) : 0));
      }
      return next;
    });
  }

  const payload = JSON.stringify({
    contactId: form.contactId,
    date: form.date,
    journalId: form.journalId,
    amount: form.amount,
    tds: received ? form.tds : "",
    reference: form.reference.trim() || null,
    notes: form.notes.trim() || null,
    allocations: docs.map((d) => ({ documentId: d.id, amount: form.allocations[d.id] ?? "" })),
  });

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="payload" value={payload} />
      <FormError message={state.error} />
      <div className="grid gap-4 rounded-lg border border-stone-200 bg-white p-5 sm:grid-cols-2">
        <Field label={received ? "Received from" : "Paid to"} error={err("contactId")} className="sm:col-span-2">
          <Select value={form.contactId} onChange={(e) => update({ contactId: e.target.value })} required>
            <option value="">Choose…</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date" error={err("date")}>
          <Input type="date" value={form.date} onChange={(e) => update({ date: e.target.value })} required />
        </Field>
        <Field label={received ? "Deposited in" : "Paid from"} error={err("journalId")}>
          <Select value={form.journalId} onChange={(e) => update({ journalId: e.target.value })}>
            {journals.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={received ? "Amount received (₹)" : "Amount paid (₹)"} error={err("amount")}>
          <Input value={form.amount} inputMode="decimal" onChange={(e) => update({ amount: e.target.value })} required />
        </Field>
        {received && (
          <Field label="TDS deducted by customer (₹)" error={err("tds")} hint="Claimable against your income tax">
            <Input value={form.tds} inputMode="decimal" onChange={(e) => update({ tds: e.target.value })} />
          </Field>
        )}
        <Field label="Reference" error={err("reference")} hint="UTR, cheque or UPI reference">
          <Input value={form.reference} onChange={(e) => update({ reference: e.target.value })} maxLength={100} />
        </Field>
        <Field label="Notes" error={err("notes")} className="sm:col-span-2">
          <Textarea value={form.notes} rows={2} onChange={(e) => update({ notes: e.target.value })} />
        </Field>
      </div>

      {form.contactId && (
        <div className="rounded-lg border border-stone-200 bg-white">
          <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2.5 text-sm">
            <span className="font-medium">{received ? "Invoices" : "Bills"} to settle</span>
            <span className={allocated > available ? "text-red-600" : "text-stone-500"}>
              Allocated {formatINR(allocated, { symbol: true })} of {formatINR(available, { symbol: true })}
            </span>
          </div>
          {docs.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-stone-500">Nothing outstanding. This will be recorded as an advance.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-stone-100 [&_td]:px-4 [&_td]:py-2">
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td className="font-medium">{d.number}</td>
                    <td className="tabular-nums text-stone-500">{d.date}</td>
                    <td className="text-right tabular-nums">Due {formatINR(d.outstanding)}</td>
                    <td className="w-40">
                      <Input
                        aria-label={`Settle ${d.number}`}
                        value={form.allocations[d.id] ?? ""}
                        inputMode="decimal"
                        onChange={(e) => {
                          setTouched(true);
                          setForm((f) => ({ ...f, allocations: { ...f.allocations, [d.id]: e.target.value } }));
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <ButtonLink href="/payments" variant="secondary">
          Cancel
        </ButtonLink>
        <Button disabled={pending}>{received ? "Record receipt" : "Record payment"}</Button>
      </div>
    </form>
  );
}
