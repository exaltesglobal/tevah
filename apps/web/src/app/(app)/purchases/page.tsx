import { DocumentList, type ListParams } from "../documents/document-list";

export const metadata = { title: "Purchases" };

export default function Page({ searchParams }: { searchParams: ListParams }) {
  return <DocumentList side="purchases" searchParams={searchParams} />;
}
