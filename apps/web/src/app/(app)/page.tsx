import { formatINR } from "@tevah/core";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import Link from "next/link";
import { Icon, type IconName } from "@/components/icons";
import { ButtonLink, Card } from "@/components/ui";
import { getDb, withOrg } from "@/db";
import { contacts, documents, orgs, payments } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { StatusBadge } from "./documents/document-list";
import { fmtDate, today } from "./reports/period";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** First day of the month `back` months before the month of `iso`. */
const monthStart = (iso: string, back = 0) => {
  const d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1 - back, 1));
  return d.toISOString().slice(0, 10);
};

const greeting = () => {
  const hour = new Date(Date.now() + 5.5 * 3_600_000).getUTCHours();
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
};

export default async function Dashboard() {
  const session = await requireSession();
  const [org] = await getDb().select().from(orgs).where(eq(orgs.id, session.orgId));
  const now = today();
  const thisMonth = monthStart(now);
  const lastMonth = monthStart(now, 1);
  const sixMonths = monthStart(now, 5);

  const data = await withOrg(session.orgId, async (s) => {
    const due = sql`${documents.total} - ${documents.tdsAmount} - ${documents.amountPaid}`;
    const open = (type: "invoice" | "bill") =>
      s.tx
        .select({
          due: sql<string>`coalesce(sum(${due}), 0)`,
          overdue: sql<string>`coalesce(sum(case when ${documents.dueDate} < ${now} then ${due} else 0 end), 0)`,
          overdueCount: sql<number>`coalesce(sum(${documents.dueDate} < ${now} and ${due} > 0), 0)`.mapWith(Number),
        })
        .from(documents)
        .where(s.own(documents, and(eq(documents.type, type), eq(documents.status, "posted"))))
        .then(([r]) => ({ due: Number(r?.due ?? 0), overdue: Number(r?.overdue ?? 0), overdueCount: r?.overdueCount ?? 0 }));

    // Net sales by month: invoices less credit notes, before GST.
    const monthly = await s.tx
      .select({
        month: sql<string>`date_format(${documents.date}, '%Y-%m')`,
        net: sql<string>`coalesce(sum(case when ${documents.type} = 'invoice' then ${documents.taxable} else -${documents.taxable} end), 0)`,
      })
      .from(documents)
      .where(
        s.own(
          documents,
          and(inArray(documents.type, ["invoice", "credit_note"]), eq(documents.status, "posted"), gte(documents.date, sixMonths)),
        ),
      )
      .groupBy(sql`1`);

    const [received] = await s.tx
      .select({ n: sql<string>`coalesce(sum(${payments.amount}), 0)` })
      .from(payments)
      .where(s.own(payments, and(eq(payments.direction, "received"), eq(payments.status, "posted"), gte(payments.date, thisMonth))));

    const overdue = await s.tx
      .select({ doc: documents, contactName: contacts.name })
      .from(documents)
      .innerJoin(contacts, eq(contacts.id, documents.contactId))
      .where(
        s.own(
          documents,
          and(eq(documents.type, "invoice"), eq(documents.status, "posted"), lt(documents.dueDate, now), sql`${due} > 0`),
        ),
      )
      .orderBy(documents.dueDate)
      .limit(5);

    const recent = await s.tx
      .select({ doc: documents, contactName: contacts.name })
      .from(documents)
      .innerJoin(contacts, eq(contacts.id, documents.contactId))
      .where(s.own(documents))
      .orderBy(desc(documents.updatedAt))
      .limit(6);

    return {
      receivable: await open("invoice"),
      payable: await open("bill"),
      monthly: new Map(monthly.map((m) => [m.month, Number(m.net)])),
      received: Number(received?.n ?? 0),
      overdue,
      recent,
    };
  });

  const months = Array.from({ length: 6 }, (_, i) => {
    const start = monthStart(now, 5 - i);
    return { key: start.slice(0, 7), label: MONTHS[Number(start.slice(5, 7)) - 1]!, value: data.monthly.get(start.slice(0, 7)) ?? 0 };
  });
  const salesNow = data.monthly.get(thisMonth.slice(0, 7)) ?? 0;
  const salesBefore = data.monthly.get(lastMonth.slice(0, 7)) ?? 0;
  const change = salesBefore > 0 ? Math.round(((salesNow - salesBefore) / salesBefore) * 100) : null;

  return (
    <>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-stone-500">
            {new Date(`${now}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}
          </p>
          <h1 className="mt-1 text-[28px] font-semibold leading-tight tracking-[-0.02em] text-stone-900">
            {greeting()}, {session.userName.split(" ")[0]}
          </h1>
          {org && <p className="mt-1 text-sm text-stone-500">{org.legalName}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/sales/new">
            <Icon name="plus" className="h-4 w-4" /> New invoice
          </ButtonLink>
          <ButtonLink href="/purchases/new" variant="secondary">
            Record bill
          </ButtonLink>
          <ButtonLink href="/payments/new" variant="secondary">
            Record payment
          </ButtonLink>
        </div>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="To receive"
          icon="sales"
          value={data.receivable.due}
          href="/sales?status=due"
          foot={
            data.receivable.overdue > 0 ? (
              <span className="text-red-700">
                {formatINR(data.receivable.overdue, { symbol: true })} overdue on {data.receivable.overdueCount}{" "}
                {data.receivable.overdueCount === 1 ? "invoice" : "invoices"}
              </span>
            ) : (
              "Nothing overdue"
            )
          }
        />
        <Kpi
          label="To pay"
          icon="purchase"
          value={data.payable.due}
          href="/purchases?status=due"
          foot={data.payable.overdue > 0 ? `${formatINR(data.payable.overdue, { symbol: true })} past due date` : "Nothing past due"}
        />
        <Kpi
          label="Sales this month"
          icon="reports"
          value={salesNow}
          href="/reports/profit-and-loss"
          foot={
            change === null ? (
              "Before GST, less credit notes"
            ) : (
              <span className={change >= 0 ? "text-green-800" : "text-red-700"}>
                {change >= 0 ? "▲" : "▼"} {Math.abs(change)}% vs last month
              </span>
            )
          }
        />
        <Kpi label="Received this month" icon="payment" value={data.received} href="/payments" foot="Customer payments" />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-5">
        <Card className="flex flex-col lg:col-span-3">
          <div className="mb-5 flex items-baseline justify-between">
            <h2 className="font-semibold text-stone-900">Sales, last 6 months</h2>
            <span className="text-xs text-stone-500">Before GST</span>
          </div>
          <SalesChart months={months} />
        </Card>
        <Card className="p-0! lg:col-span-2">
          <div className="flex items-baseline justify-between px-5 pt-5 pb-3">
            <h2 className="font-semibold text-stone-900">Overdue invoices</h2>
            <Link href="/sales?status=due" className="text-xs font-medium text-brand-700 hover:underline">
              See all
            </Link>
          </div>
          {data.overdue.length === 0 ? (
            <p className="px-5 pb-6 text-sm text-stone-500">No invoice is past its due date.</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {data.overdue.map(({ doc, contactName }) => (
                <li key={doc.id}>
                  <Link href={`/sales/${doc.id}`} className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-stone-50">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-stone-900">{contactName}</div>
                      <div className="text-xs text-stone-500">
                        {doc.number} · due {fmtDate(doc.dueDate!)} · {daysLate(doc.dueDate!, now)}
                      </div>
                    </div>
                    <Money value={doc.total - doc.tdsAmount - doc.amountPaid} className="text-sm font-semibold" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-0!">
        <div className="px-5 pt-5 pb-3">
          <h2 className="font-semibold text-stone-900">Recent activity</h2>
        </div>
        {data.recent.length === 0 ? (
          <p className="px-5 pb-6 text-sm text-stone-500">Your invoices and bills will show up here.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {data.recent.map(({ doc, contactName }) => {
              const side = doc.type === "invoice" || doc.type === "credit_note" ? "sales" : "purchases";
              return (
                <li key={doc.id}>
                  <Link href={`/${side}/${doc.id}`} className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-stone-50">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-600">
                      <Icon name={side === "sales" ? "invoice" : "purchase"} className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-stone-900">{contactName}</div>
                      <div className="text-xs text-stone-500">
                        {doc.number ?? "Draft"} · {fmtDate(doc.date)}
                      </div>
                    </div>
                    <span className="hidden sm:block">
                      <StatusBadge doc={doc} />
                    </span>
                    <Money value={doc.total} className="w-28 text-right text-sm font-medium" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}

function daysLate(due: string, now: string) {
  const days = Math.round((Date.parse(now) - Date.parse(due)) / 86_400_000);
  return `${days} ${days === 1 ? "day" : "days"} late`;
}

/** Rupees in full weight, paise lighter. */
function Money({ value, className }: { value: number; className?: string }) {
  const text = formatINR(value, { symbol: true });
  const dot = text.lastIndexOf(".");
  return (
    <span className={`tabular-nums text-stone-900 ${className ?? ""}`}>
      {text.slice(0, dot)}
      <span className="text-stone-400">{text.slice(dot)}</span>
    </span>
  );
}

function Kpi({ label, icon, value, href, foot }: { label: string; icon: IconName; value: number; href: string; foot: React.ReactNode }) {
  return (
    <Link href={href} className="group">
      <Card className="h-full transition duration-150 group-hover:-translate-y-px group-hover:border-stone-300 group-hover:shadow-[0_2px_4px_rgba(42,27,30,0.05),0_12px_24px_-10px_rgba(42,27,30,0.16)]">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-stone-500">{label}</span>
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <Icon name={icon} className="h-4 w-4" />
          </span>
        </div>
        <Money value={value} className="mt-3 block text-[26px] font-semibold leading-none tracking-[-0.02em]" />
        <div className="mt-3 text-xs text-stone-500">{foot}</div>
      </Card>
    </Link>
  );
}

function SalesChart({ months }: { months: { key: string; label: string; value: number }[] }) {
  const max = Math.max(...months.map((m) => m.value), 1);
  const short = (p: number) => {
    const r = p / 100;
    if (r >= 1e7) return `₹${(r / 1e7).toFixed(1)}Cr`;
    if (r >= 1e5) return `₹${(r / 1e5).toFixed(1)}L`;
    if (r >= 1e3) return `₹${(r / 1e3).toFixed(0)}k`;
    return `₹${Math.round(r)}`;
  };
  return (
    <div className="flex min-h-48 flex-1 items-end gap-3">
      {months.map((m, i) => {
        const last = i === months.length - 1;
        return (
          <div key={m.key} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
            <span className={`text-xs tabular-nums ${last ? "font-semibold text-stone-900" : "text-stone-500"}`}>
              {m.value > 0 ? short(m.value) : ""}
            </span>
            <div className="flex w-full flex-1 items-end justify-center">
              <div
                className={`w-full max-w-14 rounded-t-md transition-all ${last ? "bg-brand-600" : "bg-brand-200"}`}
                style={{ height: `${Math.max((Math.max(m.value, 0) / max) * 100, m.value > 0 ? 3 : 1)}%` }}
                title={formatINR(m.value, { symbol: true })}
              />
            </div>
            <span className={`text-xs ${last ? "font-semibold text-stone-900" : "text-stone-500"}`}>{m.label}</span>
          </div>
        );
      })}
    </div>
  );
}
