"use client";

import { GST_RATES_BPS } from "@tevah/core";
import { useActionState, useMemo, useState } from "react";
import { HsnChips, useAutoHsn, type HsnHistory } from "@/components/hsn-suggest";
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
  hsnHistory,
}: {
  product?: Product;
  incomeAccounts: AccountOption[];
  expenseAccounts: AccountOption[];
  hsnHistory: HsnHistory;
}) {
  const [state, action, pending] = useActionState(saveProduct.bind(null, product?.id ?? null), emptyForm);
  const err = (k: string) => state.fieldErrors?.[k];
  const v = (k: string, fallback: string | undefined) => state.values?.[k] ?? fallback;
  const [name, setName] = useState(v("name", product?.name) ?? "");
  const [type, setType] = useState<"service" | "goods">((v("type", product?.type) as "service" | "goods") ?? "service");
  const [hsn, setHsn] = useState(v("hsnSac", product?.hsnSac ?? "") ?? "");
  const history = useMemo(() => hsnHistory.filter((h) => h.name !== product?.name), [hsnHistory, product?.name]);
  const { suggestions, auto } = useAutoHsn({ name, kind: type, history, value: hsn, setValue: setHsn });
  return (
    <form action={action} className="space-y-6">
      <FormError message={state.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={err("name")} className="sm:col-span-2">
          <Input name="name" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Type" error={err("type")}>
          <Select name="type" value={type} onChange={(e) => setType(e.target.value as "service" | "goods")}>
            <option value="service">Service</option>
            <option value="goods">Goods</option>
          </Select>
        </Field>
        <div>
          <Field label="HSN / SAC code" error={err("hsnSac")} hint={suggestions.length ? undefined : "Type the name and Tevah suggests a code"}>
            <Input name="hsnSac" inputMode="numeric" value={hsn} onChange={(e) => setHsn(e.target.value.replace(/\D/g, ""))} maxLength={8} />
          </Field>
          <HsnChips suggestions={suggestions} value={hsn} auto={auto} onPick={setHsn} />
        </div>
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
