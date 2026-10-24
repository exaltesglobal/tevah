import { headers } from "next/headers";

/** Where this Tevah is reached from outside, for links in emails and webhook addresses. */
export async function baseUrl(): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

export const originOf = (req: Request): string => process.env.APP_URL?.replace(/\/+$/, "") ?? new URL(req.url).origin;
