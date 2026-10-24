"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const path = usePathname();
  const active = href === "/" ? path === "/" : path.startsWith(href);
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
