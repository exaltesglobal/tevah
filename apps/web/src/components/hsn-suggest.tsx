"use client";

import { autoHsn, suggestHsn, type HsnKind, type HsnSuggestion } from "@tevah/core";
import { useEffect, useMemo, useRef } from "react";

export type HsnHistory = readonly { name: string; hsnSac: string | null }[];

/**
 * Fills an empty HSN/SAC field from the item name, and offers the other
 * likely codes as chips. It never overwrites a code the user typed or picked.
 */
export function useAutoHsn({
  name,
  kind,
  history,
  value,
  setValue,
}: {
  name: string;
  kind?: HsnKind;
  history?: HsnHistory;
  value: string;
  setValue: (code: string) => void;
}) {
  // The code we filled in ourselves; while the field still holds it, a better match may replace it.
  const filled = useRef<string | null>(null);
  const suggestions = useMemo(() => suggestHsn(name, { kind, history, limit: 3 }), [name, kind, history]);

  useEffect(() => {
    const mine = value === "" || value === filled.current;
    if (!mine) return;
    const best = autoHsn(name, { kind, history });
    const next = best?.code ?? "";
    if (next !== value) {
      filled.current = next || null;
      setValue(next);
    }
  }, [name, kind, history, value, setValue]);

  return { suggestions, auto: value !== "" && value === filled.current };
}

export function HsnChips({
  suggestions,
  value,
  auto,
  onPick,
  from = "name",
}: {
  suggestions: HsnSuggestion[];
  value: string;
  auto: boolean;
  onPick: (code: string) => void;
  from?: string;
}) {
  if (suggestions.length === 0) return null;
  const current = suggestions.find((s) => s.code === value);
  return (
    <div className="mt-1.5 space-y-1">
      {auto && current && (
        <p className="text-xs text-stone-500">
          Filled in from the {from}: <span className="text-stone-700">{current.description}</span>. Check it before posting.
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {suggestions
          .filter((s) => s.code !== value)
          .map((s) => (
            <button
              key={s.code}
              type="button"
              onClick={() => onPick(s.code)}
              title={s.description}
              className="max-w-full truncate rounded-full border border-stone-200 bg-white px-2 py-0.5 text-xs text-stone-600 hover:border-brand-500 hover:text-brand-700"
            >
              <span className="font-mono">{s.code}</span> · {s.description}
              {s.source === "history" && <span className="text-stone-400"> (used before)</span>}
            </button>
          ))}
      </div>
    </div>
  );
}
