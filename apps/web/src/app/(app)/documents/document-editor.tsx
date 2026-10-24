"use client";

import {
  autoHsn,
  computeDocument,
  formatINR,
  GST_RATES_BPS,
  isSalesDocument,
  mulRound,
  rupeesToPaise,
  stateName,
  suggestHsn,
  supplyType,
  type DocumentType,
} from "@tevah/core";
import { useActionState, useMemo, useState } from "react";
import { HsnChips } from "@/components/hsn-suggest";
import { Button, ButtonLink, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import { STATE_OPTIONS } from "@/lib/contacts";
import { SIDES, sideOf, TYPE_LABEL } from "@/lib/doc-kinds";
import { emptyForm } from "@/lib/form";
import { formatRate } from "@/lib/products";
import { saveDocument } from "./actions";
import { blankLine, type DocState, type LineState } from "./doc-state";
import type { EditorData } from "./editor-data";

const paiseOr0 = (v: string) => {
  try {
    return rupeesToPaise(v || "0");
  } catch {
    return 0;
  }
};
const toRupees = (paise: number) => (paise ? (paise / 100).toFixed(2) : "");
const blankToNull = (v: string) => (v.trim() === "" ? null : v.trim());

export function DocumentEditor({
  type,
  id,
  initial,
  orgStateCode,
  data,
}: {
  type: DocumentType;
  id: string | null;
  initial: DocState;
  orgStateCode: string;
  data: EditorData;
}) {
  const sales = isSalesDocument(type);
  const isNote = type === "credit_note" || type === "debit_note";
  const side = SIDES[sideOf(type)];
  const [doc, setDoc] = useState(initial);
  const [state, action, pending] = useActionState(saveDocument.bind(null, type, id), emptyForm);
  const err = (k: string) => state.fieldErrors?.[k];

  const set = <K extends keyof DocState>(key: K, value: DocState[K]) => setDoc((d) => ({ ...d, [key]: value }));
  const setLine = (key: string, patch: Partial<LineState>) =>
    setDoc((d) => ({ ...d, lines: d.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));

  function chooseContact(contactId: string) {
    const c = data.contacts.find((x) => x.id === contactId);
    setDoc((d) => {
      // Sales: tax follows the customer's state. Purchases: we are the place of supply.
      const pos = sales ? (c?.stateCode ?? orgStateCode) : orgStateCode;
      const supplier = sales ? orgStateCode : (c?.stateCode ?? orgStateCode);
      return {
        ...d,
        contactId,
        placeOfSupply: pos,
        supplyType: supplyType(supplier, pos),
        tdsRate: !sales && c?.tdsRateBps ? String(c.tdsRateBps / 100) : d.tdsRate,
        originalDocumentId: "",
      };
    });
  }

  /** Description edits re-guess the HSN/SAC, unless the user picked a product or typed a code. */
  function describe(line: LineState, description: string) {
    const ours = line.hsnSac === "" || line.hsnSac === line.autoHsn;
    if (line.productId || !ours) return setLine(line.key, { description });
    const code = autoHsn(description, { history: data.products })?.code ?? "";
    setLine(line.key, { description, hsnSac: code, autoHsn: code || undefined });
  }

  function chooseProduct(key: string, productId: string) {
    const p = data.products.find((x) => x.id === productId);
    setLine(
      key,
      p
        ? { productId, description: p.name, hsnSac: p.hsnSac ?? "", unit: p.unit, unitPrice: toRupees(p.price), gstRateBps: String(p.gstRateBps) }
        : { productId: "" },
    );
  }

  const totals = useMemo(
    () =>
      computeDocument(
        doc.lines.map((l) => ({
          quantity: Number(l.quantity) > 0 ? Number(l.quantity) : 0,
          unitPrice: paiseOr0(l.unitPrice),
          discountBps: Math.round(Math.min(Math.max(Number(l.discount) || 0, 0), 100) * 100),
          gstRateBps: Number(l.gstRateBps),
        })),
        { type: doc.supplyType, reverseCharge: doc.reverseCharge },
      ),
    [doc.lines, doc.supplyType, doc.reverseCharge],
  );
  const tdsBps = Math.round((Number(doc.tdsRate) || 0) * 100);
  const tds = sales ? 0 : mulRound(totals.taxable, tdsBps, 10000);

  const payload = JSON.stringify({
    contactId: doc.contactId,
    date: doc.date,
    dueDate: blankToNull(doc.dueDate),
    placeOfSupply: doc.placeOfSupply,
    supplyType: doc.supplyType,
    reverseCharge: doc.reverseCharge,
    vendorReference: blankToNull(doc.vendorReference),
    originalDocumentId: blankToNull(doc.originalDocumentId),
    tdsSection: blankToNull(doc.tdsSection),
    tdsRate: doc.tdsRate,
    notes: blankToNull(doc.notes),
    lines: doc.lines.map((l) => ({
      productId: blankToNull(l.productId),
      description: l.description,
      hsnSac: blankToNull(l.hsnSac),
      quantity: l.quantity,
      unit: l.unit || "NOS",
      unitPrice: l.unitPrice,
      discount: l.discount,
      gstRateBps: l.gstRateBps,
      accountId: blankToNull(l.accountId),
    })),
  });

  const originals = data.originals.filter((o) => o.contactId === doc.contactId);

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="payload" value={payload} />
      <FormError message={state.error} />

      <div className="grid gap-4 rounded-lg border border-stone-200 bg-white p-5 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={side.contactLabel} error={err("contactId")} className="sm:col-span-2">
          <Select value={doc.contactId} onChange={(e) => chooseContact(e.target.value)} required>
            <option value="">Choose…</option>
            {data.contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.gstin ? ` · ${c.gstin}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date" error={err("date")}>
          <Input type="date" value={doc.date} onChange={(e) => set("date", e.target.value)} required />
        </Field>
        <Field label="Due date" error={err("dueDate")}>
          <Input type="date" value={doc.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
        </Field>
        <Field label="Place of supply" error={err("placeOfSupply")}>
          <Select
            value={doc.placeOfSupply}
            onChange={(e) => {
              const pos = e.target.value;
              const contactState = data.contacts.find((c) => c.id === doc.contactId)?.stateCode ?? orgStateCode;
              setDoc((d) => ({ ...d, placeOfSupply: pos, supplyType: supplyType(sales ? orgStateCode : contactState, pos) }));
            }}
          >
            {STATE_OPTIONS.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tax type" hint={doc.supplyType === "intra" ? "Within the state" : "Between states"}>
          <Select value={doc.supplyType} onChange={(e) => set("supplyType", e.target.value as "intra" | "inter")}>
            <option value="intra">CGST + SGST</option>
            <option value="inter">IGST</option>
          </Select>
        </Field>
        {!sales && (
          <Field label="Vendor's bill number" error={err("vendorReference")}>
            <Input value={doc.vendorReference} onChange={(e) => set("vendorReference", e.target.value)} maxLength={50} />
          </Field>
        )}
        {isNote && (
          <Field label={`Against ${sales ? "invoice" : "bill"}`} error={err("originalDocumentId")} hint="Optional; settles it">
            <Select value={doc.originalDocumentId} onChange={(e) => set("originalDocumentId", e.target.value)}>
              <option value="">None</option>
              {originals.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.number} · {o.date}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-stone-700">
          <input type="checkbox" checked={doc.reverseCharge} onChange={(e) => set("reverseCharge", e.target.checked)} />
          Reverse charge
        </label>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white">
        <div className="hidden grid-cols-[2fr_5rem_5rem_6rem_4rem_6rem_7rem_2rem] gap-2 border-b border-stone-200 bg-stone-50 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-stone-500 lg:grid">
          <span>Item</span>
          <span>Qty</span>
          <span>Unit</span>
          <span>Rate ₹</span>
          <span>Disc %</span>
          <span>GST</span>
          <span className="text-right">Amount</span>
          <span />
        </div>
        {doc.lines.map((l, i) => {
          const lineErr = (k: string) => err(`lines.${i}.${k}`);
          const t = totals.lines[i];
          return (
            <div key={l.key} className="space-y-2 border-b border-stone-100 px-4 py-3 last:border-b-0">
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-[2fr_5rem_5rem_6rem_4rem_6rem_7rem_2rem] lg:items-start">
                <div className="col-span-2 space-y-2 lg:col-span-1">
                  <Select aria-label="Product" value={l.productId} onChange={(e) => chooseProduct(l.key, e.target.value)}>
                    <option value="">Pick a product or type below…</option>
                    {data.products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                  <Input
                    aria-label="Description"
                    placeholder="Description"
                    value={l.description}
                    onChange={(e) => describe(l, e.target.value)}
                  />
                  {lineErr("description") && <p className="text-xs text-red-600">{lineErr("description")}</p>}
                </div>
                <LineInput label="Qty" value={l.quantity} error={lineErr("quantity")} onChange={(v) => setLine(l.key, { quantity: v })} />
                <LineInput label="Unit" value={l.unit} onChange={(v) => setLine(l.key, { unit: v.toUpperCase() })} />
                <LineInput label="Rate ₹" value={l.unitPrice} error={lineErr("unitPrice")} onChange={(v) => setLine(l.key, { unitPrice: v })} />
                <LineInput label="Disc %" value={l.discount} error={lineErr("discount")} onChange={(v) => setLine(l.key, { discount: v })} />
                <label className="block">
                  <span className="mb-1 block text-xs text-stone-500 lg:hidden">GST</span>
                  <Select value={l.gstRateBps} onChange={(e) => setLine(l.key, { gstRateBps: e.target.value })}>
                    {GST_RATES_BPS.map((r) => (
                      <option key={r} value={r}>
                        {formatRate(r)}
                      </option>
                    ))}
                  </Select>
                </label>
                <div className="self-center text-right text-sm tabular-nums">
                  <span className="text-xs text-stone-500 lg:hidden">Amount </span>
                  {formatINR(t?.taxable ?? 0)}
                </div>
                <button
                  type="button"
                  aria-label="Remove line"
                  className="self-center justify-self-end text-lg text-stone-400 hover:text-red-600 disabled:opacity-30"
                  disabled={doc.lines.length === 1}
                  onClick={() => setDoc((d) => ({ ...d, lines: d.lines.filter((x) => x.key !== l.key) }))}
                >
                  ×
                </button>
              </div>
              <details className="text-xs text-stone-500">
                <summary className="cursor-pointer select-none">
                  HSN/SAC {l.hsnSac || "—"}
                  {l.hsnSac && l.hsnSac === l.autoHsn && <span className="text-brand-700"> (suggested from the description)</span>} · account
                </summary>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <Field label="HSN / SAC" error={lineErr("hsnSac")}>
                    <Input value={l.hsnSac} inputMode="numeric" maxLength={8} onChange={(e) => setLine(l.key, { hsnSac: e.target.value })} />
                    {!l.productId && (
                      <HsnChips
                        suggestions={suggestHsn(l.description, { history: data.products })}
                        value={l.hsnSac}
                        auto={l.hsnSac !== "" && l.hsnSac === l.autoHsn}
                        onPick={(code) => setLine(l.key, { hsnSac: code })}
                        from="description"
                      />
                    )}
                  </Field>
                  <Field label="Account">
                    <Select value={l.accountId} onChange={(e) => setLine(l.key, { accountId: e.target.value })}>
                      <option value="">Product or default account</option>
                      {data.accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} {a.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              </details>
            </div>
          );
        })}
        <div className="px-4 py-3">
          <Button type="button" variant="secondary" onClick={() => set("lines", [...doc.lines, blankLine()])}>
            Add line
          </Button>
          {err("lines") && <span className="ml-3 text-xs text-red-600">{err("lines")}</span>}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          {!sales && (
            <div className="grid gap-4 rounded-lg border border-stone-200 bg-white p-5 sm:grid-cols-2">
              <Field label="TDS rate %" error={err("tdsRate")} hint="Deducted from the value before GST">
                <Input value={doc.tdsRate} inputMode="decimal" onChange={(e) => set("tdsRate", e.target.value)} />
              </Field>
              <Field label="TDS section" error={err("tdsSection")} hint="e.g. 194J, 194C">
                <Input value={doc.tdsSection} onChange={(e) => set("tdsSection", e.target.value.toUpperCase())} maxLength={20} />
              </Field>
            </div>
          )}
          <Field label="Notes" error={err("notes")}>
            <Textarea value={doc.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Shown on the document" />
          </Field>
        </div>
        <dl className="space-y-1.5 rounded-lg border border-stone-200 bg-white p-5 text-sm">
          <Row label="Taxable value" value={totals.taxable} />
          {doc.supplyType === "intra" ? (
            <>
              <Row label="CGST" value={totals.cgst} />
              <Row label="SGST" value={totals.sgst} />
            </>
          ) : (
            <Row label="IGST" value={totals.igst} />
          )}
          {doc.reverseCharge && <p className="text-xs text-amber-700">Reverse charge: GST is paid by the recipient.</p>}
          <Row label="Round off" value={totals.roundOff} />
          <Row label="Total" value={totals.total} strong />
          {tds > 0 && (
            <>
              <Row label="TDS deducted" value={-tds} />
              <Row label="Payable to vendor" value={totals.total - tds} strong />
            </>
          )}
          <p className="pt-1 text-xs text-stone-500">Place of supply: {stateName(doc.placeOfSupply)}</p>
        </dl>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <ButtonLink href={id ? `/${sideOf(type)}/${id}` : `/${sideOf(type)}`} variant="secondary">
          Cancel
        </ButtonLink>
        <Button name="intent" value="draft" variant="secondary" disabled={pending}>
          Save draft
        </Button>
        <Button name="intent" value="post" disabled={pending}>
          Save and post {TYPE_LABEL[type].toLowerCase()}
        </Button>
      </div>
    </form>
  );
}

function LineInput({ label, value, error, onChange }: { label: string; value: string; error?: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-stone-500 lg:hidden">{label}</span>
      <Input aria-label={label} value={value} inputMode="decimal" onChange={(e) => onChange(e.target.value)} />
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? "border-t border-stone-200 pt-1.5 font-semibold" : ""}`}>
      <dt className={strong ? undefined : "text-stone-500"}>{label}</dt>
      <dd className="tabular-nums">{formatINR(value, { symbol: true })}</dd>
    </div>
  );
}
