import { Card, PageHeader } from "@/components/ui";
import { withOrg } from "@/db";
import { requireWriter } from "@/lib/auth";
import { productFormOptions } from "../account-options";
import { ProductForm } from "../product-form";

export const metadata = { title: "New product" };

export default async function NewProductPage() {
  const session = await requireWriter();
  const options = await withOrg(session.orgId, productFormOptions);
  return (
    <>
      <PageHeader title="New product or service" />
      <Card>
        <ProductForm {...options} />
      </Card>
    </>
  );
}
