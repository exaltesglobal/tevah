import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { logout } from "../login/actions";
import { NavLink } from "./nav-link";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/sales", label: "Sales" },
  { href: "/purchases", label: "Purchases" },
  { href: "/payments", label: "Payments" },
  { href: "/contacts", label: "Contacts" },
  { href: "/products", label: "Products & services" },
  { href: "/accounts", label: "Chart of accounts" },
  { href: "/settings", label: "Company" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <div className="min-h-screen md:flex">
      <aside className="print:hidden border-b border-stone-200 bg-white md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex items-center justify-between px-5 py-4 md:block">
          <Link href="/" aria-label="Tevah home">
            <img src="/tevah-logo.svg" alt="Tevah" width={130} height={32} className="h-8 w-auto" />
          </Link>
          <div className="flex items-center gap-3 text-xs text-stone-500 md:mt-1">
            {session.orgName}
            <Link href="/account" className="text-brand-700 hover:underline md:hidden">
              Account
            </Link>
            <form action={logout} className="md:hidden">
              <button className="text-brand-700 hover:underline">Sign out</button>
            </form>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:pb-0">
          {NAV.map((item) => (
            <NavLink key={item.href} href={item.href}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="hidden border-t border-stone-200 px-5 py-4 text-xs text-stone-500 md:absolute md:bottom-0 md:block md:w-full">
          <div className="truncate font-medium text-stone-700">{session.userName}</div>
          <div className="truncate">{session.email}</div>
          <Link href="/account" className="mt-2 block text-brand-700 hover:underline">
            Change password
          </Link>
          <form action={logout} className="mt-2">
            <button className="text-brand-700 hover:underline">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8 print:max-w-none print:p-0">{children}</main>
    </div>
  );
}
