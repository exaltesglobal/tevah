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
 * isolation is enforced in the app: tenant queries go through orgScope()
 * in db/scope.ts, which adds the org filter to every read and write.
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
// Tenant tables (always queried through orgScope)

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
