import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

export function PageHeader({ title, actions, subtitle }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-stone-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

const buttonStyles = {
  primary: "bg-brand-600 text-white shadow-sm shadow-brand-700/20 hover:bg-brand-700",
  secondary: "border border-stone-200 bg-white text-stone-800 shadow-xs hover:border-stone-300 hover:bg-stone-50",
  danger: "border border-red-200 bg-white text-red-700 hover:bg-red-50",
};

type Variant = keyof typeof buttonStyles;
const buttonBase =
  "inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition duration-150 disabled:opacity-50";

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={cx(buttonBase, buttonStyles[variant], className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={cx(buttonBase, buttonStyles[variant], className)} {...props} />;
}

const inputBase =
  "w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm shadow-xs transition duration-150 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(inputBase, className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cx(inputBase, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx(inputBase, className)} rows={3} {...props} />;
}

export function Field({
  label,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1 block text-sm font-medium text-stone-700">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-red-600">{error}</span>
      ) : (
        hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>
      )}
    </label>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-xl border border-stone-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(42,27,30,0.04),0_4px_16px_-6px_rgba(42,27,30,0.08)]", className)}>{children}</div>;
}

const badgeTones = {
  stone: ["bg-stone-100 text-stone-700 ring-stone-200", "bg-stone-400"],
  brand: ["bg-brand-50 text-brand-700 ring-brand-100", "bg-brand-500"],
  amber: ["bg-amber-50 text-amber-800 ring-amber-200/70", "bg-amber-500"],
  green: ["bg-green-50 text-green-800 ring-green-200/70", "bg-green-500"],
  // Warnings and errors use the orange-red, never brand crimson.
  red: ["bg-red-50 text-red-700 ring-red-200/70", "bg-red-500"],
} as const;

export function Badge({ children, tone = "stone" }: { children: ReactNode; tone?: keyof typeof badgeTones }) {
  const [pill, dot] = badgeTones[tone];
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", pill)}>
      <span className={cx("h-1.5 w-1.5 rounded-full", dot)} />
      {children}
    </span>
  );
}

export function Table({ head, children, empty }: { head: ReactNode; children: ReactNode; empty?: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-stone-200/80 bg-white shadow-[0_1px_2px_rgba(42,27,30,0.04),0_4px_16px_-6px_rgba(42,27,30,0.08)]">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-stone-200/80 bg-stone-50/70 text-[11px] uppercase tracking-wider text-stone-500">
          {head}
        </thead>
        <tbody className="divide-y divide-stone-100 [&_td]:px-4 [&_td]:py-3 [&_tr]:transition-colors [&_tr:hover]:bg-stone-50/70">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cx("px-4 py-2.5 font-medium", className)}>{children}</th>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="px-4 py-10 text-center text-sm text-stone-500">{children}</div>;
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{message}</div>;
}
