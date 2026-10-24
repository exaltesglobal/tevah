import { formatINR } from "@tevah/core";
import { eq } from "drizzle-orm";
import { withOrg } from "@/db";
import { appPayments, connectedApps, contacts, documents, orgs } from "@/db/schema";
import { escapeHtml, mailConfigured, sendMail } from "./mail";

export const publicInvoicePath = (orgId: string, token: string) => `/invoice/${orgId}/${token}`;

/**
 * Email the invoice or credit note an app payment produced to the customer,
 * with a link to the public copy. Called after the booking transaction has
 * committed, so a slow mail server never holds a webhook open; the outcome is
 * kept on the app payment row.
 */
export async function sendDocumentEmail(orgId: string, appPaymentId: string, baseUrl: string): Promise<void> {
  const data = await withOrg(orgId, async (s) => {
    const [row] = await s.tx
      .select({
        id: appPayments.id,
        email: appPayments.customerEmail,
        documentId: appPayments.documentId,
        appName: connectedApps.name,
      })
      .from(appPayments)
      .innerJoin(connectedApps, s.own(connectedApps, eq(connectedApps.id, appPayments.appId)))
      .where(s.own(appPayments, eq(appPayments.id, appPaymentId)));
    if (!row?.documentId || !row.email) return null;
    const [doc] = await s.tx.select().from(documents).where(s.own(documents, eq(documents.id, row.documentId)));
    if (!doc?.shareToken || !doc.number) return null;
    const [contact] = await s.tx.select({ name: contacts.name }).from(contacts).where(s.own(contacts, eq(contacts.id, doc.contactId)));
    const [org] = await s.tx.select().from(orgs).where(eq(orgs.id, s.orgId));
    return { ...row, email: row.email, doc: { ...doc, number: doc.number, shareToken: doc.shareToken }, contact: contact!, org: org! };
  });
  if (!data) return;

  const { doc, org, contact, appName } = data;
  const url = `${baseUrl}${publicInvoicePath(orgId, doc.shareToken)}`;
  const amount = formatINR(doc.total, { symbol: true });
  const credit = doc.type === "credit_note";
  const kind = credit ? "Credit note" : "Invoice";
  const subject = credit ? `${kind} ${doc.number} from ${org.name}: ${amount} refunded` : `${kind} ${doc.number} from ${org.name}: ${amount} paid`;
  const greeting = `Hello ${contact.name},`;
  const lead = credit
    ? `We have refunded ${amount} on your ${appName} subscription. Here is your credit note ${doc.number}.`
    : `Thank you for your payment of ${amount} for ${appName}. Here is your invoice ${doc.number}; it is paid in full and nothing is due.`;
  const text = [greeting, "", lead, "", `View or download it here:`, url, "", `Regards,`, org.name, org.email ?? ""].join("\n").trimEnd();
  const html = `<p>${escapeHtml(greeting)}</p><p>${escapeHtml(lead)}</p><p><a href="${url}">View ${kind.toLowerCase()} ${escapeHtml(doc.number)}</a></p><p>Regards,<br>${escapeHtml(org.name)}${org.email ? `<br>${escapeHtml(org.email)}` : ""}</p>`;

  let result: { emailStatus: "sent" | "failed"; emailError: string | null };
  try {
    if (!mailConfigured()) throw new Error("Email isn't set up: add SMTP_HOST, SMTP_USER and SMTP_PASSWORD to the app's environment variables.");
    await sendMail({ to: data.email, subject, text, html, replyTo: org.email ?? undefined, fromName: org.name });
    result = { emailStatus: "sent", emailError: null };
  } catch (err) {
    result = { emailStatus: "failed", emailError: (err instanceof Error ? err.message : String(err)).slice(0, 2000) };
  }
  await withOrg(orgId, (s) =>
    s.tx
      .update(appPayments)
      .set({ ...result, emailedAt: result.emailStatus === "sent" ? new Date() : null })
      .where(s.own(appPayments, eq(appPayments.id, appPaymentId))),
  );
}
