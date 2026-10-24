import { EditDocumentPage } from "../../../documents/pages";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <EditDocumentPage side="sales" id={(await params).id} />;
}
