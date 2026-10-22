import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { ImportForm } from "./import-form";

export const metadata = { title: "Import from Odoo" };

export default async function OdooImportPage() {
  const session = await requireSession();
  if (session.role !== "admin") redirect("/settings");
  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Import from Odoo"
        subtitle={
          <>
            <Link href="/settings" className="text-brand-700 hover:underline">
              Company
            </Link>{" "}
            · contacts, products, the full ledger, invoices and bills, projects, tasks and timesheets
          </>
        }
      />
      <Card>
        <h2 className="mb-2 font-semibold">1. Export from Odoo on your computer</h2>
        <p className="mb-3 text-sm text-stone-600">
          The export script only reads from Odoo. Create an API key in Odoo (your avatar → My Profile → Account Security → New API Key), then in the Tevah
          folder run:
        </p>
        <pre className="overflow-x-auto rounded-md bg-stone-900 px-4 py-3 text-xs text-stone-100">
          {`node apps/web/scripts/odoo-export.mjs --url https://yourcompany.odoo.com --db yourcompany --user you@example.com`}
        </pre>
        <p className="mt-3 text-sm text-stone-600">
          It asks for the API key without showing it, and writes <code>odoo-export.json</code>. That file holds your customers&apos; details, so delete it once the
          import is done.
        </p>
      </Card>
      <div>
        <h2 className="mb-2 font-semibold">2. Upload, preview, then import</h2>
        <p className="mb-3 text-sm text-stone-600">
          Run it again with a fresh export as often as you like: anything already imported is skipped. While you run Tevah and Odoo side by side, an entry
          you typed into both is recognised and linked rather than added twice, and Preview lists anything that is only in one of them.
        </p>
        <ImportForm />
      </div>
    </div>
  );
}
