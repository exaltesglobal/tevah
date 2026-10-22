import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { PageHeader } from "@/components/ui";
import { withOrg } from "@/db";
import { contacts, documents, journals } from "@/db/schema";
import { requireWriter } from "@/lib/auth";
import { isUuid } from "@/lib/doc-kinds";
import { outstanding } from "@/lib/documents";
import type { PaymentDirection } from "@/lib/payments";
import { PaymentForm, type PaymentFormState } from "../payment-form";

export const metadata = { title: "Record payment" };

const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

export default async function NewPaymentPage({ searchParams }: { searchParams: Promise<{ direction?: string; document?: string }> }) {
  const session = await requireWriter();
  const params = await searchParams;
  const direction: PaymentDirection = params.direction === "paid" ? "paid" : "received";
  const received = direction === "received";

  const data = await withOrg(session.orgId, async (s) => {
    const [contactRows, journalRows, docRows] = await Promise.all([
      s.tx
        .select({ id: contacts.id, name: contacts.name })
        .from(contacts)
        .where(s.own(contacts, eq(contacts.archived, false), inArray(contacts.kind, received ? ["customer", "both"] : ["vendor", "both"])))
        .orderBy(asc(contacts.name)),
      s.tx
        .select({ id: journals.id, name: journals.name })
        .from(journals)
        .where(s.own(journals, inArray(journals.type, ["bank", "cash"])))
        .orderBy(asc(journals.type)),
      s.tx
        .select()
        .from(documents)
        .where(
          s.own(
            documents,
            and(
              eq(documents.type, received ? "invoice" : "bill"),
              eq(documents.status, "posted"),
              sql`${documents.total} - ${documents.tdsAmount} - ${documents.amountPaid} > 0`,
            ),
          ),
        )
        .orderBy(asc(documents.date)),
    ]);
    return {
      contacts: contactRows,
      journals: journalRows,
      openDocuments: docRows.map((d) => ({ id: d.id, number: d.number ?? "", contactId: d.contactId, date: d.date, outstanding: outstanding(d) })),
    };
  });

  const target = isUuid(params.document) ? data.openDocuments.find((d) => d.id === params.document) : undefined;
  const initial: PaymentFormState = {
    contactId: target?.contactId ?? "",
    date: todayIST(),
    journalId: data.journals[0]?.id ?? "",
    amount: target ? (target.outstanding / 100).toFixed(2) : "",
    tds: "",
    reference: "",
    notes: "",
    allocations: target ? { [target.id]: (target.outstanding / 100).toFixed(2) } : {},
  };

  return (
    <>
      <PageHeader title={received ? "Record a receipt" : "Record a payment"} subtitle={received ? "Money in from a customer" : "Money out to a vendor"} />
      <PaymentForm direction={direction} initial={initial} {...data} />
    </>
  );
}
