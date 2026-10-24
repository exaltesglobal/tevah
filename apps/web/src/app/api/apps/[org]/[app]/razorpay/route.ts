import { handleAppRequest } from "@/lib/app-webhook";

export const dynamic = "force-dynamic";

/** Razorpay webhook for one connected app. Paste this URL into the Razorpay dashboard with the app's secret. */
export async function POST(req: Request, ctx: { params: Promise<{ org: string; app: string }> }) {
  const { org, app } = await ctx.params;
  return handleAppRequest(req, org, app, "razorpay");
}
