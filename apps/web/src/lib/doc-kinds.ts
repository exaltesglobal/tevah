import { isSalesDocument, type DocumentType } from "@tevah/core";

export type Side = "sales" | "purchases";

export const SIDES = {
  sales: {
    title: "Sales",
    subtitle: "Tax invoices and credit notes",
    types: ["invoice", "credit_note"],
    contactLabel: "Customer",
    contactKinds: ["customer", "both"],
  },
  purchases: {
    title: "Purchases",
    subtitle: "Vendor bills and debit notes",
    types: ["bill", "debit_note"],
    contactLabel: "Vendor",
    contactKinds: ["vendor", "both"],
  },
} as const satisfies Record<Side, { types: readonly DocumentType[]; [k: string]: unknown }>;

export const TYPE_LABEL: Record<DocumentType, string> = {
  invoice: "Tax invoice",
  credit_note: "Credit note",
  bill: "Vendor bill",
  debit_note: "Debit note",
};

export const sideOf = (type: DocumentType): Side => (isSalesDocument(type) ? "sales" : "purchases");
export const docPath = (type: DocumentType, id: string) => `/${sideOf(type)}/${id}`;

export const isUuid = (v: string | undefined): v is string => !!v && /^[0-9a-f-]{36}$/.test(v);
