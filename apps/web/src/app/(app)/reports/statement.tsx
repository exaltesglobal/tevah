import { formatINR, type StatementLine } from "@tevah/core";
import Link from "next/link";
import type { ReactNode } from "react";

/** One section of a financial statement: a heading, account lines and a subtotal. */
export function StatementSection({
  title,
  lines,
  total,
  totalLabel,
  ledgerQuery,
  extra,
}: {
  title: string;
  lines: StatementLine[];
  total: number;
  totalLabel: string;
  ledgerQuery: string;
  extra?: ReactNode;
}) {
  return (
    <section className="mb-6">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-stone-500">{title}</h2>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-stone-100">
          {lines.map((l) => (
            <tr key={l.id}>
              <td className="w-20 py-1.5 font-mono text-xs text-stone-500">{l.code}</td>
              <td className="py-1.5">
                <Link href={`/reports/general-ledger?account=${l.id}&${ledgerQuery}`} className="hover:text-brand-700 hover:underline">
                  {l.name}
                </Link>
              </td>
              <td className="py-1.5 text-right tabular-nums">{formatINR(l.amount)}</td>
            </tr>
          ))}
          {extra}
          {lines.length === 0 && !extra && (
            <tr>
              <td colSpan={3} className="py-1.5 text-stone-500">
                Nothing posted
              </td>
            </tr>
          )}
          <tr className="font-semibold">
            <td />
            <td className="py-2">{totalLabel}</td>
            <td className="py-2 text-right tabular-nums">{formatINR(total)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
