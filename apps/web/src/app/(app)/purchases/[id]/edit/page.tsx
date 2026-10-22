import { EditDocumentPage } from "../../../documents/pages";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <EditDocumentPage side="purchases" id={(await params).id} />;
}
