import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Badge, Button, Card, PageHeader } from "@/components/ui";
import { withOrg } from "@/db";
import { contacts } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { setContactArchived } from "../actions";
import { ContactForm } from "../contact-form";

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [contact] = await withOrg(session.orgId, (tx) => tx.select().from(contacts).where(eq(contacts.id, id)));
  if (!contact) notFound();

  return (
    <>
      <PageHeader
        title={contact.name}
        subtitle={contact.archived ? <Badge>Archived</Badge> : undefined}
        actions={
          <form action={setContactArchived.bind(null, contact.id, !contact.archived)}>
            <Button variant={contact.archived ? "secondary" : "danger"}>
              {contact.archived ? "Restore" : "Archive"}
            </Button>
          </form>
        }
      />
      <Card>
        <ContactForm contact={contact} />
      </Card>
    </>
  );
}
