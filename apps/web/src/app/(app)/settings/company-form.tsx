"use client";

import { useActionState } from "react";
import { Button, Field, FormError, Input } from "@/components/ui";
import type { orgs } from "@/db/schema";
import { emptyForm } from "@/lib/form";
import { saveCompany } from "./actions";

export function CompanyForm({ org }: { org: typeof orgs.$inferSelect }) {
  const [state, action, pending] = useActionState(saveCompany, emptyForm);
  const err = (k: string) => state.fieldErrors?.[k];
  const v = (k: string, fallback: string | null) => state.values?.[k] ?? fallback ?? "";
  return (
    <form action={action} className="space-y-6">
      <FormError message={state.error} />
      {state.saved && <div className="rounded-md border border-brand-100 bg-brand-50 px-3 py-2 text-sm text-brand-700">Saved.</div>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Short name" error={err("name")} hint="Shown in the app">
          <Input name="name" defaultValue={v("name", org.name)} required />
        </Field>
        <Field label="Legal name" error={err("legalName")} hint="Printed on invoices">
          <Input name="legalName" defaultValue={v("legalName", org.legalName)} required />
        </Field>
        <Field label="Address line 1" error={err("addressLine1")} className="sm:col-span-2">
          <Input name="addressLine1" defaultValue={v("addressLine1", org.addressLine1)} />
        </Field>
        <Field label="Address line 2" error={err("addressLine2")} className="sm:col-span-2">
          <Input name="addressLine2" defaultValue={v("addressLine2", org.addressLine2)} />
        </Field>
        <Field label="City" error={err("city")}>
          <Input name="city" defaultValue={v("city", org.city)} />
        </Field>
        <Field label="PIN code" error={err("pincode")}>
          <Input name="pincode" inputMode="numeric" maxLength={6} defaultValue={v("pincode", org.pincode)} />
        </Field>
        <Field label="Email" error={err("email")}>
          <Input name="email" type="email" defaultValue={v("email", org.email)} />
        </Field>
        <Field label="Phone" error={err("phone")}>
          <Input name="phone" defaultValue={v("phone", org.phone)} />
        </Field>
        <Field label="TAN" error={err("tan")} hint="For TDS you deduct">
          <Input name="tan" className="uppercase" maxLength={10} defaultValue={v("tan", org.tan)} />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button disabled={pending}>Save</Button>
      </div>
    </form>
  );
}
