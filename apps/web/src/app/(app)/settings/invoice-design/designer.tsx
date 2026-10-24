"use client";

import QRCode from "qrcode";
import { useActionState, useEffect, useState, type ReactNode } from "react";
import { InvoicePrint, type PrintDoc, type PrintLine, type PrintParty } from "@/components/invoice-print";
import { Button, Field, FormError, Input, Textarea } from "@/components/ui";
import { emptyForm } from "@/lib/form";
import {
  ACCENT_PRESETS,
  DEFAULT_DESIGN,
  INVOICE_TEMPLATES,
  TEMPLATE_INFO,
  upiPayLink,
  type InvoiceDesign,
} from "@/lib/invoice-design";
import { saveInvoiceDesign } from "./actions";

type Toggle = "showHsn" | "showDiscount" | "showAmountInWords" | "showUpiQr";
const TOGGLES: { key: Toggle; label: string; hint: string }[] = [
  { key: "showHsn", label: "HSN / SAC column", hint: "Required on B2B invoices above ₹5 Cr turnover" },
  { key: "showDiscount", label: "Discount column", hint: "Only appears when a line has a discount" },
  { key: "showAmountInWords", label: "Amount in words", hint: "e.g. Rupees One Lakh Twenty Thousand Only" },
  { key: "showUpiQr", label: "UPI QR code", hint: "Customers scan to pay the amount due" },
];

/** Shrinks an uploaded image so it stays small in the database and in every printed page. */
async function toDataUrl(file: File, maxW: number, maxH: number): Promise<string> {
  const original = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  if (file.type === "image/svg+xml") return original;
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("That file isn't an image Tevah can read"));
    el.src = original;
  });
  // Twice the printed size keeps it sharp on paper.
  const scale = Math.min(1, (maxW * 2) / img.width, (maxH * 2) / img.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

export function Designer({
  initial,
  canEdit,
  seller,
  sample,
}: {
  initial: InvoiceDesign;
  canEdit: boolean;
  seller: PrintParty;
  sample: { doc: PrintDoc; lines: PrintLine[]; buyer: PrintParty };
}) {
  const [design, setDesign] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [state, action, pending] = useActionState(saveInvoiceDesign, emptyForm);
  const [qr, setQr] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const err = (k: string) => state.fieldErrors?.[k];
  const set = <K extends keyof InvoiceDesign>(key: K, value: InvoiceDesign[K]) => setDesign((d) => ({ ...d, [key]: value }));
  const text = (key: keyof InvoiceDesign) => (design[key] as string | null) ?? "";
  const dirty = JSON.stringify(design) !== JSON.stringify(saved);

  useEffect(() => {
    if (state.saved) setSaved(design);
    // Only when a save completes, not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    if (!design.upiId) return setQr(null);
    const link = upiPayLink({
      upiId: design.upiId,
      payee: seller.legalName ?? seller.name,
      amountPaise: sample.doc.total,
      note: `Invoice ${sample.doc.number}`,
    });
    QRCode.toString(link, { type: "svg", margin: 0, errorCorrectionLevel: "M" }).then(setQr, () => setQr(null));
  }, [design.upiId, seller, sample.doc]);

  async function upload(key: "logo" | "signature", file: File | undefined) {
    if (!file) return;
    setUploadError(null);
    if (file.size > 5_000_000) return setUploadError("Pick an image under 5 MB.");
    try {
      const url = key === "logo" ? await toDataUrl(file, 240, 96) : await toDataUrl(file, 240, 80);
      if (url.length > 700_000) return setUploadError("That image is still too large after resizing. Try a simpler PNG or SVG.");
      set(key, url);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Could not read that image.");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[22rem_1fr] lg:items-start">
      <form action={action} className="space-y-4">
        <input type="hidden" name="payload" value={JSON.stringify(design)} />
        <FormError message={state.error} />
        {!canEdit && <p className="rounded-md bg-stone-100 px-3 py-2 text-sm text-stone-600">Only an admin can change the invoice design.</p>}

        <fieldset disabled={!canEdit} className="space-y-4">
          <Section title="Layout">
            <div className="grid gap-2">
              {INVOICE_TEMPLATES.map((t) => (
                <label
                  key={t}
                  className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition ${
                    design.template === t ? "border-brand-600 bg-brand-50" : "border-stone-200 hover:border-stone-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="template"
                    className="mt-0.5 accent-brand-600"
                    checked={design.template === t}
                    onChange={() => set("template", t)}
                  />
                  <span>
                    <span className="block font-medium">{TEMPLATE_INFO[t].label}</span>
                    <span className="text-stone-500">{TEMPLATE_INFO[t].description}</span>
                  </span>
                </label>
              ))}
            </div>
          </Section>

          <Section title="Accent colour">
            <div className="flex flex-wrap items-center gap-2">
              {ACCENT_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Use ${c}`}
                  aria-pressed={design.accentColor === c}
                  onClick={() => set("accentColor", c)}
                  className={`h-8 w-8 rounded-full border-2 ${design.accentColor === c ? "border-stone-900 ring-2 ring-white ring-inset" : "border-transparent"}`}
                  style={{ background: c }}
                />
              ))}
              <label className="ml-1 flex items-center gap-2 text-sm text-stone-600">
                <input
                  type="color"
                  value={design.accentColor}
                  onChange={(e) => set("accentColor", e.target.value.toUpperCase())}
                  className="h-8 w-10 cursor-pointer rounded border border-stone-300 bg-white"
                />
                <span className="font-mono text-xs">{design.accentColor}</span>
              </label>
            </div>
            {err("accentColor") && <p className="mt-1 text-xs text-red-600">{err("accentColor")}</p>}
          </Section>

          <Section title="Logo">
            <ImagePicker
              value={design.logo}
              alt="Logo"
              onPick={(f) => upload("logo", f)}
              onClear={() => set("logo", null)}
              hint="PNG, JPEG or SVG. A wide logo on a transparent background prints best."
            />
            {err("logo") && <p className="mt-1 text-xs text-red-600">{err("logo")}</p>}
          </Section>

          <Section title="Show on the invoice">
            <div className="space-y-2.5">
              {TOGGLES.map((t) => (
                <label key={t.key} className="flex cursor-pointer items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-brand-600"
                    checked={design[t.key]}
                    onChange={(e) => set(t.key, e.target.checked)}
                  />
                  <span>
                    <span className="block font-medium text-stone-800">{t.label}</span>
                    <span className="text-xs text-stone-500">{t.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </Section>

          <Section title="Bank and UPI" hint="Printed on tax invoices so customers know where to pay">
            <div className="grid gap-3">
              <Field label="Account name" error={err("bankAccountName")}>
                <Input value={text("bankAccountName")} onChange={(e) => set("bankAccountName", e.target.value)} maxLength={200} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Bank" error={err("bankName")}>
                  <Input value={text("bankName")} onChange={(e) => set("bankName", e.target.value)} maxLength={100} placeholder="HDFC Bank" />
                </Field>
                <Field label="Branch" error={err("bankBranch")}>
                  <Input value={text("bankBranch")} onChange={(e) => set("bankBranch", e.target.value)} maxLength={100} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Account number" error={err("bankAccountNumber")}>
                  <Input
                    value={text("bankAccountNumber")}
                    inputMode="numeric"
                    onChange={(e) => set("bankAccountNumber", e.target.value.replace(/\s/g, ""))}
                    maxLength={30}
                  />
                </Field>
                <Field label="IFSC" error={err("bankIfsc")}>
                  <Input
                    value={text("bankIfsc")}
                    className="uppercase"
                    onChange={(e) => set("bankIfsc", e.target.value.toUpperCase())}
                    maxLength={11}
                    placeholder="HDFC0001234"
                  />
                </Field>
              </div>
              <Field label="UPI ID" error={err("upiId")} hint="Turns on the scan-to-pay QR code">
                <Input value={text("upiId")} onChange={(e) => set("upiId", e.target.value.trim())} maxLength={100} placeholder="exaltes@okhdfcbank" />
              </Field>
            </div>
          </Section>

          <Section title="Terms and footer">
            <div className="grid gap-3">
              <Field label="Terms and conditions" error={err("terms")}>
                <Textarea
                  value={text("terms")}
                  onChange={(e) => set("terms", e.target.value)}
                  rows={4}
                  maxLength={2000}
                  placeholder={"1. Payment due within 30 days.\n2. Interest at 18% p.a. on late payment."}
                />
              </Field>
              <Field label="Footer line" error={err("footer")} hint="e.g. a thank-you note or your website">
                <Input value={text("footer")} onChange={(e) => set("footer", e.target.value)} maxLength={300} />
              </Field>
            </div>
          </Section>

          <Section title="Signature">
            <ImagePicker
              value={design.signature}
              alt="Signature"
              onPick={(f) => upload("signature", f)}
              onClear={() => set("signature", null)}
              hint="A scan of your signature or company stamp, ideally on a transparent background."
            />
            {err("signature") && <p className="mt-1 text-xs text-red-600">{err("signature")}</p>}
            <Field label="Signatory label" error={err("signatoryLabel")} className="mt-3">
              <Input
                value={text("signatoryLabel")}
                onChange={(e) => set("signatoryLabel", e.target.value)}
                maxLength={100}
                placeholder="Authorised signatory"
              />
            </Field>
          </Section>
          {uploadError && <FormError message={uploadError} />}
        </fieldset>

        {canEdit && (
          <div className="sticky bottom-0 -mx-1 flex items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white/95 px-4 py-3 backdrop-blur">
            <span className="text-sm text-stone-500">
              {pending ? "Saving…" : dirty ? "Unsaved changes" : state.saved ? "Saved" : "No changes"}
            </span>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => setDesign(DEFAULT_DESIGN)} disabled={pending}>
                Reset
              </Button>
              <Button disabled={pending || !dirty}>Save design</Button>
            </div>
          </div>
        )}
      </form>

      <div className="lg:sticky lg:top-6">
        <div className="mb-2 flex items-center justify-between text-xs text-stone-500">
          <span className="font-medium tracking-wide uppercase">Live preview</span>
          <span>Sample invoice; your real invoices use their own details</span>
        </div>
        <div className="rounded-lg bg-stone-200/60 p-3 sm:p-5">
          <div className="mx-auto max-w-[52rem] shadow-sm">
            <InvoicePrint design={design} doc={sample.doc} lines={sample.lines} seller={seller} buyer={sample.buyer} sales upiQrSvg={qr} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-stone-500">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function ImagePicker({
  value,
  alt,
  hint,
  onPick,
  onClear,
}: {
  value: string | null;
  alt: string;
  hint: string;
  onPick: (file: File | undefined) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-16 w-28 shrink-0 items-center justify-center rounded-md border border-dashed border-stone-300 bg-stone-50">
        {value ? <img src={value} alt={alt} className="max-h-14 max-w-24 object-contain" /> : <span className="text-xs text-stone-400">None</span>}
      </div>
      <div className="min-w-0 space-y-1.5">
        <div className="flex gap-2">
          <label className="inline-flex cursor-pointer items-center rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-stone-100">
            {value ? "Replace" : "Upload"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="sr-only"
              onChange={(e) => {
                onPick(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          {value && (
            <button type="button" onClick={onClear} className="text-sm text-stone-500 hover:text-red-600">
              Remove
            </button>
          )}
        </div>
        <p className="text-xs text-stone-500">{hint}</p>
      </div>
    </div>
  );
}
