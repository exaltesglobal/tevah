import { DocumentView } from "../../documents/document-view";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <DocumentView side="purchases" id={(await params).id} />;
}
