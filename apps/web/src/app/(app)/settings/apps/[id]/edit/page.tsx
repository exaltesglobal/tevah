import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { withOrg } from "@/db";
import { requireSession } from "@/lib/auth";
import { getApp } from "@/lib/connected-apps";
import { isUuid } from "@/lib/doc-kinds";
import { updateAppAction } from "../../actions";
import { AppForm } from "../../app-form";
import { appFormOptions } from "../../options";

export const metadata = { title: "Edit app" };

export default async function EditAppPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  if (session.role !== "admin") redirect("/settings");
  if (!isUuid(id)) notFound();
  const data = await withOrg(session.orgId, async (s) => {
    const app = await getApp(s, id);
    return app && { app, options: await appFormOptions(s) };
  });
  if (!data) notFound();
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title={data.app.name}
        subtitle={
          <>
            <Link href="/settings/apps" className="text-brand-700 hover:underline">
              Connected apps
            </Link>{" "}
            ·{" "}
            <Link href={`/settings/apps/${id}`} className="text-brand-700 hover:underline">
              {data.app.name}
            </Link>{" "}
            · edit
          </>
        }
      />
      <Card>
        <AppForm app={data.app} options={data.options} action={updateAppAction.bind(null, id)} />
      </Card>
    </div>
  );
}
