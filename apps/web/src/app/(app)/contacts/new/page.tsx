import { Card, PageHeader } from "@/components/ui";
import { requireWriter } from "@/lib/auth";
import { ContactForm } from "../contact-form";

export const metadata = { title: "New contact" };

export default async function NewContactPage() {
  await requireWriter();
  return (
    <>
      <PageHeader title="New contact" />
      <Card>
        <ContactForm />
      </Card>
    </>
  );
}
