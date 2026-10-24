import Link from "next/link";
import { Icon, type IconName } from "@/components/icons";
import { requireSession } from "@/lib/auth";
import { logout } from "../login/actions";
import { NavLink } from "./nav-link";

const NAV: { title?: string; items: { href: string; label: string; icon: IconName }[] }[] = [
  { items: [{ href: "/", label: "Dashboard", icon: "dashboard" }] },
  {
    title: "Money",
    items: [
      { href: "/sales", label: "Sales", icon: "sales" },
      { href: "/purchases", label: "Purchases", icon: "purchase" },
      { href: "/payments", label: "Payments", icon: "payment" },
      { href: "/banking", label: "Banking", icon: "bank" },
    ],
  },
  {
    title: "Accounting",
    items: [
      { href: "/journal", label: "Journal entries", icon: "journal" },
      { href: "/reports", label: "Reports", icon: "reports" },
      { href: "/gst", label: "GST returns", icon: "gst" },
      { href: "/accounts", label: "Chart of accounts", icon: "ledger" },
    ],
  },
  {
    title: "Work",
    items: [
      { href: "/projects", label: "Projects", icon: "project" },
      { href: "/tasks", label: "My tasks", icon: "tasks" },
    ],
  },
  {
    title: "Records",
    items: [
      { href: "/contacts", label: "Contacts", icon: "customer" },
      { href: "/products", label: "Products & services", icon: "product" },
    ],
  },
  {
    title: "Settings",
    items: [
      { href: "/settings/invoice-design", label: "Invoice design", icon: "invoice" },
      { href: "/settings", label: "Company", icon: "settings" },
    ],
  },
];

const HREFS = NAV.flatMap((g) => g.items.map((i) => i.href));

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const initials = session.userName
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="min-h-screen md:flex">
      <aside className="print:hidden bg-stone-900 text-stone-300 md:sticky md:top-0 md:flex md:h-screen md:w-64 md:shrink-0 md:flex-col">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 md:block">
          <Link href="/" aria-label="Tevah home" className="block">
            <img src="/tevah-logo-reverse.svg" alt="Tevah" width={120} height={30} className="h-7 w-auto" />
          </Link>
          <div className="truncate text-xs text-stone-400 md:mt-2">{session.orgName}</div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:gap-0 md:overflow-y-auto md:pb-4">
          {NAV.map((group, gi) => (
            <div key={gi} className="flex gap-1 md:mt-4 md:block md:first:mt-0">
              {group.title && (
                <div className="hidden px-3 pb-1.5 text-[11px] font-semibold tracking-[0.08em] text-stone-500 uppercase md:block">
                  {group.title}
                </div>
              )}
              {group.items.map((item) => (
                <NavLink key={item.href} href={item.href} siblings={HREFS}>
                  <Icon name={item.icon} className="h-[18px] w-[18px] shrink-0 opacity-80" />
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="hidden items-center gap-3 border-t border-white/10 px-4 py-3.5 md:flex">
          <Link
            href="/account"
            title="Account and password"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white ring-2 ring-brand-200/30"
          >
            {initials}
          </Link>
          <Link href="/account" className="min-w-0 flex-1 text-xs">
            <div className="truncate font-medium text-white">{session.userName}</div>
            <div className="truncate text-stone-400">{session.email}</div>
          </Link>
          <form action={logout}>
            <button aria-label="Sign out" title="Sign out" className="rounded-md p-1.5 text-stone-400 hover:bg-white/10 hover:text-white">
              <Icon name="logout" />
            </button>
          </form>
        </div>
      </aside>
      <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-10 md:py-9 print:max-w-none print:p-0">{children}</main>
    </div>
  );
}
