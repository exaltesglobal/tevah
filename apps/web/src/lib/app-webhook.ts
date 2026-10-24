import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { withOrg } from "@/db";
import { connectedApps } from "@/db/schema";
import { originOf } from "./base-url";
import { bookAppEvent, eventNameOf, noteAppEvent, parseAppEvent, verifyRazorpay, verifyTevahSignature, type Booked, type ConnectedApp } from "./connected-apps";
import { sendDocumentEmail } from "./document-email";
import { UserError } from "./documents";

const text = (body: string, status: number) => new NextResponse(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * Receive one event for a connected app, from Razorpay's webhook or the app's
 * own call to Tevah's API, check its signature, book it and (after the
 * transaction commits) email the customer their invoice.
 *
 * Booking failures answer 200 with the row marked failed, so the sender
 * doesn't retry forever; the problem shows on the app's page and the event can
 * be booked again from there once it is fixed.
 */
export async function handleAppRequest(req: Request, orgId: string, appId: string, source: ConnectedApp["source"]): Promise<NextResponse> {
  if (!isUuid(orgId) || !isUuid(appId)) return text("Unknown app", 404);
  const app = await withOrg(orgId, async (s) => {
    const [app] = await s.tx.select().from(connectedApps).where(s.own(connectedApps, eq(connectedApps.id, appId)));
    return app ?? null;
  });
  if (!app || app.source !== source) return text("Unknown app", 404);
  if (!app.active) return text("This app is switched off in Tevah", 410);

  const raw = await req.text();
  const ok =
    source === "razorpay"
      ? verifyRazorpay(raw, req.headers.get("x-razorpay-signature"), app.secret)
      : verifyTevahSignature(raw, req.headers.get("x-tevah-signature"), app.secret);
  if (!ok) return text("Bad signature", 401);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return text("Body must be JSON", 400);
  }
  const eventName = eventNameOf(app, body);
  const parsed = parseAppEvent(app, body);
  if (source === "api" && parsed.kind === "ignored") return NextResponse.json({ error: parsed.reason }, { status: 422 });

  let booked: Booked;
  try {
    booked = await withOrg(orgId, (s) => bookAppEvent(s, app, eventName, parsed, raw));
  } catch (err) {
    const message = err instanceof UserError ? err.message : `Couldn't book this event: ${err instanceof Error ? err.message : String(err)}`;
    const id = parsed.kind === "payment" ? parsed.event.paymentId : parsed.kind === "refund" ? parsed.event.refundId : parsed.kind === "settlement" ? parsed.event.settlementId : parsed.id;
    if (!(err instanceof UserError)) console.error(`[connected-apps] ${app.name} ${eventName} ${id ?? ""}:`, err);
    if (!id) return NextResponse.json({ status: "failed", error: message }, { status: 200 });
    const about = parsed.kind === "payment" ? { amount: parsed.event.amount, customer: parsed.event.customer } : {};
    booked = await withOrg(orgId, (s) => noteAppEvent(s, app, id, eventName, "failed", message, raw, about));
  }

  if (booked.emailPending) await sendDocumentEmail(orgId, booked.appPaymentId, originOf(req));
  return NextResponse.json({ status: booked.status, documentId: booked.documentId }, { status: 200 });
}
