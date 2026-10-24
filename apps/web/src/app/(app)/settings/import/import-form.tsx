"use client";

import { formatINR } from "@tevah/core";
import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { Button, Card, FormError, Input, Table, Th } from "@/components/ui";
import { runOdooImport, type ImportState } from "./actions";

const LABELS: Record<string, string> = {
  contacts: "Contacts",
  products: "Products",
  accounts: "New ledger accounts",
  entries: "Journal entries",
  documents: "Invoices, bills and notes",
  projects: "Projects",
  tasks: "Tasks",
  timesheets: "Timesheet lines",
};

const money = (paise: number) => (paise < 0 ? `${formatINR(-paise)} Cr` : `${formatINR(paise)} Dr`);

export function ImportForm() {
  const [state, dispatch, pending] = useActionState<ImportState, FormData>(runOdooImport, {});
  // React clears the form after each action, so the chosen file is kept here for Import after Preview.
  const file = useRef<File | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const action = (data: FormData) => {
    if (file.current) data.set("file", file.current);
    dispatch(data);
  };
  const r = state.report;
  const nothingNew = r && Object.values(r.added).every((n) => n === 0);
  return (
    <div className="space-y-6">
      <Card>
        <form action={action} className="space-y-3">
          <Input
            type="file"
            name="file"
            accept=".json,application/json"
            className="max-w-md"
            onChange={(e) => {
              file.current = e.target.files?.[0] ?? null;
              setFileName(file.current?.name ?? null);
            }}
          />
          {fileName && <p className="text-xs text-stone-500">Selected: {fileName}</p>}
          <div className="flex flex-wrap gap-2">
            <Button name="mode" value="preview" variant="secondary" disabled={pending}>
              {pending ? "Working…" : "Preview"}
            </Button>
            <Button
              name="mode"
              value="import"
              disabled={pending || state.mode !== "preview" || !r || !fileName}
              onClick={(e) => {
                if (!window.confirm("Import this data into Tevah now?")) e.preventDefault();
              }}
            >
              Import
            </Button>
          </div>
          <p className="text-xs text-stone-500">Preview first. Import turns on once a preview has run.</p>
          <FormError message={state.error} />
        </form>
      </Card>

      {r && (
        <>
          <div
            className={`rounded-md border px-4 py-3 text-sm ${
              state.mode === "import" ? "border-green-200 bg-green-50 text-green-800" : "border-stone-200 bg-white text-stone-700"
            }`}
          >
            {state.mode === "import" ? <strong>Imported. </strong> : <strong>Preview only, nothing saved yet. </strong>}
            From {r.source}, exported {new Date(r.exportedAt).toLocaleString("en-IN")}.
            {r.alreadyImported > 0 && ` ${r.alreadyImported} entries were already imported earlier and are skipped.`}
            {nothingNew && " Everything in this file is already in Tevah."}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Table
              head={
                <tr>
                  <Th>{state.mode === "import" ? "Added" : "Will add"}</Th>
                  <Th className="text-right">Count</Th>
                </tr>
              }
            >
              {Object.entries(r.added).map(([k, n]) => (
                <tr key={k}>
                  <td>{LABELS[k] ?? k}</td>
                  <td className="text-right tabular-nums">{n}</td>
                </tr>
              ))}
            </Table>

            <div className="space-y-2">
              <div
                className={`rounded-md px-3 py-2 text-sm ${r.trialBalance.matches ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}
              >
                {r.trialBalance.matches
                  ? "✓ The imported ledger matches Odoo's trial balance, account by account."
                  : "The imported ledger doesn't match Odoo's trial balance. See the differences below."}
              </div>
              {r.otherEntries > 0 && (
                <p className="text-xs text-stone-500">
                  Tevah also has {r.otherEntries} posted entries that didn&apos;t come from Odoo. They&apos;re left out of this check but appear in your reports.
                </p>
              )}
            </div>
          </div>

          <section>
            <h2 className="mb-2 font-semibold">Trial balance check</h2>
            <Table
              head={
                <tr>
                  <Th>Tevah account</Th>
                  <Th className="text-right">Odoo</Th>
                  <Th className="text-right">Tevah</Th>
                  <Th className="text-right">Difference</Th>
                </tr>
              }
            >
              {r.trialBalance.rows.map((row) => (
                <tr key={row.account}>
                  <td>{row.account}</td>
                  <td className="text-right tabular-nums">{money(row.odoo)}</td>
                  <td className="text-right tabular-nums">{money(row.tevah)}</td>
                  <td className={`text-right tabular-nums ${row.difference ? "font-medium text-red-700" : "text-stone-400"}`}>
                    {row.difference ? formatINR(row.difference) : "—"}
                  </td>
                </tr>
              ))}
            </Table>
          </section>

          <section>
            <h2 className="mb-1 font-semibold">Parallel run check</h2>
            <p className="mb-3 text-sm text-stone-600">
              {r.onlyInTevah.length === 0 && r.trialBalance.matches
                ? "✓ Every posted entry in Tevah has a twin in Odoo."
                : "Entries are paired when they have the same date and post the same amounts to the same accounts."}
            </p>
            <div className="grid gap-6 lg:grid-cols-3">
              <EntryList title={`Already in both (${r.matched.length})`} empty="None typed into both yet.">
                {r.matched.map((e) => (
                  <tr key={e.odoo}>
                    <td>{e.odoo}</td>
                    <td>
                      <Link href={e.href} className="text-stone-500 underline">
                        {e.tevah}
                      </Link>
                    </td>
                    <td className="text-right tabular-nums">{formatINR(e.amount)}</td>
                  </tr>
                ))}
              </EntryList>
              <EntryList title={`Only in Odoo (${r.onlyInOdoo.length})`} empty="Nothing new in Odoo.">
                {r.onlyInOdoo.map((e) => (
                  <tr key={e.odoo}>
                    <td>{e.odoo}</td>
                    <td className="text-stone-500">{e.date}</td>
                    <td className="text-right tabular-nums">{formatINR(e.amount)}</td>
                  </tr>
                ))}
              </EntryList>
              <EntryList title={`Only in Tevah (${r.onlyInTevah.length})`} empty="Nothing missing from Odoo.">
                {r.onlyInTevah.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <Link href={e.href} className="underline">
                        {e.tevah}
                      </Link>
                    </td>
                    <td className="text-stone-500">{e.date}</td>
                    <td className="text-right tabular-nums">{formatINR(e.amount)}</td>
                  </tr>
                ))}
              </EntryList>
            </div>
            {r.onlyInTevah.length > 0 && (
              <p className="mt-2 text-xs text-stone-500">
                An entry only in Tevah usually means it was missed in Odoo or entered with a different date or amount. Fix whichever side is wrong and run the check again.
              </p>
            )}
          </section>

          <details className="text-sm">
            <summary className="cursor-pointer font-semibold">How Odoo accounts map to Tevah ({r.accountMap.length})</summary>
            <div className="mt-2">
              <Table
                head={
                  <tr>
                    <Th>Odoo account</Th>
                    <Th>Tevah account</Th>
                  </tr>
                }
              >
                {r.accountMap.map((a) => (
                  <tr key={a.odoo}>
                    <td>{a.odoo}</td>
                    <td>
                      {a.tevah}
                      {a.created && <span className="ml-2 text-xs text-stone-500">new</span>}
                    </td>
                  </tr>
                ))}
              </Table>
            </div>
          </details>

          {r.warnings.length > 0 && (
            <section>
              <h2 className="mb-2 font-semibold">Things to check ({r.warnings.length})</h2>
              <ul className="list-disc space-y-1 rounded-md border border-amber-200 bg-amber-50 py-3 pr-3 pl-8 text-sm text-amber-900">
                {r.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function EntryList({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium">{title}</h3>
      <div className="max-h-80 overflow-y-auto">
        <Table
          head={
            <tr>
              <Th>Entry</Th>
              <Th />
              <Th className="text-right">Amount</Th>
            </tr>
          }
          empty={children.length ? null : <p className="px-4 py-3 text-sm text-stone-500">{empty}</p>}
        >
          {children}
        </Table>
      </div>
    </div>
  );
}
