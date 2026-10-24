import { formatINR } from "@tevah/core";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ActionButton } from "@/components/action-button";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, Table, Th } from "@/components/ui";
import { withOrg } from "@/db";
import { requireSession } from "@/lib/auth";
import { baseUrl } from "@/lib/base-url";
import { getApp, recentAppPayments } from "@/lib/connected-apps";
import { docPath, isUuid } from "@/lib/doc-kinds";
import { mailConfigured } from "@/lib/mail";
import { replayEventAction, resendEmailAction, rotateSecretAction } from "../actions";

export const metadata = { title: "Connected app" };

const STATUS_TONE = { invoiced: "green", ignored: "stone", failed: "amber" } as const;
const EMAIL_LABEL = { pending: "Email pending", sent: "Emailed", failed: "Email failed", off: null } as const;

export default async function AppPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  if (session.role !== "admin") redirect("/settings");
  if (!isUuid(id)) notFound();
  const data = await withOrg(session.orgId, async (s) => {
    const app = await getApp(s, id);
    return app && { app, events: await recentAppPayments(s, id) };
  });
  if (!data) notFound();
  const { app, events } = data;
  const base = await baseUrl();
  const endpoint = `${base}/api/apps/${session.orgId}/${app.id}/${app.source === "razorpay" ? "razorpay" : "payments"}`;
  const razorpay = app.source === "razorpay";

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title={app.name}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Link href="/settings/apps" className="text-brand-700 hover:underline">
              Connected apps
            </Link>
            <span>· {razorpay ? "Razorpay webhook" : "Tevah API"}</span>
            <span>
              · SAC {app.sac} · {app.gstRateBps / 100}% GST
            </span>
            {!app.active && <Badge tone="amber">Paused</Badge>}
          </span>
        }
        actions={
          <ButtonLink href={`/settings/apps/${app.id}/edit`} variant="secondary">
            Edit
          </ButtonLink>
        }
      />

      <Card>
        <h2 className="font-semibold">{razorpay ? "Set up the webhook in Razorpay" : "Connect the app"}</h2>
        <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-stone-500">{razorpay ? "Webhook URL" : "Endpoint"}</dt>
          <dd>
            <code className="break-all rounded bg-stone-100 px-1.5 py-0.5">{endpoint}</code>
          </dd>
          <dt className="text-stone-500">Secret</dt>
          <dd className="space-y-2">
            <details>
              <summary className="cursor-pointer text-brand-700 hover:underline">Show secret</summary>
              <code className="mt-1 block break-all rounded bg-stone-100 px-1.5 py-0.5">{app.secret}</code>
            </details>
            <ActionButton action={rotateSecretAction.bind(null, app.id)} confirm="Make a new secret? The old one stops working at once, so update it in Razorpay or the app too.">
              New secret
            </ActionButton>
          </dd>
          {razorpay ? (
            <>
              <dt className="text-stone-500">Active events</dt>
              <dd>
                <code>payment.captured</code>, <code>subscription.charged</code>, <code>refund.processed</code>
                {app.bankJournalId && (
                  <>
                    , <code>settlement.processed</code>
                  </>
                )}
              </dd>
              <dt className="text-stone-500">Payment notes</dt>
              <dd className="text-stone-600">
                Your app should set these notes on the Razorpay order, payment or subscription: <code>name</code> or <code>company</code>, <code>gstin</code>{" "}
                (for B2B), <code>state</code> (2-digit GST state code when there is no GSTIN), <code>country</code> (ISO code; anything but IN is invoiced as an
                export under LUT without GST), <code>customer_id</code> (your own id, so repeat payments go to the same customer), <code>plan</code>
                {app.notesFilter && (
                  <>
                    {" "}
                    and <code>app = {app.notesFilter}</code>
                  </>
                )}
                . Cards from abroad with no GSTIN or state are treated as foreign customers.
              </dd>
            </>
          ) : (
            <>
              <dt className="text-stone-500">Request</dt>
              <dd className="space-y-2 text-stone-600">
                <p>
                  <code>POST</code> a JSON body signed with the secret: header <code>X-Tevah-Signature: t=&lt;unix seconds&gt;,v1=&lt;hex HMAC-SHA256 of
                  &quot;t.body&quot;&gt;</code>. Amounts are in paise and include GST. Each <code>paymentId</code> is invoiced once.
                </p>
                <pre className="overflow-x-auto rounded-md bg-stone-900 px-4 py-3 text-xs text-stone-100">{`{
  "paymentId": "pay_123",            // your id for the payment
  "amount": 49900,                    // paise, GST included
  "paidAt": "2026-10-24T09:30:00+05:30",
  "customer": {
    "id": "cus_42", "name": "Shah Studio", "email": "priya@example.com",
    "phone": "+919876543210", "gstin": "29AABCA1234B1ZD",  // optional
    "state": "29",                    // GST state code when no GSTIN
    "country": "IN"                   // anything else: export under LUT, no GST
  },
  "plan": "Pro plan",
  "period": { "from": "2026-10-24", "to": "2026-11-23" },
  "fee": 1178, "feeTax": 180         // gateway fee and the GST inside it, optional
}`}</pre>
                <pre className="overflow-x-auto rounded-md bg-stone-900 px-4 py-3 text-xs text-stone-100">{`// Node.js
const t = Math.floor(Date.now() / 1000);
const body = JSON.stringify(payload);
const v1 = crypto.createHmac("sha256", SECRET).update(\`\${t}.\${body}\`).digest("hex");
await fetch("${endpoint}", { method: "POST", headers: { "content-type": "application/json", "x-tevah-signature": \`t=\${t},v1=\${v1}\` }, body });`}</pre>
              </dd>
            </>
          )}
          <dt className="text-stone-500">Emails</dt>
          <dd className="text-stone-600">
            {!app.emailInvoices
              ? "Invoices are not emailed for this app."
              : mailConfigured()
                ? "Each invoice and credit note is emailed to the customer with a link to their copy."
                : "Invoices will be emailed once SMTP_HOST, SMTP_USER and SMTP_PASSWORD are set in the app's environment; until then they are kept as pending here."}
          </dd>
        </dl>
      </Card>

      <div>
        <h2 className="mb-2 font-semibold">Recent events</h2>
        <Table
          head={
            <tr>
              <Th>Received</Th>
              <Th>Event</Th>
              <Th>Customer</Th>
              <Th className="text-right">Amount</Th>
              <Th>Booked as</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          }
          empty={events.length === 0 && <EmptyState>Nothing yet. Events show here as soon as the first one arrives.</EmptyState>}
        >
          {events.map((e) => (
            <tr key={e.id}>
              <td className="text-sm whitespace-nowrap text-stone-600">{e.receivedAt.toISOString().slice(0, 16).replace("T", " ")}</td>
              <td className="text-sm">
                {e.event}
                <div className="font-mono text-xs text-stone-500">{e.externalId}</div>
              </td>
              <td className="text-sm">
                {e.customerName}
                {e.customerEmail && <div className="text-xs text-stone-500">{e.customerEmail}</div>}
              </td>
              <td className="text-right tabular-nums">{e.amount ? formatINR(e.amount) : ""}</td>
              <td className="text-sm">
                {e.documentId && e.type ? (
                  <Link href={docPath(e.type, e.documentId)} className="text-brand-700 hover:underline">
                    {e.number}
                  </Link>
                ) : e.status === "invoiced" ? (
                  "Journal entry"
                ) : (
                  ""
                )}
              </td>
              <td className="space-y-1 text-sm">
                <Badge tone={STATUS_TONE[e.status]}>{e.status === "invoiced" ? "Booked" : e.status === "ignored" ? "Ignored" : "Failed"}</Badge>
                {EMAIL_LABEL[e.emailStatus] && (
                  <div>
                    <Badge tone={e.emailStatus === "failed" ? "amber" : e.emailStatus === "sent" ? "green" : "stone"}>{EMAIL_LABEL[e.emailStatus]}</Badge>
                  </div>
                )}
                {(e.error || e.emailError) && <div className="max-w-xs text-xs text-stone-500">{e.error ?? e.emailError}</div>}
              </td>
              <td className="text-right">
                <div className="flex flex-col items-end gap-1">
                  {e.status !== "invoiced" && e.status !== "ignored" && <ActionButton action={replayEventAction.bind(null, app.id, e.id)}>Book again</ActionButton>}
                  {e.status === "ignored" && e.error?.startsWith("No settlement bank") && (
                    <ActionButton action={replayEventAction.bind(null, app.id, e.id)}>Book again</ActionButton>
                  )}
                  {e.documentId && e.customerEmail && (
                    <ActionButton action={resendEmailAction.bind(null, app.id, e.id)}>{e.emailStatus === "sent" ? "Email again" : "Send email"}</ActionButton>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      </div>
    </div>
  );
}
