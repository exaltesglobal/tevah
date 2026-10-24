import { asc, ne } from "drizzle-orm";
import { PageHeader } from "@/components/ui";
import { withOrg } from "@/db";
import { contacts } from "@/db/schema";
import { requireWriter } from "@/lib/auth";
import { ProjectForm } from "../forms";

export const metadata = { title: "New project" };

export default async function NewProjectPage() {
  const session = await requireWriter();
  const customers = await withOrg(session.orgId, (s) =>
    s.tx
      .select({ id: contacts.id, name: contacts.name })
      .from(contacts)
      .where(s.own(contacts, ne(contacts.kind, "vendor"), ne(contacts.archived, true)))
      .orderBy(asc(contacts.name)),
  );
  return (
    <div className="max-w-3xl">
      <PageHeader title="New project" />
      <ProjectForm customers={customers} />
    </div>
  );
}
