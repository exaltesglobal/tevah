"use client";

import { formatINR, rupeesToPaise } from "@tevah/core";
import { useActionState, useState } from "react";
import { Button, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import { emptyForm } from "@/lib/form";
import { saveJournal } from "./actions";

interface Option {
  id: string;
  label: string;
}

interface Row {
  key: number;
  accountId: string;
  contactId: string;
  description: string;
  debit: string;
  credit: string;
}

let nextKey = 1;
const blank = (): Row => ({ key: nextKey++, accountId: "", contactId: "", description: "", debit: "", credit: "" });

const paise = (v: string) => {
  try {
    return rupeesToPaise(v || "0");
  } catch {
    return 0;
  }
};

export function JournalForm({ accounts, contacts, today }: { accounts: Option[]; contacts: Option[]; today: string }) {
  const [state, action, pending] = useActionState(saveJournal, emptyForm);
  const [date, setDate] = useState(today);
  const [reference, setReference] = useState("");
  const [narration, setNarration] = useState("");
  const [rows, setRows] = useState<Row[]>([blank(), blank()]);
  const set = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const debits = rows.reduce((n, r) => n + paise(r.debit), 0);
  const credits = rows.reduce((n, r) => n + paise(r.credit), 0);
  const diff = debits - credits;
  const err = (k: string) => state.fieldErrors?.[k];
  const payload = JSON.stringify({
    date,
    reference: reference || null,
    narration,
    lines: rows.map(({ accountId, contactId, description, debit, credit }) => ({ accountId, contactId, description: description || null, debit, credit })),
  });

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="payload" value={payload} />
      <FormError message={state.error} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Date" error={err("date")}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Reference" hint="Optional, e.g. a bank reference">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />
        </Field>
      </div>
      <Field label="Narration" error={err("narration")}>
        <Textarea value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="e.g. Depreciation on computers for 2026-27" required />
      </Field>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="py-2 text-left font-medium">Account</th>
              <th className="py-2 text-left font-medium">Contact</th>
              <th className="py-2 text-left font-medium">Line note</th>
              <th className="w-36 py-2 text-right font-medium">Debit</th>
              <th className="w-36 py-2 text-right font-medium">Credit</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} className="align-top">
                <td className="py-1 pr-2">
                  <Select value={r.accountId} onChange={(e) => set(r.key, { accountId: e.target.value })} aria-label="Account">
                    <option value="">Choose…</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </Select>
                  {err(`lines.${i}.accountId`) && <span className="text-xs text-red-600">{err(`lines.${i}.accountId`)}</span>}
                  {err(`lines.${i}`) && <span className="text-xs text-red-600">{err(`lines.${i}`)}</span>}
                </td>
                <td className="py-1 pr-2">
                  <Select value={r.contactId} onChange={(e) => set(r.key, { contactId: e.target.value })} aria-label="Contact">
                    <option value="">—</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="py-1 pr-2">
                  <Input value={r.description} onChange={(e) => set(r.key, { description: e.target.value })} aria-label="Line note" />
                </td>
                <td className="py-1 pr-2">
                  <Input inputMode="decimal" className="text-right" value={r.debit} onChange={(e) => set(r.key, { debit: e.target.value, credit: e.target.value ? "" : r.credit })} aria-label="Debit" />
                </td>
                <td className="py-1 pr-2">
                  <Input inputMode="decimal" className="text-right" value={r.credit} onChange={(e) => set(r.key, { credit: e.target.value, debit: e.target.value ? "" : r.debit })} aria-label="Credit" />
                </td>
                <td className="py-1">
                  {rows.length > 2 && (
                    <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="px-2 py-2 text-stone-400 hover:text-red-600" aria-label="Remove line">
                      ×
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="py-2">
                <button type="button" onClick={() => setRows((rs) => [...rs, blank()])} className="text-sm font-medium text-brand-700 hover:underline">
                  + Add line
                </button>
              </td>
              <td />
              <td className="py-2 text-right">Total</td>
              <td className="py-2 pr-2 text-right tabular-nums">{formatINR(debits)}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{formatINR(credits)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="flex items-center justify-end gap-4">
        <span className={`text-sm ${diff === 0 ? "text-green-800" : "text-amber-800"}`}>
          {diff === 0 ? (debits ? "Balanced" : "") : `Difference ${formatINR(Math.abs(diff), { symbol: true })} ${diff > 0 ? "more debit" : "more credit"}`}
        </span>
        <Button disabled={pending || diff !== 0 || debits === 0}>{pending ? "Posting…" : "Post entry"}</Button>
      </div>
    </form>
  );
}
