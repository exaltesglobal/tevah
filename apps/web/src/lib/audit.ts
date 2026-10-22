import type { Tx } from "@/db";
import { auditLog } from "@/db/schema";
import type { Session } from "./auth";

export async function audit(
  tx: Tx,
  session: Session,
  action: "create" | "update" | "archive" | "restore" | "post" | "cancel",
  entity: string,
  entityId: string,
  data?: unknown,
): Promise<void> {
  await tx.insert(auditLog).values({
    orgId: session.orgId,
    userId: session.userId,
    action,
    entity,
    entityId,
    data: data ?? null,
  });
}
