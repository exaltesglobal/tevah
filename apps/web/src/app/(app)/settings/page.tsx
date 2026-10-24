import { stateName } from "@tevah/core";
import { eq } from "drizzle-orm";
import { ButtonLink, Card, PageHeader } from "@/components/ui";
import { getDb } from "@/db";
import { orgs } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { CompanyForm } from "./company-form";

export const metadata = { title: "Company" };

export default async function SettingsPage() {
  const session = await requireSession();
  const [org] = await getDb().select().from(orgs).where(eq(orgs.id, session.orgId));
  return (
    <>
      <PageHeader
        title="Company details"
        subtitle={`GSTIN ${org!.gstin ?? "not registered"} · ${stateName(org!.stateCode)} · PAN ${org!.pan ?? "—"}`}
        actions={
          <>
            <ButtonLink href="/settings/invoice-design" variant="secondary">
              Invoice design
            </ButtonLink>
            {session.role === "admin" && (
              <ButtonLink href="/settings/import" variant="secondary">
                Import from Odoo
              </ButtonLink>
            )}
          </>
        }
      />
      <Card>
        <CompanyForm org={org!} />
      </Card>
    </>
  );
}
