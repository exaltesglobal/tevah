import { NewDocumentPage } from "../../documents/pages";

export const metadata = { title: "New document" };

export default function Page({ searchParams }: { searchParams: Promise<{ type?: string; original?: string }> }) {
  return <NewDocumentPage side="sales" searchParams={searchParams} />;
}
