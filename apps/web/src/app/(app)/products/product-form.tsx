"use client";

import { GST_RATES_BPS } from "@tevah/core";
import { useActionState } from "react";
import { Button, ButtonLink, Field, FormError, Input, Select } from "@/components/ui";
import type { products } from "@/db/schema";
import { emptyForm } from "@/lib/form";
import { formatRate } from "@/lib/products";
import { saveProduct } from "./actions";

type Product = typeof products.$inferSelect;
export interface AccountOption {
  id: string;
  code: string;
  name: string;
}

const rupees = (paise: number | undefined) => (paise ? (paise / 100).toFixed(2) : "");

export function ProductForm({
  product,
  incomeAccounts,
  expenseAccounts,
}: {
  product?: Product;
  incomeAccounts: AccountOption[];
  expenseAccounts: AccountOption[];
}) {
  const [state, action, pending] = useActionState(saveProduct.bind(null, product?.id ?? null), emptyForm);
  const err = (k: string) => state.fieldErrors?.[k];
  const v = (k: string, fallback: string | undefined) => state.values?.[k] ?? fallback;
  return (
    <form action={action} className="space-y-6">
      <FormError message={state.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={err("name")} className="sm:col-span-2">
          <Input name="name" defaultValue={v("name", product?.name)} required />
        </Field>
        <Field label="Type" error={err("type")}>
          <Select name="type" defaultValue={v("type", product?.type ?? "service")}>
            <option value="service">Service</option>
            <option value="goods">Goods</option>
          </Select>
        </Field>
        <Field label="HSN / SAC code" error={err("hsnSac")} hint="SAC for services usually starts with 99">
          <Input name="hsnSac" inputMode="numeric" defaultValue={v("hsnSac", product?.hsnSac ?? "")} maxLength={8} />
        </Field>
        <Field label="Sale price (₹, before GST)" error={err("salePrice")}>
          <Input name="salePrice" inputMode="decimal" defaultValue={v("salePrice", rupees(product?.salePrice))} />
        </Field>
        <Field label="Purchase price (₹, before GST)" error={err("purchasePrice")}>
          <Input name="purchasePrice" inputMode="decimal" defaultValue={v("purchasePrice", rupees(product?.purchasePrice))} />
        </Field>
        <Field label="GST rate" error={err("gstRateBps")}>
          <Select name="gstRateBps" defaultValue={v("gstRateBps", String(product?.gstRateBps ?? 1800))}>
            {GST_RATES_BPS.map((r) => (
              <option key={r} value={r}>
                {formatRate(r)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Unit" error={err("unit")} hint="NOS, HRS, KGS, MTH…">
          <Input name="unit" defaultValue={v("unit", product?.unit ?? "NOS")} className="uppercase" maxLength={20} />
        </Field>
        <Field label="Income account" error={err("incomeAccountId")}>
          <Select name="incomeAccountId" defaultValue={v("incomeAccountId", product?.incomeAccountId ?? "")}>
            <option value="">Default sales account</option>
            {incomeAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Expense account" error={err("expenseAccountId")}>
          <Select name="expenseAccountId" defaultValue={v("expenseAccountId", product?.expenseAccountId ?? "")}>
            <option value="">Default purchases account</option>
            {expenseAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} {a.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <ButtonLink variant="secondary" href={product ? `/products/${product.id}` : "/products"}>
          Cancel
        </ButtonLink>
      </div>
    </form>
  );
}
