import { supplyType, type DocumentType } from "@tevah/core";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { withOrg } from "@/db";
import { requireWriter } from "@/lib/auth";
import { docPath, isUuid, SIDES, sideOf, TYPE_LABEL, type Side } from "@/lib/doc-kinds";
import { blankLine, type DocState } from "./doc-state";
import { DocumentEditor } from "./document-editor";
import { editorData } from "./editor-data";
import { loadDocument, toDocState } from "./load";

/** Today's date in India. */
const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

export async function NewDocumentPage({ side, searchParams }: { side: Side; searchParams: Promise<{ type?: string; original?: string }> }) {
  const session = await requireWriter();
  const params = await searchParams;
  const types: readonly DocumentType[] = SIDES[side].types;
  const type = types.includes(params.type as DocumentType) ? (params.type as DocumentType) : types[0]!;

  const { data, original } = await withOrg(session.orgId, async (s) => ({
    data: await editorData(s, side),
    original: isUuid(params.original) ? await loadDocument(s, params.original) : null,
  }));

  let initial: DocState = {
    contactId: "",
    date: todayIST(),
    dueDate: "",
    placeOfSupply: session.orgStateCode,
    supplyType: "intra",
    reverseCharge: false,
    vendorReference: "",
    originalDocumentId: "",
    tdsSection: "",
    tdsRate: "",
    notes: "",
    lines: [blankLine()],
  };
  // A credit or debit note starts as a copy of the document it corrects.
  if (original && original.doc.status === "posted" && sideOf(original.doc.type) === side && type !== original.doc.type) {
    const copy = toDocState(original);
    initial = { ...copy, date: todayIST(), dueDate: "", vendorReference: "", tdsRate: "", tdsSection: "", notes: "", originalDocumentId: original.doc.id };
  }
  if (!initial.contactId) initial.supplyType = supplyType(session.orgStateCode, initial.placeOfSupply);

  return (
    <>
      <PageHeader title={`New ${TYPE_LABEL[type].toLowerCase()}`} />
      <DocumentEditor type={type} id={null} initial={initial} orgStateCode={session.orgStateCode} data={data} />
    </>
  );
}

export async function EditDocumentPage({ side, id }: { side: Side; id: string }) {
  const session = await requireWriter();
  if (!isUuid(id)) notFound();
  const loaded = await withOrg(session.orgId, async (s) => {
    const doc = await loadDocument(s, id);
    return doc && sideOf(doc.doc.type) === side ? { doc, data: await editorData(s, side) } : null;
  });
  if (!loaded) notFound();
  const { doc, data } = loaded;
  if (doc.doc.status !== "draft") redirect(docPath(doc.doc.type, id));

  return (
    <>
      <PageHeader title={`Edit draft ${TYPE_LABEL[doc.doc.type].toLowerCase()}`} />
      <DocumentEditor type={doc.doc.type} id={id} initial={toDocState(doc)} orgStateCode={session.orgStateCode} data={data} />
    </>
  );
}
