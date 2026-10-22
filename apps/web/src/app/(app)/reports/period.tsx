import { financialYearRange, monthRange } from "@tevah/core";
import Link from "next/link";
import { Button, Input } from "@/components/ui";

export type PeriodParams = Promise<{ from?: string; to?: string; [k: string]: string | undefined }>;

const isDate = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

export const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Period from the query string, defaulting to the financial year to date (India time). */
export function readPeriod(params: { from?: string; to?: string }, fyStartMonth = 4): { from: string; to: string } {
  const fy = financialYearRange(today(), fyStartMonth);
  const from = isDate(params.from) ? params.from : fy.from;
  const to = isDate(params.to) ? params.to : today();
  return from <= to ? { from, to } : { from: to, to: from };
}

export function readDate(value: string | undefined): string {
  return isDate(value) ? value : today();
}

export function presets(fyStartMonth = 4) {
  const now = today();
  const month = monthRange(now);
  const lastMonth = monthRange(shift(month.from, -1));
  const fy = financialYearRange(now, fyStartMonth);
  const lastFy = financialYearRange(shift(fy.from, -1), fyStartMonth);
  return [
    { label: "This month", ...month },
    { label: "Last month", ...lastMonth },
    { label: "This year", from: fy.from, to: fy.to },
    { label: "Last year", ...lastFy },
  ];
}

const query = (base: Record<string, string | undefined>, extra: Record<string, string>) =>
  "?" + new URLSearchParams({ ...(Object.fromEntries(Object.entries(base).filter(([, v]) => v)) as Record<string, string>), ...extra }).toString();

/** From/to form with quick presets; keeps other query parameters. */
export function PeriodPicker({
  from,
  to,
  keep = {},
  fyStartMonth,
}: {
  from: string;
  to: string;
  keep?: Record<string, string | undefined>;
  fyStartMonth?: number;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end gap-3 print:hidden">
      <form className="flex flex-wrap items-end gap-2">
        {Object.entries(keep).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
        <label className="text-xs text-stone-500">
          From
          <Input type="date" name="from" defaultValue={from} className="mt-1 w-auto!" />
        </label>
        <label className="text-xs text-stone-500">
          To
          <Input type="date" name="to" defaultValue={to} className="mt-1 w-auto!" />
        </label>
        <Button variant="secondary">Show</Button>
      </form>
      <div className="flex flex-wrap gap-1 text-sm">
        {presets(fyStartMonth).map((p) => (
          <Link key={p.label} href={query(keep, { from: p.from, to: p.to })} className="rounded-md px-2 py-1 text-brand-700 hover:bg-brand-50">
            {p.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Single as-of date picker. */
export function DatePicker({ name = "asOf", value, keep = {} }: { name?: string; value: string; keep?: Record<string, string | undefined> }) {
  return (
    <form className="mb-5 flex flex-wrap items-end gap-2 print:hidden">
      {Object.entries(keep).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
      <label className="text-xs text-stone-500">
        As of
        <Input type="date" name={name} defaultValue={value} className="mt-1 w-auto!" />
      </label>
      <Button variant="secondary">Show</Button>
    </form>
  );
}

export const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};
