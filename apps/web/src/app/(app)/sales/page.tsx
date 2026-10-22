import { DocumentList, type ListParams } from "../documents/document-list";

export const metadata = { title: "Sales" };

export default function Page({ searchParams }: { searchParams: ListParams }) {
  return <DocumentList side="sales" searchParams={searchParams} />;
}
