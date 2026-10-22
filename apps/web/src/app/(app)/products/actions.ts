"use server";

import { and, eq, inArray } from "drizzle-orm";
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

  const result = await withOrg(session.orgId, async (tx) => {
    const accountIds = [values.incomeAccountId, values.expenseAccountId].filter((a): a is string => !!a);
    if (accountIds.length) {
      const found = await tx.select({ id: accounts.id }).from(accounts).where(inArray(accounts.id, accountIds));
      if (found.length !== new Set(accountIds).size) return { error: "Choose accounts from your chart of accounts." };
    }
    if (id) {
      const [row] = await tx
        .update(products)
        .set(values)
        .where(and(eq(products.id, id), eq(products.orgId, session.orgId)))
        .returning({ id: products.id });
      if (!row) return { error: "Product not found." };
      await audit(tx, session, "update", "product", row.id, values);
      return { id: row.id };
    }
    const [row] = await tx
      .insert(products)
      .values({ ...values, orgId: session.orgId })
      .returning({ id: products.id });
    await audit(tx, session, "create", "product", row!.id, values);
    return { id: row!.id };
  });

  if ("error" in result) return { error: result.error, values: submitted(data) };
  revalidatePath("/products");
  redirect(`/products/${result.id}`);
}

export async function setProductArchived(id: string, archived: boolean): Promise<void> {
  const session = await requireWriter();
  await withOrg(session.orgId, async (tx) => {
    await tx.update(products).set({ archived }).where(eq(products.id, id));
    await audit(tx, session, archived ? "archive" : "restore", "product", id);
  });
  revalidatePath("/products");
  revalidatePath(`/products/${id}`);
}
