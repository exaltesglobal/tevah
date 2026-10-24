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
      aria-current={active ? "page" : undefined}
      className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors ${
        active ? "bg-white/[0.08] font-medium text-white" : "text-stone-300 hover:bg-white/[0.05] hover:text-white"
      }`}
    >
      {active && <span className="absolute top-1.5 bottom-1.5 left-0 hidden w-[3px] rounded-full bg-brand-500 md:block" />}
      {children}
    </Link>
  );
}
