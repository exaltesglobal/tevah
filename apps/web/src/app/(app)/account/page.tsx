import { Card, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { PasswordForm } from "./password-form";

export const metadata = { title: "Your account" };

export default async function AccountPage() {
  const session = await requireSession();
  return (
    <>
      <PageHeader title="Your account" subtitle={`${session.userName} · ${session.email}`} />
      <Card>
        <PasswordForm />
      </Card>
    </>
  );
}
