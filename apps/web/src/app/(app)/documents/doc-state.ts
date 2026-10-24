/** Editor state for a document, shared by the server pages that seed it and the client editor. */
export interface LineState {
  key: string;
  productId: string;
  description: string;
  hsnSac: string;
  /** Code the editor filled in from the description; replaced as the description changes, until the user edits it. */
  autoHsn?: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  discount: string;
  gstRateBps: string;
  accountId: string;
}

export interface DocState {
  contactId: string;
  date: string;
  dueDate: string;
  placeOfSupply: string;
  supplyType: "intra" | "inter" | "export";
  reverseCharge: boolean;
  vendorReference: string;
  originalDocumentId: string;
  tdsSection: string;
  tdsRate: string;
  notes: string;
  lines: LineState[];
}

let nextKey = 0;
export const blankLine = (): LineState => ({
  key: `l${nextKey++}`,
  productId: "",
  description: "",
  hsnSac: "",
  quantity: "1",
  unit: "NOS",
  unitPrice: "",
  discount: "",
  gstRateBps: "1800",
  accountId: "",
});
