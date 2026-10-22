import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Badge, Button, Card, PageHeader } from "@/components/ui";
import { withOrg } from "@/db";
import { products } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { accountOptions } from "../account-options";
import { setProductArchived } from "../actions";
import { ProductForm } from "../product-form";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await withOrg(session.orgId, async (tx) => {
    const [product] = await tx.select().from(products).where(eq(products.id, id));
    return product ? { product, ...(await accountOptions(tx)) } : null;
  });
  if (!data) notFound();
  const { product } = data;

  return (
    <>
      <PageHeader
        title={product.name}
        subtitle={product.archived ? <Badge>Archived</Badge> : undefined}
        actions={
          <form action={setProductArchived.bind(null, product.id, !product.archived)}>
            <Button variant={product.archived ? "secondary" : "danger"}>
              {product.archived ? "Restore" : "Archive"}
            </Button>
          </form>
        }
      />
      <Card>
        <ProductForm {...data} />
      </Card>
    </>
  );
}
