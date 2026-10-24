import { DocumentView } from "../../documents/document-view";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <DocumentView side="sales" id={(await params).id} />;
}
