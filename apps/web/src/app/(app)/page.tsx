import { formatINR, stateName } from "@tevah/core";
import { and, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { getDb, withOrg } from "@/db";
import { contacts, documents, orgs, products } from "@/db/schema";
import { requireSession } from "@/lib/auth";

export default async function Dashboard() {
  const session = await requireSession();
  const [org] = await getDb().select().from(orgs).where(eq(orgs.id, session.orgId));
  const counts = await withOrg(session.orgId, async (s) => {
    const [c] = await s.tx
      .select({
        customers: sql<number>`coalesce(sum(${contacts.kind} in ('customer','both')), 0)`.mapWith(Number),
        vendors: sql<number>`coalesce(sum(${contacts.kind} in ('vendor','both')), 0)`.mapWith(Number),
      })
      .from(contacts)
      .where(s.own(contacts, eq(contacts.archived, false)));
    const [p] = await s.tx
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(products)
      .where(s.own(products, eq(products.archived, false)));
    const due = (type: "invoice" | "bill") =>
      s.tx
        .select({ n: sql<string>`coalesce(sum(${documents.total} - ${documents.tdsAmount} - ${documents.amountPaid}), 0)` })
        .from(documents)
        .where(s.own(documents, and(eq(documents.type, type), eq(documents.status, "posted"))))
        .then(([r]) => Number(r?.n ?? 0));
    return {
      customers: c?.customers ?? 0,
      vendors: c?.vendors ?? 0,
      products: p?.n ?? 0,
      receivable: await due("invoice"),
      payable: await due("bill"),
    };
  });

  const money = [
    { label: "To receive", value: counts.receivable, href: "/sales?status=due" },
    { label: "To pay", value: counts.payable, href: "/purchases?status=due" },
  ];
  const stats = [
    { label: "Customers", value: counts.customers, href: "/contacts?kind=customer" },
    { label: "Vendors", value: counts.vendors, href: "/contacts?kind=vendor" },
    { label: "Products & services", value: counts.products, href: "/products" },
  ];

  return (
    <>
      <PageHeader title={`Welcome, ${session.userName.split(" ")[0]}`} subtitle={org?.legalName} />
      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        {money.map((m) => (
          <Link key={m.label} href={m.href}>
            <Card className="transition hover:border-brand-500">
              <div className="text-sm text-stone-500">{m.label}</div>
              <div className="mt-1 text-3xl font-semibold tabular-nums">{formatINR(m.value, { symbol: true })}</div>
            </Card>
          </Link>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <Link key={s.label} href={s.href}>
            <Card className="transition hover:border-brand-500">
              <div className="text-sm text-stone-500">{s.label}</div>
              <div className="mt-1 text-3xl font-semibold tabular-nums">{s.value}</div>
            </Card>
          </Link>
        ))}
      </div>
      {org && (
        <Card className="mt-6">
          <h2 className="mb-3 font-semibold">Company</h2>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Detail label="GSTIN" value={org.gstin} mono />
            <Detail label="PAN" value={org.pan} mono />
            <Detail label="TAN" value={org.tan} mono />
            <Detail label="State" value={`${stateName(org.stateCode)} (${org.stateCode})`} />
          </dl>
        </Card>
      )}
    </>
  );
}

function Detail({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-stone-100 py-1.5">
      <dt className="text-stone-500">{label}</dt>
      <dd className={mono ? "font-mono" : undefined}>{value ?? "—"}</dd>
    </div>
  );
}
