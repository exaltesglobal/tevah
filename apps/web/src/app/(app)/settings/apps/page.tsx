import { formatINR } from "@tevah/core";
import { desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, ButtonLink, EmptyState, PageHeader, Table, Th } from "@/components/ui";
import { withOrg } from "@/db";
import { appPayments } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { listApps } from "@/lib/connected-apps";

export const metadata = { title: "Connected apps" };

export default async function ConnectedAppsPage() {
  const session = await requireSession();
  if (session.role !== "admin") redirect("/settings");
  const { apps, totals } = await withOrg(session.orgId, async (s) => {
    const apps = await listApps(s);
    const totals = await s.tx
      .select({
        appId: appPayments.appId,
        invoiced: sql<number>`sum(case when ${appPayments.status} = 'invoiced' and ${appPayments.documentId} is not null then ${appPayments.amount} else 0 end)`.mapWith(Number),
        failed: sql<number>`sum(case when ${appPayments.status} = 'failed' then 1 else 0 end)`.mapWith(Number),
      })
      .from(appPayments)
      .where(s.own(appPayments))
      .groupBy(appPayments.appId)
      .orderBy(desc(appPayments.appId));
    return { apps, totals: new Map(totals.map((t) => [t.appId, t])) };
  });

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Connected apps"
        subtitle={
          <>
            <Link href="/settings" className="text-brand-700 hover:underline">
              Company
            </Link>{" "}
            · each subscription payment your apps take becomes a paid invoice here, emailed to the customer, with the gateway fee, settlements and refunds
            booked for you
          </>
        }
        actions={<ButtonLink href="/settings/apps/new">Connect an app</ButtonLink>}
      />
      <Table
        head={
          <tr>
            <Th>App</Th>
            <Th>Source</Th>
            <Th>Books into</Th>
            <Th className="text-right">Invoiced</Th>
            <Th>Last event</Th>
            <Th />
          </tr>
        }
        empty={apps.length === 0 && <EmptyState>No apps yet. Connect one to start invoicing its payments automatically.</EmptyState>}
      >
        {apps.map((app) => {
          const t = totals.get(app.id);
          return (
            <tr key={app.id}>
              <td>
                <Link href={`/settings/apps/${app.id}`} className="font-medium text-brand-700 hover:underline">
                  {app.name}
                </Link>
                {!app.active && (
                  <>
                    {" "}
                    <Badge tone="amber">Paused</Badge>
                  </>
                )}
                {t?.failed ? (
                  <>
                    {" "}
                    <Badge tone="amber">
                      {t.failed} failed
                    </Badge>
                  </>
                ) : null}
              </td>
              <td>{app.source === "razorpay" ? `Razorpay${app.notesFilter ? ` · app=${app.notesFilter}` : ""}` : "API"}</td>
              <td className="text-sm text-stone-600">
                SAC {app.sac} · {app.gstRateBps / 100}% GST
              </td>
              <td className="text-right tabular-nums">{formatINR(t?.invoiced ?? 0)}</td>
              <td className="text-sm text-stone-600">{app.lastEventAt ? app.lastEventAt.toISOString().slice(0, 10) : "—"}</td>
              <td className="text-right">
                <Link href={`/settings/apps/${app.id}/edit`} className="text-sm text-brand-700 hover:underline">
                  Edit
                </Link>
              </td>
            </tr>
          );
        })}
      </Table>
    </div>
  );
}
