import type { Scope } from "@/db";
import { auditLog } from "@/db/schema";
import type { Session } from "./auth";

export async function audit(
  { tx, orgId }: Scope,
  session: Session,
  action: "create" | "update" | "archive" | "restore" | "post" | "cancel",
  entity: string,
  entityId: string,
  data?: unknown,
): Promise<void> {
  await tx.insert(auditLog).values({
    orgId,
    userId: session.userId,
    action,
    entity,
    entityId,
    data: data ?? null,
  });
}
