import { asc, eq } from "drizzle-orm";
import { Card, PageHeader } from "@/components/ui";
import { withOrg } from "@/db";
import { accounts, contacts } from "@/db/schema";
import { requireWriter } from "@/lib/auth";
import { today } from "../../reports/period";
import { JournalForm } from "../journal-form";

export const metadata = { title: "New journal entry" };

export default async function NewJournalPage() {
  const session = await requireWriter();
  const { accountList, contactList } = await withOrg(session.orgId, async (s) => ({
    accountList: await s.tx
      .select({ id: accounts.id, code: accounts.code, name: accounts.name })
      .from(accounts)
      .where(s.own(accounts, eq(accounts.archived, false)))
      .orderBy(asc(accounts.code)),
    contactList: await s.tx
      .select({ id: contacts.id, name: contacts.name })
      .from(contacts)
      .where(s.own(contacts, eq(contacts.archived, false)))
      .orderBy(asc(contacts.name)),
  }));
  return (
    <>
      <PageHeader title="New journal entry" subtitle="For adjustments like depreciation, provisions, opening balances and transfers" />
      <Card>
        <JournalForm
          accounts={accountList.map((a) => ({ id: a.id, label: `${a.code} ${a.name}` }))}
          contacts={contactList.map((c) => ({ id: c.id, label: c.name }))}
          today={today()}
        />
      </Card>
    </>
  );
}
