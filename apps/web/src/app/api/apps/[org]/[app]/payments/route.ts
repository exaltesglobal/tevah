import { handleAppRequest } from "@/lib/app-webhook";

export const dynamic = "force-dynamic";

/** An app of ours reporting a payment it took, signed with X-Tevah-Signature. */
export async function POST(req: Request, ctx: { params: Promise<{ org: string; app: string }> }) {
  const { org, app } = await ctx.params;
  return handleAppRequest(req, org, app, "api");
}
