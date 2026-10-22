import { randomUUID } from "node:crypto";
import {
  bigint,
  boolean,
  char,
  date,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * MySQL/MariaDB schema (Hostinger's database).
 *
 * Every tenant table carries org_id. MySQL has no row-level security, so
 * isolation is enforced in the app: tenant queries go through withOrg()
 * in db/index.ts and filter with s.own(), and inserts carry orgId.
 */

const uuidCol = (name: string) => char(name, { length: 36 });
const id = () =>
  uuidCol("id")
    .primaryKey()
    .$defaultFn(() => randomUUID());
const createdAt = () => timestamp("created_at", { fsp: 3 }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { fsp: 3 })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
/** Money columns hold integer paise; bigint keeps headroom well beyond ₹1 lakh crore. */
const paise = (name: string) => bigint(name, { mode: "number" }).notNull().default(0);
const dateCol = (name: string) => date(name, { mode: "string" });
const orgId = () =>
  uuidCol("org_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" });

// ---------------------------------------------------------------------------
// Global tables: identity and tenancy (looked up before an org is known)

export const orgs = mysqlTable("orgs", {
  id: id(),
  name: varchar("name", { length: 200 }).notNull(),
  legalName: varchar("legal_name", { length: 200 }).notNull(),
  gstin: varchar("gstin", { length: 15 }),
  pan: varchar("pan", { length: 10 }),
  tan: varchar("tan", { length: 10 }),
  stateCode: varchar("state_code", { length: 2 }).notNull(),
  addressLine1: varchar("address_line1", { length: 200 }),
  addressLine2: varchar("address_line2", { length: 200 }),
  city: varchar("city", { length: 100 }),
  pincode: varchar("pincode", { length: 6 }),
  email: varchar("email", { length: 200 }),
  phone: varchar("phone", { length: 30 }),
  /** First month of the financial year, 4 = April. */
  fyStartMonth: int("fy_start_month").notNull().default(4),
  createdAt: createdAt(),
});

export const users = mysqlTable(
  "users",
  {
    id: id(),
    /** Stored lower-cased. */
    email: varchar("email", { length: 200 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_key").on(t.email)],
);

export const ROLES = ["admin", "accountant", "staff", "viewer"] as const;

export const memberships = mysqlTable(
  "memberships",
  {
    orgId: orgId(),
    userId: uuidCol("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: mysqlEnum("role", ROLES).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })],
);

export const sessions = mysqlTable("sessions", {
  /** SHA-256 of the cookie token; the raw token is never stored. */
  id: char("id", { length: 64 }).primaryKey(),
  userId: uuidCol("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  orgId: uuidCol("org_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { fsp: 3 }).notNull(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Tenant tables (always queried through withOrg and s.own)

export const contacts = mysqlTable(
  "contacts",
  {
    id: id(),
    orgId: orgId(),
    kind: mysqlEnum("kind", ["customer", "vendor", "both"]).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    gstin: varchar("gstin", { length: 15 }),
    pan: varchar("pan", { length: 10 }),
    email: varchar("email", { length: 200 }),
    phone: varchar("phone", { length: 30 }),
    addressLine1: varchar("address_line1", { length: 200 }),
    addressLine2: varchar("address_line2", { length: 200 }),
    city: varchar("city", { length: 100 }),
    /** GST state code; drives place of supply. */
    stateCode: varchar("state_code", { length: 2 }),
    pincode: varchar("pincode", { length: 6 }),
    /** Default TDS rate for this vendor, in basis points. */
    tdsRateBps: int("tds_rate_bps"),
    notes: text("notes"),
    archived: boolean("archived").notNull().default(false),
    /** Source id when imported (e.g. "odoo:res.partner:42"). */
    externalRef: varchar("external_ref", { length: 100 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("contacts_org_name_idx").on(t.orgId, t.name),
    uniqueIndex("contacts_org_external_ref_key").on(t.orgId, t.externalRef),
  ],
);

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;

export const accounts = mysqlTable(
  "accounts",
  {
    id: id(),
    orgId: orgId(),
    code: varchar("code", { length: 20 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    type: mysqlEnum("type", ACCOUNT_TYPES).notNull(),
    /** Role used by posting rules, e.g. "receivable" or "output_cgst". */
    systemTag: varchar("system_tag", { length: 40 }),
    archived: boolean("archived").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("accounts_org_code_key").on(t.orgId, t.code),
    uniqueIndex("accounts_org_tag_key").on(t.orgId, t.systemTag),
  ],
);

export const products = mysqlTable(
  "products",
  {
    id: id(),
    orgId: orgId(),
    name: varchar("name", { length: 200 }).notNull(),
    type: mysqlEnum("type", ["service", "goods"]).notNull().default("service"),
    /** HSN for goods, SAC for services. */
    hsnSac: varchar("hsn_sac", { length: 8 }),
    unit: varchar("unit", { length: 20 }).notNull().default("NOS"),
    salePrice: paise("sale_price"),
    purchasePrice: paise("purchase_price"),
    gstRateBps: int("gst_rate_bps").notNull().default(1800),
    incomeAccountId: uuidCol("income_account_id").references(() => accounts.id),
    expenseAccountId: uuidCol("expense_account_id").references(() => accounts.id),
    archived: boolean("archived").notNull().default(false),
    externalRef: varchar("external_ref", { length: 100 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("products_org_name_idx").on(t.orgId, t.name),
    uniqueIndex("products_org_external_ref_key").on(t.orgId, t.externalRef),
  ],
);

export const journals = mysqlTable(
  "journals",
  {
    id: id(),
    orgId: orgId(),
    code: varchar("code", { length: 10 }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    type: mysqlEnum("type", ["sales", "purchase", "bank", "cash", "general"]).notNull(),
    /** Bank/cash journals post to this account. */
    defaultAccountId: uuidCol("default_account_id").references(() => accounts.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("journals_org_code_key").on(t.orgId, t.code)],
);

export const journalEntries = mysqlTable(
  "journal_entries",
  {
    id: id(),
    orgId: orgId(),
    journalId: uuidCol("journal_id")
      .notNull()
      .references(() => journals.id),
    number: varchar("number", { length: 30 }),
    date: dateCol("date").notNull(),
    reference: varchar("reference", { length: 100 }),
    narration: text("narration"),
    status: mysqlEnum("status", ["draft", "posted", "cancelled"]).notNull().default("draft"),
    /** Document that produced this entry, e.g. "document:<uuid>". */
    sourceRef: varchar("source_ref", { length: 60 }),
    externalRef: varchar("external_ref", { length: 100 }),
    createdBy: uuidCol("created_by").references(() => users.id),
    createdAt: createdAt(),
    postedAt: timestamp("posted_at", { fsp: 3 }),
  },
  (t) => [
    index("journal_entries_org_date_idx").on(t.orgId, t.date),
    uniqueIndex("journal_entries_org_number_key").on(t.orgId, t.journalId, t.number),
    uniqueIndex("journal_entries_org_external_ref_key").on(t.orgId, t.externalRef),
  ],
);

export const journalLines = mysqlTable(
  "journal_lines",
  {
    id: id(),
    orgId: orgId(),
    entryId: uuidCol("entry_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" }),
    accountId: uuidCol("account_id")
      .notNull()
      .references(() => accounts.id),
    contactId: uuidCol("contact_id").references(() => contacts.id),
    description: varchar("description", { length: 300 }),
    debit: paise("debit"),
    credit: paise("credit"),
  },
  (t) => [index("journal_lines_entry_idx").on(t.entryId), index("journal_lines_org_account_idx").on(t.orgId, t.accountId)],
);

export const auditLog = mysqlTable(
  "audit_log",
  {
    id: id(),
    orgId: orgId(),
    userId: uuidCol("user_id").references(() => users.id),
    action: varchar("action", { length: 20 }).notNull(),
    entity: varchar("entity", { length: 40 }).notNull(),
    entityId: varchar("entity_id", { length: 64 }),
    data: json("data"),
    at: createdAt(),
  },
  (t) => [index("audit_log_org_at_idx").on(t.orgId, t.at)],
);

// ---------------------------------------------------------------------------
// Documents: sales invoices, credit notes, vendor bills, debit notes

export const DOCUMENT_STATUSES = ["draft", "posted", "cancelled"] as const;

export const documents = mysqlTable(
  "documents",
  {
    id: id(),
    orgId: orgId(),
    type: mysqlEnum("type", ["invoice", "credit_note", "bill", "debit_note"]).notNull(),
    status: mysqlEnum("status", DOCUMENT_STATUSES).notNull().default("draft"),
    /** Our number, assigned when posted, e.g. "INV/26-27/0001". */
    number: varchar("number", { length: 16 }),
    /** The vendor's own bill number, for purchases. */
    vendorReference: varchar("vendor_reference", { length: 50 }),
    contactId: uuidCol("contact_id")
      .notNull()
      .references(() => contacts.id),
    date: dateCol("date").notNull(),
    dueDate: dateCol("due_date"),
    /** GST state code of the place of supply. */
    placeOfSupply: varchar("place_of_supply", { length: 2 }).notNull(),
    /** CGST+SGST (intra-state) or IGST (inter-state); defaulted from the states, editable. */
    supplyType: mysqlEnum("supply_type", ["intra", "inter"]).notNull(),
    reverseCharge: boolean("reverse_charge").notNull().default(false),
    /** Invoice a credit note corrects, or bill a debit note corrects. */
    originalDocumentId: uuidCol("original_document_id"),
    taxable: paise("taxable"),
    cgst: paise("cgst"),
    sgst: paise("sgst"),
    igst: paise("igst"),
    roundOff: paise("round_off"),
    total: paise("total"),
    /** TDS withheld on a vendor bill, and the rate it was worked out at. */
    tdsAmount: paise("tds_amount"),
    tdsRateBps: int("tds_rate_bps").notNull().default(0),
    tdsSection: varchar("tds_section", { length: 10 }),
    /** Settled so far by payments and allocations. */
    amountPaid: paise("amount_paid"),
    notes: text("notes"),
    journalEntryId: uuidCol("journal_entry_id").references(() => journalEntries.id),
    externalRef: varchar("external_ref", { length: 100 }),
    createdBy: uuidCol("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    postedAt: timestamp("posted_at", { fsp: 3 }),
  },
  (t) => [
    index("documents_org_type_date_idx").on(t.orgId, t.type, t.date),
    index("documents_org_contact_idx").on(t.orgId, t.contactId),
    uniqueIndex("documents_org_type_number_key").on(t.orgId, t.type, t.number),
    uniqueIndex("documents_org_external_ref_key").on(t.orgId, t.externalRef),
  ],
);

export const documentLines = mysqlTable(
  "document_lines",
  {
    id: id(),
    orgId: orgId(),
    documentId: uuidCol("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    position: int("position").notNull(),
    productId: uuidCol("product_id").references(() => products.id),
    description: varchar("description", { length: 500 }).notNull(),
    hsnSac: varchar("hsn_sac", { length: 8 }),
    /** Quantity in thousandths, so 1.5 hours is 1500. */
    quantityMilli: int("quantity_milli").notNull(),
    unit: varchar("unit", { length: 20 }).notNull().default("NOS"),
    unitPrice: paise("unit_price"),
    discountBps: int("discount_bps").notNull().default(0),
    gstRateBps: int("gst_rate_bps").notNull(),
    accountId: uuidCol("account_id")
      .notNull()
      .references(() => accounts.id),
    taxable: paise("taxable"),
    cgst: paise("cgst"),
    sgst: paise("sgst"),
    igst: paise("igst"),
    total: paise("total"),
  },
  (t) => [index("document_lines_document_idx").on(t.documentId)],
);

// ---------------------------------------------------------------------------
// Payments: money received from customers or paid to vendors

export const payments = mysqlTable(
  "payments",
  {
    id: id(),
    orgId: orgId(),
    direction: mysqlEnum("direction", ["received", "paid"]).notNull(),
    status: mysqlEnum("status", DOCUMENT_STATUSES).notNull().default("posted"),
    number: varchar("number", { length: 30 }),
    contactId: uuidCol("contact_id")
      .notNull()
      .references(() => contacts.id),
    date: dateCol("date").notNull(),
    /** Money that actually moved. */
    amount: paise("amount"),
    /** TDS the customer deducted from a receipt (claimable as TDS receivable). */
    tdsAmount: paise("tds_amount"),
    /** Bank or cash journal the money moved through. */
    journalId: uuidCol("journal_id")
      .notNull()
      .references(() => journals.id),
    /** UTR, cheque number, UPI reference. */
    reference: varchar("reference", { length: 100 }),
    notes: text("notes"),
    journalEntryId: uuidCol("journal_entry_id").references(() => journalEntries.id),
    externalRef: varchar("external_ref", { length: 100 }),
    createdBy: uuidCol("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("payments_org_date_idx").on(t.orgId, t.date),
    uniqueIndex("payments_org_external_ref_key").on(t.orgId, t.externalRef),
  ],
);

export const paymentAllocations = mysqlTable(
  "payment_allocations",
  {
    id: id(),
    orgId: orgId(),
    paymentId: uuidCol("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "cascade" }),
    documentId: uuidCol("document_id")
      .notNull()
      .references(() => documents.id),
    amount: paise("amount"),
  },
  (t) => [
    index("payment_allocations_document_idx").on(t.documentId),
    index("payment_allocations_payment_idx").on(t.paymentId),
  ],
);

/** Per-org counters for document numbers, keyed like "INV/2026-27". */
export const sequences = mysqlTable(
  "sequences",
  {
    orgId: orgId(),
    key: varchar("key", { length: 40 }).notNull(),
    lastValue: int("last_value").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.key] })],
);

// ---------------------------------------------------------------------------
// Banking: imported statement lines, reconciled against the ledger

export const bankStatementLines = mysqlTable(
  "bank_statement_lines",
  {
    id: id(),
    orgId: orgId(),
    /** The bank journal (and so the bank account) this statement belongs to. */
    journalId: uuidCol("journal_id")
      .notNull()
      .references(() => journals.id),
    date: dateCol("date").notNull(),
    description: varchar("description", { length: 300 }).notNull(),
    reference: varchar("reference", { length: 100 }),
    /** Money in is positive, money out negative. */
    amount: paise("amount"),
    /** Running balance printed on the statement, when the bank gives one. */
    balance: bigint("balance", { mode: "number" }),
    /** Hash of date, amount, text and position, so re-imports skip lines already loaded. */
    rowKey: char("row_key", { length: 64 }).notNull(),
    /** Ledger line on the bank account this statement line was matched to. */
    matchedLineId: uuidCol("matched_line_id").references(() => journalLines.id),
    importBatch: char("import_batch", { length: 36 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("bank_statement_lines_org_row_key").on(t.orgId, t.journalId, t.rowKey),
    uniqueIndex("bank_statement_lines_org_matched_key").on(t.orgId, t.matchedLineId),
    index("bank_statement_lines_org_journal_date_idx").on(t.orgId, t.journalId, t.date),
  ],
);
