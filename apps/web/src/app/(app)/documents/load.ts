import { asc, eq } from "drizzle-orm";
import type { Scope } from "@/db";
import { documentLines, documents } from "@/db/schema";
import type { DocState } from "./doc-state";

const rupees = (paise: number) => (paise / 100).toFixed(2);
const trimZeros = (n: number) => String(Number(n.toFixed(3)));

export async function loadDocument(s: Scope, id: string) {
  const [doc] = await s.tx.select().from(documents).where(s.own(documents, eq(documents.id, id)));
  if (!doc) return null;
  const lines = await s.tx
    .select()
    .from(documentLines)
    .where(s.own(documentLines, eq(documentLines.documentId, id)))
    .orderBy(asc(documentLines.position));
  return { doc, lines };
}

/** The editor's state for an existing draft. */
export function toDocState({ doc, lines }: NonNullable<Awaited<ReturnType<typeof loadDocument>>>): DocState {
  return {
    contactId: doc.contactId,
    date: doc.date,
    dueDate: doc.dueDate ?? "",
    placeOfSupply: doc.placeOfSupply,
    supplyType: doc.supplyType,
    reverseCharge: doc.reverseCharge,
    vendorReference: doc.vendorReference ?? "",
    originalDocumentId: doc.originalDocumentId ?? "",
    tdsSection: doc.tdsSection ?? "",
    tdsRate: doc.tdsRateBps ? trimZeros(doc.tdsRateBps / 100) : "",
    notes: doc.notes ?? "",
    lines: lines.map((l) => ({
      key: l.id,
      productId: l.productId ?? "",
      description: l.description,
      hsnSac: l.hsnSac ?? "",
      quantity: trimZeros(l.quantityMilli / 1000),
      unit: l.unit,
      unitPrice: rupees(l.unitPrice),
      discount: l.discountBps ? trimZeros(l.discountBps / 100) : "",
      gstRateBps: String(l.gstRateBps),
      accountId: l.accountId,
    })),
  };
}
