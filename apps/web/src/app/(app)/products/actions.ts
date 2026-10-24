"use server";

import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withOrg } from "@/db";
import { accounts, products } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireWriter } from "@/lib/auth";
import { formValues, submitted, zodErrors, type FormState } from "@/lib/form";
import { productInput } from "@/lib/products";

export async function saveProduct(id: string | null, _prev: FormState, data: FormData): Promise<FormState> {
  const session = await requireWriter();
  const parsed = productInput.safeParse(formValues(data));
  if (!parsed.success) return zodErrors(parsed.error, data);
  const values = parsed.data;

  const result = await withOrg(session.orgId, async (s) => {
    const accountIds = [...new Set([values.incomeAccountId, values.expenseAccountId].filter((a): a is string => !!a))];
    if (accountIds.length) {
      const found = await s.tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(s.own(accounts, inArray(accounts.id, accountIds)));
      if (found.length !== accountIds.length) return { error: "Choose accounts from your chart of accounts." };
    }
    if (id) {
      const [existing] = await s.tx.select({ id: products.id }).from(products).where(s.own(products, eq(products.id, id)));
      if (!existing) return { error: "Product not found." };
      await s.tx.update(products).set(values).where(s.own(products, eq(products.id, id)));
      await audit(s, session, "update", "product", id, values);
      return { id };
    }
    const newId = randomUUID();
    await s.tx.insert(products).values({ ...values, id: newId, orgId: s.orgId });
    await audit(s, session, "create", "product", newId, values);
    return { id: newId };
  });

  if ("error" in result) return { error: result.error, values: submitted(data) };
  revalidatePath("/products");
  redirect(`/products/${result.id}`);
}

export async function setProductArchived(id: string, archived: boolean): Promise<void> {
  const session = await requireWriter();
  await withOrg(session.orgId, async (s) => {
    const [res] = await s.tx.update(products).set({ archived }).where(s.own(products, eq(products.id, id)));
    if (res.affectedRows) await audit(s, session, archived ? "archive" : "restore", "product", id);
  });
  revalidatePath("/products");
  revalidatePath(`/products/${id}`);
}
