import { formatINR } from "@tevah/core";
import { asc, eq, like, or, type SQL } from "drizzle-orm";
import Link from "next/link";
import { Badge, Button, ButtonLink, EmptyState, Input, PageHeader, Select, Table, Th } from "@/components/ui";
import { withOrg } from "@/db";
import { products } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { formatRate } from "@/lib/products";

export const metadata = { title: "Products & services" };

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; archived?: string }>;
}) {
  const session = await requireSession();
  const { q, archived } = await searchParams;
  const filters: SQL[] = [eq(products.archived, archived === "1")];
  if (q) filters.push(or(like(products.name, `%${q}%`), like(products.hsnSac, `${q}%`))!);
  const rows = await withOrg(session.orgId, (s) =>
    s.tx
      .select()
      .from(products)
      .where(s.own(products, ...filters))
      .orderBy(asc(products.name)),
  );

  return (
    <>
      <PageHeader
        title="Products & services"
        actions={<ButtonLink href="/products/new">New product</ButtonLink>}
      />
      <form className="mb-4 flex flex-wrap gap-2">
        <Input name="q" defaultValue={q} placeholder="Search name or HSN/SAC" className="max-w-xs" />
        <Select name="archived" defaultValue={archived ?? ""} className="w-auto!">
          <option value="">Active</option>
          <option value="1">Archived</option>
        </Select>
        <Button variant="secondary">Filter</Button>
      </form>
      <Table
        head={
          <tr>
            <Th>Name</Th>
            <Th>Type</Th>
            <Th>HSN/SAC</Th>
            <Th className="text-right">Sale price</Th>
            <Th className="text-right">GST</Th>
          </tr>
        }
        empty={rows.length === 0 && <EmptyState>No products yet.</EmptyState>}
      >
        {rows.map((p) => (
          <tr key={p.id} className="hover:bg-stone-50">
            <td>
              <Link href={`/products/${p.id}`} className="font-medium text-brand-700 hover:underline">
                {p.name}
              </Link>
            </td>
            <td>
              <Badge>{p.type === "service" ? "Service" : "Goods"}</Badge>
            </td>
            <td className="font-mono text-xs">{p.hsnSac ?? "—"}</td>
            <td className="text-right tabular-nums">
              {formatINR(p.salePrice, { symbol: true })} / {p.unit}
            </td>
            <td className="text-right">{formatRate(p.gstRateBps)}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
