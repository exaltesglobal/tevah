import { randomUUID } from "node:crypto";
import {
  assertBalanced,
  commercialPartner,
  compareBalances,
  documentFromMove,
  gstRateBps,
  isStateCode,
  odooAccountTag,
  odooAccountType,
  odooPaise,
  taskStatusFromOdoo,
  unitFromOdoo,
  validateGstin,
  type AccountType,
  type OdooMove,
  type OdooTax,
  type TaskStatus,
} from "@tevah/core";
import { eq, inArray, isNull, like, sql } from "drizzle-orm";
import { z } from "zod";
import type { Scope } from "@/db";
import {
  accounts,
  contacts,
  documentLines,
  documents,
  journalEntries,
  journalLines,
  journals,
  orgs,
  products,
  projects,
  tasks,
  timeEntries,
} from "@/db/schema";
import { audit } from "./audit";
import type { Session } from "./auth";
import { members } from "./projects";

// ---------------------------------------------------------------------------
// The file written by scripts/odoo-export.mjs

const id = z.number().int();
const ref = id.nullable();
const str = z.string().nullable();
const num = z.number().default(0);

const moveLine = z.object({
  id,
  accountId: ref,
  partnerId: ref,
  name: str,
  debit: num,
  credit: num,
  displayType: str,
  productId: ref,
  quantity: num,
  priceUnit: num,
  discount: num,
  taxIds: z.array(id).default([]),
  taxLineId: ref,
  hsn: str,
  uom: str,
});

export const odooExport = z.object({
  format: z.literal("tevah-odoo-export"),
  version: z.literal(1),
  exportedAt: z.string(),
  source: z.object({ url: z.string(), db: z.string() }).passthrough(),
  company: z.object({ name: str, gstin: str, stateCode: str }),
  partners: z.array(
    z.object({
      id,
      name: z.string(),
      parentId: ref,
      isCompany: z.boolean(),
      gstin: str,
      pan: str,
      email: str,
      phone: str,
      street: str,
      street2: str,
      city: str,
      zip: str,
      stateCode: str,
      customerRank: num,
      supplierRank: num,
      active: z.boolean(),
    }),
  ),
  products: z.array(
    z.object({
      id,
      name: z.string(),
      code: str,
      type: z.enum(["service", "goods"]),
      hsn: str,
      salePrice: num,
      purchasePrice: num,
      saleTaxIds: z.array(id),
      purchaseTaxIds: z.array(id),
      uom: str,
      active: z.boolean(),
    }),
  ),
  taxes: z.array(z.object({ id, name: z.string(), amount: num, amountType: z.string(), use: z.string(), group: str, childIds: z.array(id), kind: str })),
  accounts: z.array(z.object({ id, code: z.string(), name: z.string(), type: z.string(), active: z.boolean() })),
  journals: z.array(z.object({ id, code: z.string(), name: z.string(), type: z.string(), defaultAccountId: ref })),
  moves: z.array(
    z.object({
      id,
      name: z.string(),
      type: z.string(),
      state: z.enum(["posted", "cancel"]),
      date: z.iso.date(),
      invoiceDate: z.iso.date().nullable(),
      dueDate: z.iso.date().nullable(),
      partnerId: ref,
      ref: str,
      narration: str,
      journalId: ref,
      total: num,
      residual: num,
      tax: num,
      placeOfSupply: str,
      gstTreatment: str,
      reversedEntryId: ref,
      lines: z.array(moveLine),
    }),
  ),
  projects: z.array(z.object({ id, name: z.string(), partnerId: ref, description: str, active: z.boolean(), startDate: str, dueDate: str })),
  tasks: z.array(
    z.object({
      id,
      projectId: ref,
      name: z.string(),
      stage: str,
      state: str.optional(),
      closed: z.boolean(),
      cancelled: z.boolean(),
      assignees: z.array(z.string()),
      deadline: str,
      priority: num,
      description: str,
      allocatedHours: num,
      active: z.boolean(),
    }),
  ),
  timesheets: z.array(z.object({ id, projectId: ref, taskId: ref, user: str, date: z.iso.date(), hours: num, note: str })),
  trialBalance: z.array(z.object({ accountId: id, debit: num, credit: num })),
  checks: z.object({ postedLineCount: num, exportedPostedLines: num }).optional(),
});
export type OdooExport = z.output<typeof odooExport>;

// ---------------------------------------------------------------------------

export interface ImportReport {
  source: string;
  exportedAt: string;
  added: Record<"contacts" | "products" | "accounts" | "entries" | "documents" | "projects" | "tasks" | "timesheets", number>;
  alreadyImported: number;
  accountMap: { odoo: string; tevah: string; created: boolean }[];
  trialBalance: { rows: { account: string; odoo: number; tevah: number; difference: number }[]; matches: boolean };
  /** Posted entries in Tevah that didn't come from Odoo; they make Tevah's own reports differ from Odoo's. */
  otherEntries: number;
  warnings: string[];
}

const REF = {
  partner: (n: number) => `odoo:res.partner:${n}`,
  product: (n: number) => `odoo:product:${n}`,
  move: (n: number) => `odoo:account.move:${n}`,
  project: (n: number) => `odoo:project:${n}`,
  task: (n: number) => `odoo:task:${n}`,
  timesheet: (n: number) => `odoo:timesheet:${n}`,
};

const clip = (v: string | null | undefined, n: number) => (v ? v.trim().slice(0, n) || null : null);
const digits = (v: string | null | undefined, n: number) => {
  const d = (v ?? "").replace(/\D/g, "");
  return d.length === n ? d : null;
};

/** Insert rows in chunks so a large import stays under MySQL's packet limit. */
async function insertMany<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += 200) await insert(rows.slice(i, i + 200));
}

/**
 * Import an Odoo export into the current company. Safe to run again: records
 * already imported (by their Odoo id) are skipped. Run inside withOrg; the
 * caller rolls the transaction back for a preview.
 */
export async function importOdoo(s: Scope, session: Session, data: OdooExport): Promise<ImportReport> {
  const warnings: string[] = [];
  const warn = (w: string) => {
    if (warnings.length < 200) warnings.push(w);
  };
  const added: ImportReport["added"] = { contacts: 0, products: 0, accounts: 0, entries: 0, documents: 0, projects: 0, tasks: 0, timesheets: 0 };
  const [org] = await s.tx.select({ stateCode: orgs.stateCode, gstin: orgs.gstin }).from(orgs).where(eq(orgs.id, s.orgId));
  if (data.company.gstin && org?.gstin && data.company.gstin.toUpperCase() !== org.gstin.toUpperCase()) {
    warn(`The export is from GSTIN ${data.company.gstin} but this company is ${org.gstin}. Check you're importing into the right company.`);
  }

  const taxes = new Map<number, OdooTax>(data.taxes.map((t) => [t.id, t]));

  // --- Accounts -------------------------------------------------------------
  const tevahAccounts = await s.tx.select().from(accounts).where(s.own(accounts));
  const byTag = new Map(tevahAccounts.filter((a) => a.systemTag).map((a) => [a.systemTag!, a]));
  const byCode = new Map(tevahAccounts.map((a) => [a.code, a]));
  const tevahJournals = await s.tx.select().from(journals).where(s.own(journals));
  const odooAccounts = new Map(data.accounts.map((a) => [a.id, a]));
  const journalTypeOfAccount = new Map(data.journals.filter((j) => j.defaultAccountId).map((j) => [j.defaultAccountId!, j.type]));
  const used = new Set<number>([...data.moves.flatMap((m) => m.lines.map((l) => l.accountId).filter((x): x is number => x !== null)), ...data.trialBalance.map((t) => t.accountId)]);

  const accountMap = new Map<number, { id: string; code: string; name: string }>();
  const report: ImportReport["accountMap"] = [];
  let bankSeen = false;
  let cashSeen = false;
  for (const odooId of [...used].sort((a, b) => (odooAccounts.get(a)?.code ?? "").localeCompare(odooAccounts.get(b)?.code ?? ""))) {
    const oa = odooAccounts.get(odooId);
    if (!oa) {
      warn(`Account ${odooId} is used but wasn't in the export; its lines are skipped.`);
      continue;
    }
    const type = odooAccountType(oa.type);
    if (!type) {
      warn(`${oa.code} ${oa.name} is an off-balance account and wasn't imported.`);
      continue;
    }
    let tag = odooAccountTag(oa, journalTypeOfAccount.get(odooId));
    // A second bank or cash account gets its own ledger account and journal.
    if (tag === "bank") tag = bankSeen ? null : ((bankSeen = true), tag);
    else if (tag === "cash") tag = cashSeen ? null : ((cashSeen = true), tag);
    let target = tag ? byTag.get(tag) : undefined;
    let created = false;
    if (!target) target = byCode.get(oa.code.slice(0, 20));
    if (!target) {
      const code = byCode.has(oa.code.slice(0, 20)) ? `${oa.code.slice(0, 17)}-O` : oa.code.slice(0, 20);
      const row = { id: randomUUID(), orgId: s.orgId, code, name: oa.name.slice(0, 200), type: type as AccountType, archived: !oa.active };
      await s.tx.insert(accounts).values({ ...row, orgId: s.orgId });
      target = { ...row, systemTag: null, createdAt: new Date() };
      byCode.set(code, target);
      created = true;
      added.accounts++;
      const jt = journalTypeOfAccount.get(odooId);
      if (oa.type === "asset_cash" && (jt === "bank" || jt === "cash")) {
        const prefix = jt === "bank" ? "BNK" : "CSH";
        let n = 2;
        while (tevahJournals.some((j) => j.code === `${prefix}${n}`)) n++;
        const journal = { id: randomUUID(), orgId: s.orgId, code: `${prefix}${n}`, name: oa.name.slice(0, 100), type: jt as "bank" | "cash", defaultAccountId: row.id };
        await s.tx.insert(journals).values({ ...journal, orgId: s.orgId });
        tevahJournals.push({ ...journal, createdAt: new Date() });
      }
    }
    accountMap.set(odooId, { id: target.id, code: target.code, name: target.name });
    report.push({ odoo: `${oa.code} ${oa.name}`, tevah: `${target.code} ${target.name}`, created });
  }

  // --- Journals -------------------------------------------------------------
  const defaultJournal = (type: string) => tevahJournals.find((j) => j.type === type);
  const journalMap = new Map<number, string>();
  for (const j of data.journals) {
    let target;
    if (j.type === "sale") target = defaultJournal("sales");
    else if (j.type === "purchase") target = defaultJournal("purchase");
    else if (j.type === "bank" || j.type === "cash") {
      const account = j.defaultAccountId ? accountMap.get(j.defaultAccountId) : undefined;
      target = tevahJournals.find((t) => t.defaultAccountId && t.defaultAccountId === account?.id) ?? defaultJournal(j.type);
    }
    target ??= defaultJournal("general");
    if (target) journalMap.set(j.id, target.id);
  }
  const fallbackJournal = defaultJournal("general")!.id;

  // --- Contacts -------------------------------------------------------------
  const parents = new Map(data.partners.map((p) => [p.id, p.parentId]));
  const partnerById = new Map(data.partners.map((p) => [p.id, p]));
  const usage = new Map<number, { sales: boolean; purchase: boolean }>();
  const use = (pid: number | null, kind: "sales" | "purchase" | null) => {
    if (!pid) return;
    const top = commercialPartner(pid, parents);
    const u = usage.get(top) ?? { sales: false, purchase: false };
    if (kind) u[kind] = true;
    usage.set(top, u);
  };
  for (const m of data.moves) {
    const kind = m.type.startsWith("out_") ? "sales" : m.type.startsWith("in_") ? "purchase" : null;
    use(m.partnerId, kind);
    for (const l of m.lines) use(l.partnerId, null);
  }
  for (const p of data.projects) use(p.partnerId, "sales");
  for (const p of data.partners) if (!p.parentId && (p.customerRank > 0 || p.supplierRank > 0)) use(p.id, null);

  const existingContacts = await s.tx
    .select({ id: contacts.id, ref: contacts.externalRef })
    .from(contacts)
    .where(s.own(contacts, like(contacts.externalRef, "odoo:res.partner:%")));
  const contactMap = new Map(existingContacts.map((c) => [Number(c.ref!.split(":").pop()), c.id]));
  // Contacts already typed into Tevah are linked rather than duplicated: same GSTIN, or same name when neither has one.
  const typedIn = await s.tx
    .select({ id: contacts.id, name: contacts.name, gstin: contacts.gstin })
    .from(contacts)
    .where(s.own(contacts, isNull(contacts.externalRef)));
  const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const newContacts: (typeof contacts.$inferInsert)[] = [];
  let linkedContacts = 0;
  for (const [pid, u] of usage) {
    if (contactMap.has(pid)) continue;
    const p = partnerById.get(pid);
    if (!p) {
      warn(`Partner ${pid} is used on entries but wasn't in the export.`);
      continue;
    }
    const gstinUpper = p.gstin?.trim().toUpperCase();
    const match =
      (gstinUpper && typedIn.find((c) => c.gstin === gstinUpper)) || typedIn.find((c) => !c.gstin && (!gstinUpper || !validateGstin(gstinUpper).valid) && sameName(c.name, p.name));
    if (match) {
      contactMap.set(pid, match.id);
      typedIn.splice(typedIn.indexOf(match), 1);
      await s.tx.update(contacts).set({ externalRef: REF.partner(pid) }).where(s.own(contacts, eq(contacts.id, match.id)));
      linkedContacts++;
      continue;
    }
    const customer = u.sales || p.customerRank > 0;
    const vendor = u.purchase || p.supplierRank > 0;
    let gstin: string | null = null;
    let stateCode = p.stateCode && isStateCode(p.stateCode) ? p.stateCode : null;
    let pan = p.pan && /^[A-Z]{5}\d{4}[A-Z]$/.test(p.pan.toUpperCase()) ? p.pan.toUpperCase() : null;
    if (p.gstin) {
      const check = validateGstin(p.gstin);
      if (check.valid) {
        gstin = check.gstin;
        stateCode ??= check.stateCode;
        pan ??= check.pan;
      } else warn(`${p.name}: GSTIN ${p.gstin} isn't valid (${check.reason}), so it was left off.`);
    }
    const contactId = randomUUID();
    contactMap.set(pid, contactId);
    newContacts.push({
      id: contactId,
      orgId: s.orgId,
      kind: customer && vendor ? "both" : vendor ? "vendor" : "customer",
      name: p.name.slice(0, 200),
      gstin,
      pan,
      email: clip(p.email, 200),
      phone: clip(p.phone, 30),
      addressLine1: clip(p.street, 200),
      addressLine2: clip(p.street2, 200),
      city: clip(p.city, 100),
      stateCode,
      pincode: digits(p.zip, 6),
      archived: !p.active,
      externalRef: REF.partner(pid),
    });
  }
  await insertMany(newContacts, (c) => s.tx.insert(contacts).values(c.map((r) => ({ ...r, orgId: s.orgId }))));
  added.contacts = newContacts.length;
  if (linkedContacts) warn(`${linkedContacts} Odoo contacts matched contacts already in Tevah (by GSTIN or name) and were linked instead of added again.`);
  const contactOf = (pid: number | null) => (pid ? (contactMap.get(commercialPartner(pid, parents)) ?? null) : null);

  // --- Products -------------------------------------------------------------
  const existingProducts = await s.tx
    .select({ id: products.id, ref: products.externalRef })
    .from(products)
    .where(s.own(products, like(products.externalRef, "odoo:product:%")));
  const productMap = new Map(existingProducts.map((p) => [Number(p.ref!.split(":").pop()), p.id]));
  const typedProducts = await s.tx
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(s.own(products, isNull(products.externalRef)));
  const newProducts: (typeof products.$inferInsert)[] = [];
  for (const p of data.products) {
    if (productMap.has(p.id)) continue;
    const match = typedProducts.find((t) => sameName(t.name, p.name));
    if (match) {
      productMap.set(p.id, match.id);
      typedProducts.splice(typedProducts.indexOf(match), 1);
      await s.tx.update(products).set({ externalRef: REF.product(p.id) }).where(s.own(products, eq(products.id, match.id)));
      continue;
    }
    const pid = randomUUID();
    productMap.set(p.id, pid);
    newProducts.push({
      id: pid,
      orgId: s.orgId,
      name: (p.code ? `[${p.code}] ${p.name}` : p.name).slice(0, 200),
      type: p.type,
      hsnSac: p.hsn?.replace(/\s/g, "").slice(0, 8) || null,
      unit: unitFromOdoo(p.uom),
      salePrice: odooPaise(p.salePrice),
      purchasePrice: odooPaise(p.purchasePrice),
      gstRateBps: gstRateBps(p.saleTaxIds.length ? p.saleTaxIds : p.purchaseTaxIds, taxes),
      archived: !p.active,
      externalRef: REF.product(p.id),
    });
  }
  await insertMany(newProducts, (c) => s.tx.insert(products).values(c.map((r) => ({ ...r, orgId: s.orgId }))));
  added.products = newProducts.length;

  // --- Journal entries and documents ---------------------------------------
  const existingMoves = await s.tx
    .select({ id: journalEntries.id, ref: journalEntries.externalRef })
    .from(journalEntries)
    .where(s.own(journalEntries, like(journalEntries.externalRef, "odoo:account.move:%")));
  const done = new Set(existingMoves.map((m) => Number(m.ref!.split(":").pop())));
  const alreadyImported = done.size ? data.moves.filter((m) => done.has(m.id)).length : 0;
  const productInfo = new Map(data.products.map((p) => [p.id, { name: p.name, hsn: p.hsn, uom: p.uom }]));
  const docByMove = new Map<number, string>();
  const refunds: { docId: string; reversedMoveId: number }[] = [];
  const entryRows: (typeof journalEntries.$inferInsert)[] = [];
  const lineRows: (typeof journalLines.$inferInsert)[] = [];
  const docRows: (typeof documents.$inferInsert)[] = [];
  const docLineRows: (typeof documentLines.$inferInsert)[] = [];

  const moves = [...data.moves].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  for (const m of moves) {
    if (done.has(m.id)) continue;
    const lines = m.lines
      .filter((l) => l.accountId !== null && (l.debit || l.credit))
      .map((l) => ({ odoo: l, account: accountMap.get(l.accountId!) }));
    if (lines.some((l) => !l.account)) {
      warn(`${m.name}: uses an account that couldn't be mapped; entry skipped.`);
      continue;
    }
    const entryLines = lines.map(({ odoo, account }) => ({
      accountId: account!.id,
      contactId: contactOf(odoo.partnerId),
      description: clip(odoo.name, 300),
      debit: odooPaise(odoo.debit),
      credit: odooPaise(odoo.credit),
    }));
    try {
      assertBalanced(entryLines);
    } catch (e) {
      warn(`${m.name}: ${e instanceof Error ? e.message : "doesn't balance"}; entry skipped.`);
      continue;
    }

    const entryId = randomUUID();
    let sourceRef = "odoo";
    const doc = documentFromMove(m as OdooMove, taxes, productInfo);
    if (doc) {
      const contactId = contactOf(m.partnerId);
      if (!contactId) warn(`${m.name}: no customer or vendor on it, so it was imported as a journal entry only.`);
      else {
        const docId = randomUUID();
        sourceRef = `document:${docId}`;
        docByMove.set(m.id, docId);
        if (m.reversedEntryId) refunds.push({ docId, reversedMoveId: m.reversedEntryId });
        const partner = partnerById.get(commercialPartner(m.partnerId!, parents));
        const pos = [m.placeOfSupply, partner?.stateCode, org?.stateCode].find((c) => c && isStateCode(c))!;
        const purchase = doc.type === "bill" || doc.type === "debit_note";
        docRows.push({
          id: docId,
          orgId: s.orgId,
          type: doc.type,
          status: m.state === "posted" ? "posted" : "cancelled",
          number: m.name.slice(0, 30),
          vendorReference: purchase ? clip(m.ref, 50) : null,
          contactId,
          date: m.invoiceDate ?? m.date,
          dueDate: m.dueDate,
          placeOfSupply: pos,
          supplyType: doc.supplyType,
          reverseCharge: doc.reverseCharge,
          taxable: doc.taxable,
          cgst: doc.cgst,
          sgst: doc.sgst,
          igst: doc.igst,
          roundOff: doc.roundOff,
          total: doc.total,
          tdsAmount: doc.tdsAmount,
          amountPaid: doc.amountPaid,
          notes: m.narration,
          journalEntryId: entryId,
          externalRef: REF.move(m.id),
          createdBy: session.userId,
          postedAt: new Date(`${m.date}T00:00:00Z`),
        });
        doc.lines.forEach((l, i) => {
          const account = accountMap.get(l.odooAccountId);
          docLineRows.push({
            orgId: s.orgId,
            documentId: docId,
            position: i + 1,
            productId: l.odooProductId ? (productMap.get(l.odooProductId) ?? null) : null,
            description: l.description,
            hsnSac: l.hsnSac,
            quantityMilli: l.quantityMilli,
            unit: l.unit,
            unitPrice: l.unitPrice,
            discountBps: l.discountBps,
            gstRateBps: l.gstRateBps,
            accountId: account!.id,
            taxable: l.taxable,
            cgst: l.cgst,
            sgst: l.sgst,
            igst: l.igst,
            total: l.total,
          });
        });
        added.documents++;
      }
    }

    entryRows.push({
      id: entryId,
      orgId: s.orgId,
      journalId: (m.journalId && journalMap.get(m.journalId)) || fallbackJournal,
      number: m.name && m.name !== "/" ? m.name.slice(0, 30) : null,
      date: m.date,
      reference: clip(m.ref, 100),
      narration: m.narration,
      status: m.state === "posted" ? "posted" : "cancelled",
      sourceRef,
      externalRef: REF.move(m.id),
      createdBy: session.userId,
      postedAt: new Date(`${m.date}T00:00:00Z`),
    });
    for (const l of entryLines) lineRows.push({ orgId: s.orgId, entryId, ...l });
    added.entries++;
  }
  await insertMany(entryRows, (c) => s.tx.insert(journalEntries).values(c.map((r) => ({ ...r, orgId: s.orgId }))));
  await insertMany(lineRows, (c) => s.tx.insert(journalLines).values(c.map((r) => ({ ...r, orgId: s.orgId }))));
  await insertMany(docRows, (c) => s.tx.insert(documents).values(c.map((r) => ({ ...r, orgId: s.orgId }))));
  await insertMany(docLineRows, (c) => s.tx.insert(documentLines).values(c.map((r) => ({ ...r, orgId: s.orgId }))));
  for (const r of refunds) {
    const original = docByMove.get(r.reversedMoveId);
    if (original) await s.tx.update(documents).set({ originalDocumentId: original }).where(s.own(documents, eq(documents.id, r.docId)));
  }

  // --- Projects, tasks and timesheets --------------------------------------
  const existingProjects = await s.tx
    .select({ id: projects.id, ref: projects.externalRef })
    .from(projects)
    .where(s.own(projects, like(projects.externalRef, "odoo:project:%")));
  const projectMap = new Map(existingProjects.map((p) => [Number(p.ref!.split(":").pop()), p.id]));
  const newProjects: (typeof projects.$inferInsert)[] = [];
  for (const p of data.projects) {
    if (projectMap.has(p.id)) continue;
    const pid = randomUUID();
    projectMap.set(p.id, pid);
    newProjects.push({
      id: pid,
      orgId: s.orgId,
      name: p.name.slice(0, 200),
      contactId: contactOf(p.partnerId),
      description: p.description,
      status: p.active ? "active" : "done",
      startDate: p.startDate?.slice(0, 10) ?? null,
      dueDate: p.dueDate?.slice(0, 10) ?? null,
      archived: !p.active,
      externalRef: REF.project(p.id),
    });
  }
  await insertMany(newProjects, (c) => s.tx.insert(projects).values(c.map((r) => ({ ...r, orgId: s.orgId }))));
  added.projects = newProjects.length;

  const people = await members(s);
  const personNamed = (name: string | null | undefined) => (name ? people.find((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase())?.id : undefined);
  const unmatchedPeople = new Set<string>();

  const existingTasks = await s.tx
    .select({ id: tasks.id, ref: tasks.externalRef })
    .from(tasks)
    .where(s.own(tasks, like(tasks.externalRef, "odoo:task:%")));
  const taskMap = new Map(existingTasks.map((t) => [Number(t.ref!.split(":").pop()), t.id]));
  const positions = new Map<string, number>();
  const newTasks: (typeof tasks.$inferInsert)[] = [];
  for (const t of data.tasks) {
    if (taskMap.has(t.id)) continue;
    const projectId = t.projectId ? projectMap.get(t.projectId) : undefined;
    if (!projectId) {
      warn(`Task "${t.name}" has no project in the export; skipped.`);
      continue;
    }
    const status: TaskStatus = t.active ? taskStatusFromOdoo(t) : "cancelled";
    const key = `${projectId}:${status}`;
    const position = (positions.get(key) ?? 0) + 1000;
    positions.set(key, position);
    const assigneeId = t.assignees.map(personNamed).find(Boolean) ?? null;
    for (const a of t.assignees) if (!personNamed(a)) unmatchedPeople.add(a);
    const extra = t.assignees.length > 1 || (t.assignees.length && !assigneeId) ? `\n\nAssigned in Odoo to: ${t.assignees.join(", ")}` : "";
    const tid = randomUUID();
    taskMap.set(t.id, tid);
    newTasks.push({
      id: tid,
      orgId: s.orgId,
      projectId,
      title: t.name.slice(0, 300),
      description: (t.description ?? "") + extra || null,
      status,
      priority: t.priority > 0 ? 1 : 0,
      assigneeId,
      dueDate: t.deadline,
      position,
      estimateMinutes: t.allocatedHours ? Math.round(t.allocatedHours * 60) : null,
      completedAt: status === "done" ? new Date() : null,
      createdBy: session.userId,
      externalRef: REF.task(t.id),
    });
  }
  await insertMany(newTasks, (c) => s.tx.insert(tasks).values(c.map((r) => ({ ...r, orgId: s.orgId }))));
  added.tasks = newTasks.length;

  const existingTime = await s.tx
    .select({ ref: timeEntries.externalRef })
    .from(timeEntries)
    .where(s.own(timeEntries, like(timeEntries.externalRef, "odoo:timesheet:%")));
  const timeDone = new Set(existingTime.map((t) => t.ref));
  const newTime: (typeof timeEntries.$inferInsert)[] = [];
  for (const t of data.timesheets) {
    if (timeDone.has(REF.timesheet(t.id))) continue;
    const projectId = t.projectId ? projectMap.get(t.projectId) : undefined;
    const minutes = Math.round(t.hours * 60);
    if (!projectId || minutes <= 0) continue;
    const userId = personNamed(t.user);
    if (!userId && t.user) unmatchedPeople.add(t.user);
    newTime.push({
      orgId: s.orgId,
      projectId,
      taskId: t.taskId ? (taskMap.get(t.taskId) ?? null) : null,
      userId: userId ?? session.userId,
      date: t.date,
      minutes,
      note: clip(t.note, 500),
      billable: true,
      externalRef: REF.timesheet(t.id),
    });
  }
  await insertMany(newTime, (c) => s.tx.insert(timeEntries).values(c.map((r) => ({ ...r, orgId: s.orgId }))));
  added.timesheets = newTime.length;
  if (unmatchedPeople.size) {
    warn(`No Tevah user named ${[...unmatchedPeople].join(", ")}; their tasks were left unassigned and their time was put under ${session.userName}.`);
  }

  // --- Trial balance check --------------------------------------------------
  const odooNet = new Map<string, number>();
  for (const t of data.trialBalance) {
    const target = accountMap.get(t.accountId);
    if (!target) continue;
    const key = target.id;
    odooNet.set(key, (odooNet.get(key) ?? 0) + odooPaise(t.debit) - odooPaise(t.credit));
  }
  const imported = await s.tx
    .select({ accountId: journalLines.accountId, n: sql<string>`sum(${journalLines.debit} - ${journalLines.credit})` })
    .from(journalLines)
    .innerJoin(
      journalEntries,
      s.own(journalEntries, eq(journalEntries.id, journalLines.entryId), eq(journalEntries.status, "posted"), like(journalEntries.externalRef, "odoo:account.move:%")),
    )
    .where(s.own(journalLines))
    .groupBy(journalLines.accountId);
  const tevahNet = new Map(imported.map((r) => [r.accountId, Number(r.n)]));
  const compared = compareBalances(odooNet, tevahNet);
  const names = new Map([...accountMap.values()].map((a) => [a.id, `${a.code} ${a.name}`]));
  const extraNames = compared.rows.filter((r) => !names.has(r.key)).map((r) => r.key);
  if (extraNames.length) {
    const rows = await s.tx.select({ id: accounts.id, code: accounts.code, name: accounts.name }).from(accounts).where(s.own(accounts, inArray(accounts.id, extraNames)));
    for (const r of rows) names.set(r.id, `${r.code} ${r.name}`);
  }
  const [other] = await s.tx
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(journalEntries)
    .where(s.own(journalEntries, eq(journalEntries.status, "posted"), sql`(${journalEntries.externalRef} is null or ${journalEntries.externalRef} not like 'odoo:%')`));

  if (data.checks && data.checks.postedLineCount !== data.checks.exportedPostedLines) {
    warn(`Odoo reported ${data.checks.postedLineCount} posted journal items but the export holds ${data.checks.exportedPostedLines}. Export again before relying on the totals.`);
  }
  await audit(s, session, "create", "odoo_import", randomUUID(), { source: data.source.url, exportedAt: data.exportedAt, added });

  return {
    source: `${data.company.name ?? data.source.db} (${data.source.url})`,
    exportedAt: data.exportedAt,
    added,
    alreadyImported,
    accountMap: report,
    trialBalance: {
      matches: compared.matches,
      rows: compared.rows.map((r) => ({ account: names.get(r.key) ?? r.key, odoo: r.odoo, tevah: r.tevah, difference: r.difference })).sort((a, b) => a.account.localeCompare(b.account)),
    },
    otherEntries: other?.n ?? 0,
    warnings,
  };
}
