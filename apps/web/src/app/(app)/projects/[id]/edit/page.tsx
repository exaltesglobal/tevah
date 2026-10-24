import { asc, eq, ne, or } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/action-button";
import { PageHeader } from "@/components/ui";
import { withOrg } from "@/db";
import { contacts } from "@/db/schema";
import { requireWriter } from "@/lib/auth";
import { isUuid } from "@/lib/doc-kinds";
import { getProject } from "@/lib/projects";
import { archiveProjectAction } from "../../actions";
import { ProjectForm } from "../../forms";

export const metadata = { title: "Edit project" };

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireWriter();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await withOrg(session.orgId, async (s) => {
    const row = await getProject(s, id);
    if (!row) return null;
    const customers = await s.tx
      .select({ id: contacts.id, name: contacts.name })
      .from(contacts)
      .where(s.own(contacts, or(ne(contacts.kind, "vendor"), row.project.contactId ? eq(contacts.id, row.project.contactId) : undefined)))
      .orderBy(asc(contacts.name));
    return { project: row.project, customers };
  });
  if (!data) notFound();
  const { project } = data;
  return (
    <div className="max-w-3xl">
      <PageHeader
        title={`Edit ${project.name}`}
        actions={
          <ActionButton
            action={archiveProjectAction.bind(null, id, !project.archived)}
            confirm={project.archived ? undefined : "Archive this project? It leaves the project list but its tasks and time are kept."}
          >
            {project.archived ? "Restore project" : "Archive project"}
          </ActionButton>
        }
      />
      <ProjectForm project={project} customers={data.customers} />
    </div>
  );
}
