import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { withOrg } from "@/db";
import { requireSession } from "@/lib/auth";
import { createAppAction } from "../actions";
import { AppForm } from "../app-form";
import { appFormOptions } from "../options";

export const metadata = { title: "Connect an app" };

export default async function NewAppPage() {
  const session = await requireSession();
  if (session.role !== "admin") redirect("/settings");
  const options = await withOrg(session.orgId, appFormOptions);
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Connect an app"
        subtitle={
          <Link href="/settings/apps" className="text-brand-700 hover:underline">
            Connected apps
          </Link>
        }
      />
      <Card>
        <AppForm app={null} options={options} action={createAppAction} />
      </Card>
    </div>
  );
}
