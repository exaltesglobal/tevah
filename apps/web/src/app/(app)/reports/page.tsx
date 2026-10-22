import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth";

export const metadata = { title: "Reports" };

const GROUPS = [
  {
    title: "Financial statements",
    reports: [
      { href: "/reports/profit-and-loss", name: "Profit and loss", about: "Income and expenses for a period" },
      { href: "/reports/balance-sheet", name: "Balance sheet", about: "Assets, liabilities and equity on a date" },
      { href: "/reports/trial-balance", name: "Trial balance", about: "Every account's debit or credit balance" },
      { href: "/reports/general-ledger", name: "General ledger", about: "Each entry on an account, with running balance" },
    ],
  },
  {
    title: "Customers and vendors",
    reports: [
      { href: "/reports/ageing?kind=receivable", name: "Receivables ageing", about: "Who owes you, and for how long" },
      { href: "/reports/ageing?kind=payable", name: "Payables ageing", about: "What you owe vendors, by due date" },
      { href: "/reports/tds", name: "TDS summary", about: "TDS you deducted, and TDS customers deducted from you" },
    ],
  },
  {
    title: "GST",
    reports: [
      { href: "/gst", name: "GSTR-1 and GSTR-3B", about: "Monthly return summaries with portal JSON and CSV downloads" },
    ],
  },
];

export default async function ReportsPage() {
  await requireSession();
  return (
    <>
      <PageHeader title="Reports" subtitle="All figures come from posted entries in the ledger" />
      <div className="space-y-8">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">{g.title}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {g.reports.map((r) => (
                <Link key={r.href} href={r.href}>
                  <Card className="h-full transition hover:border-brand-500">
                    <div className="font-medium text-brand-700">{r.name}</div>
                    <div className="mt-1 text-sm text-stone-500">{r.about}</div>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
