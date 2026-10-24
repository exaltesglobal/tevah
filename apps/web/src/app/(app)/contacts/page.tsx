import { stateName } from "@tevah/core";
import { asc, eq, inArray, like, or, type SQL } from "drizzle-orm";
import Link from "next/link";
import { Badge, Button, ButtonLink, EmptyState, Input, PageHeader, Select, Table, Th } from "@/components/ui";
import { withOrg } from "@/db";
import { contacts } from "@/db/schema";
import { requireSession } from "@/lib/auth";

export const metadata = { title: "Contacts" };

const KIND_LABEL = { customer: "Customer", vendor: "Vendor", both: "Both" } as const;

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kind?: string; archived?: string }>;
}) {
  const session = await requireSession();
  const { q, kind, archived } = await searchParams;
  const filters: SQL[] = [eq(contacts.archived, archived === "1")];
  if (q) filters.push(or(like(contacts.name, `%${q}%`), like(contacts.gstin, `%${q}%`))!);
  if (kind === "customer" || kind === "vendor") filters.push(inArray(contacts.kind, [kind, "both"]));

  const rows = await withOrg(session.orgId, (s) =>
    s.tx
      .select()
      .from(contacts)
      .where(s.own(contacts, ...filters))
      .orderBy(asc(contacts.name))
      .limit(500),
  );

  return (
    <>
      <PageHeader title="Contacts" subtitle="Customers and vendors" actions={<ButtonLink href="/contacts/new">New contact</ButtonLink>} />
      <form className="mb-4 flex flex-wrap gap-2">
        <Input name="q" defaultValue={q} placeholder="Search name or GSTIN" className="max-w-xs" />
        <Select name="kind" defaultValue={kind ?? ""} className="w-auto!">
          <option value="">All</option>
          <option value="customer">Customers</option>
          <option value="vendor">Vendors</option>
        </Select>
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
            <Th>GSTIN</Th>
            <Th>State</Th>
            <Th>Contact</Th>
          </tr>
        }
        empty={rows.length === 0 && <EmptyState>No contacts match.</EmptyState>}
      >
        {rows.map((c) => (
          <tr key={c.id} className="hover:bg-stone-50">
            <td>
              <Link href={`/contacts/${c.id}`} className="font-medium text-brand-700 hover:underline">
                {c.name}
              </Link>
            </td>
            <td>
              <Badge tone={c.kind === "vendor" ? "amber" : "brand"}>{KIND_LABEL[c.kind]}</Badge>
            </td>
            <td className="font-mono text-xs">{c.gstin ?? <span className="text-stone-400">Unregistered</span>}</td>
            <td>{c.stateCode ? stateName(c.stateCode) : "—"}</td>
            <td className="text-stone-600">{c.email ?? c.phone ?? "—"}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
