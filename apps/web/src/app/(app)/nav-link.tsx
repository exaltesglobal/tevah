"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, siblings = [], children }: { href: string; siblings?: string[]; children: React.ReactNode }) {
  const path = usePathname();
  const matches = (h: string) => (h === "/" ? path === "/" : path === h || path.startsWith(`${h}/`));
  // The most specific match wins, so /settings/invoice-design doesn't also light up /settings.
  const active = matches(href) && !siblings.some((o) => o.length > href.length && o.startsWith(href) && matches(o));
  return (
    <Link
      href={href}
      className={`whitespace-nowrap rounded-md px-3 py-2 text-sm ${
        active ? "bg-brand-50 font-medium text-brand-700" : "text-stone-600 hover:bg-stone-100"
      }`}
    >
      {children}
    </Link>
  );
}
