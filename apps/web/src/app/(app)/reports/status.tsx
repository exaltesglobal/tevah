import type { ReactNode } from "react";

/** A green "ties out" or amber "check this" line under a report. */
export function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <p className={`mt-3 rounded-md px-3 py-2 text-sm ${ok ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>
      {ok ? "✓ " : "! "}
      {children}
    </p>
  );
}
