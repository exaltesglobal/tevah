import nodemailer from "nodemailer";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  fromName?: string;
}

/** Mail captured instead of sent while MAIL_TRANSPORT=json (tests). */
export const sentMail: Mail[] = [];

/**
 * Outgoing mail goes through the company's own mailbox over SMTP, which on
 * Hostinger is smtp.hostinger.com port 465. Set SMTP_HOST, SMTP_USER and
 * SMTP_PASSWORD; MAIL_FROM defaults to SMTP_USER and SMTP_PORT to 465.
 */
export function mailConfigured(): boolean {
  return process.env.MAIL_TRANSPORT === "json" || !!process.env.SMTP_HOST;
}

export async function sendMail(mail: Mail): Promise<void> {
  if (process.env.MAIL_TRANSPORT === "json") {
    sentMail.push(mail);
    return;
  }
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  if (!host || !user || !pass) throw new Error("Email isn't set up: add SMTP_HOST, SMTP_USER and SMTP_PASSWORD to the app's environment variables.");
  const port = Number(process.env.SMTP_PORT || 465);
  const from = process.env.MAIL_FROM || user;
  const transport = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 });
  await transport.sendMail({
    from: mail.fromName ? { name: mail.fromName, address: from } : from,
    to: mail.to,
    replyTo: mail.replyTo,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
