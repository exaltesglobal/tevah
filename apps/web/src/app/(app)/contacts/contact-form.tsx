"use client";

import { useActionState } from "react";
import { Button, ButtonLink, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import type { contacts } from "@/db/schema";
import { STATE_OPTIONS } from "@/lib/contacts";
import { emptyForm } from "@/lib/form";
import { saveContact } from "./actions";

type Contact = typeof contacts.$inferSelect;

export function ContactForm({ contact }: { contact?: Contact }) {
  const [state, action, pending] = useActionState(saveContact.bind(null, contact?.id ?? null), emptyForm);
  const err = (k: string) => state.fieldErrors?.[k];
  const v = (k: string, fallback: string | undefined) => state.values?.[k] ?? fallback;
  return (
    <form action={action} className="space-y-6">
      <FormError message={state.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={err("name")} className="sm:col-span-2">
          <Input name="name" defaultValue={v("name", contact?.name)} required />
        </Field>
        <Field label="Type" error={err("kind")}>
          <Select name="kind" defaultValue={v("kind", contact?.kind ?? "customer")}>
            <option value="customer">Customer</option>
            <option value="vendor">Vendor</option>
            <option value="both">Customer and vendor</option>
          </Select>
        </Field>
        <Field label="GSTIN" error={err("gstin")} hint="Fills in state and PAN automatically">
          <Input name="gstin" defaultValue={v("gstin", contact?.gstin ?? "")} className="uppercase" maxLength={15} />
        </Field>
        <Field label="PAN" error={err("pan")}>
          <Input name="pan" defaultValue={v("pan", contact?.pan ?? "")} className="uppercase" maxLength={10} />
        </Field>
        <Field label="State (place of supply)" error={err("stateCode")}>
          <Select name="stateCode" defaultValue={v("stateCode", contact?.stateCode ?? "")}>
            <option value="">Not set</option>
            {STATE_OPTIONS.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name} ({s.code})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Email" error={err("email")}>
          <Input name="email" type="email" defaultValue={v("email", contact?.email ?? "")} />
        </Field>
        <Field label="Phone / WhatsApp" error={err("phone")}>
          <Input name="phone" defaultValue={v("phone", contact?.phone ?? "")} />
        </Field>
        <Field label="Address line 1" error={err("addressLine1")} className="sm:col-span-2">
          <Input name="addressLine1" defaultValue={v("addressLine1", contact?.addressLine1 ?? "")} />
        </Field>
        <Field label="Address line 2" error={err("addressLine2")} className="sm:col-span-2">
          <Input name="addressLine2" defaultValue={v("addressLine2", contact?.addressLine2 ?? "")} />
        </Field>
        <Field label="City" error={err("city")}>
          <Input name="city" defaultValue={v("city", contact?.city ?? "")} />
        </Field>
        <Field label="PIN code" error={err("pincode")}>
          <Input name="pincode" inputMode="numeric" defaultValue={v("pincode", contact?.pincode ?? "")} maxLength={6} />
        </Field>
        <Field label="Default TDS rate (%)" error={err("tdsRate")} hint="For vendors, e.g. 10 for 194J">
          <Input
            name="tdsRate"
            inputMode="decimal"
            defaultValue={v("tdsRate", contact?.tdsRateBps == null ? "" : String(contact.tdsRateBps / 100))}
          />
        </Field>
        <Field label="Notes" error={err("notes")} className="sm:col-span-2">
          <Textarea name="notes" defaultValue={v("notes", contact?.notes ?? "")} />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <ButtonLink variant="secondary" href={contact ? `/contacts/${contact.id}` : "/contacts"}>
          Cancel
        </ButtonLink>
      </div>
    </form>
  );
}
