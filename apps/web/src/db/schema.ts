import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
/** Money columns hold integer paise; bigint keeps headroom beyond ₹9 crore. */
const paise = (name: string) => bigint(name, { mode: "number" }).notNull().default(0);

/**
 * Every tenant table carries org_id and this policy. The app connects as a role
 * that is not the table owner, so Postgres enforces it on every query; the
 * request sets app.org_id inside its transaction (see db/index.ts).
 */
const orgIsolation = (table: string) =>
  pgPolicy(`${table}_org_isolation`, {
    as: "permissive",
    for: "all",
    using: sql`org_id = nullif(current_setting('app.org_id', true), '')::uuid`,
    withCheck: sql`org_id = nullif(current_setting('app.org_id', true), '')::uuid`,
  });

const orgId = () =>
  uuid("org_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" });

// ---------------------------------------------------------------------------
// Global tables: identity and tenancy (no RLS, looked up before an org is known)

export const orgs = pgTable("orgs", {
  id: id(),
  name: text("name").notNull(),
  legalName: text("legal_name").notNull(),
  gstin: text("gstin"),
  pan: text("pan"),
  tan: text("tan"),
  stateCode: text("state_code").notNull(),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  pincode: text("pincode"),
  email: text("email"),
  phone: text("phone"),
  /** First month of the financial year, 4 = April. */
  fyStartMonth: integer("fy_start_month").notNull().default(4),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_key").on(sql`lower(${t.email})`)],
);

export const roleEnum = pgEnum("role", ["admin", "accountant", "staff", "viewer"]);

export const memberships = pgTable(
  "memberships",
  {
    orgId: orgId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })],
);

export const sessions = pgTable("sessions", {
  /** SHA-256 of the cookie token; the raw token is never stored. */
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  orgId: uuid("org_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Tenant tables (RLS on org_id)

export const contactKindEnum = pgEnum("contact_kind", ["customer", "vendor", "both"]);

export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    orgId: orgId(),
    kind: contactKindEnum("kind").notNull(),
    name: text("name").notNull(),
    gstin: text("gstin"),
    pan: text("pan"),
    email: text("email"),
    phone: text("phone"),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    /** GST state code; drives place of supply. */
    stateCode: text("state_code"),
    pincode: text("pincode"),
    /** Default TDS rate for this vendor, in basis points. */
    tdsRateBps: integer("tds_rate_bps"),
    notes: text("notes"),
    archived: boolean("archived").notNull().default(false),
    /** Source id when imported (e.g. "odoo:res.partner:42"). */
    externalRef: text("external_ref"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("contacts_org_name_idx").on(t.orgId, t.name),
    uniqueIndex("contacts_org_external_ref_key").on(t.orgId, t.externalRef),
    orgIsolation("contacts"),
  ],
).enableRLS();

export const accountTypeEnum = pgEnum("account_type", ["asset", "liability", "equity", "income", "expense"]);

export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    orgId: orgId(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: accountTypeEnum("type").notNull(),
    /** Role used by posting rules, e.g. "receivable" or "output_cgst". */
    systemTag: text("system_tag"),
    archived: boolean("archived").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("accounts_org_code_key").on(t.orgId, t.code),
    uniqueIndex("accounts_org_tag_key").on(t.orgId, t.systemTag),
    orgIsolation("accounts"),
  ],
).enableRLS();

export const productTypeEnum = pgEnum("product_type", ["service", "goods"]);

export const products = pgTable(
  "products",
  {
    id: id(),
    orgId: orgId(),
    name: text("name").notNull(),
    type: productTypeEnum("type").notNull().default("service"),
    /** HSN for goods, SAC for services. */
    hsnSac: text("hsn_sac"),
    unit: text("unit").notNull().default("NOS"),
    salePrice: paise("sale_price"),
    purchasePrice: paise("purchase_price"),
    gstRateBps: integer("gst_rate_bps").notNull().default(1800),
    incomeAccountId: uuid("income_account_id").references(() => accounts.id),
    expenseAccountId: uuid("expense_account_id").references(() => accounts.id),
    archived: boolean("archived").notNull().default(false),
    externalRef: text("external_ref"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("products_org_name_idx").on(t.orgId, t.name),
    uniqueIndex("products_org_external_ref_key").on(t.orgId, t.externalRef),
    orgIsolation("products"),
  ],
).enableRLS();

export const journalTypeEnum = pgEnum("journal_type", ["sales", "purchase", "bank", "cash", "general"]);

export const journals = pgTable(
  "journals",
  {
    id: id(),
    orgId: orgId(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: journalTypeEnum("type").notNull(),
    /** Bank/cash journals post to this account. */
    defaultAccountId: uuid("default_account_id").references(() => accounts.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("journals_org_code_key").on(t.orgId, t.code), orgIsolation("journals")],
).enableRLS();

export const entryStatusEnum = pgEnum("entry_status", ["draft", "posted", "cancelled"]);

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: id(),
    orgId: orgId(),
    journalId: uuid("journal_id")
      .notNull()
      .references(() => journals.id),
    number: text("number"),
    date: date("date").notNull(),
    reference: text("reference"),
    narration: text("narration"),
    status: entryStatusEnum("status").notNull().default("draft"),
    /** Document that produced this entry, e.g. "invoice:<uuid>". */
    sourceRef: text("source_ref"),
    externalRef: text("external_ref"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    postedAt: timestamp("posted_at", { withTimezone: true }),
  },
  (t) => [
    index("journal_entries_org_date_idx").on(t.orgId, t.date),
    uniqueIndex("journal_entries_org_number_key").on(t.orgId, t.journalId, t.number),
    uniqueIndex("journal_entries_org_external_ref_key").on(t.orgId, t.externalRef),
    orgIsolation("journal_entries"),
  ],
).enableRLS();

export const journalLines = pgTable(
  "journal_lines",
  {
    id: id(),
    orgId: orgId(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    contactId: uuid("contact_id").references(() => contacts.id),
    description: text("description"),
    debit: paise("debit"),
    credit: paise("credit"),
  },
  (t) => [
    index("journal_lines_entry_idx").on(t.entryId),
    index("journal_lines_org_account_idx").on(t.orgId, t.accountId),
    orgIsolation("journal_lines"),
  ],
).enableRLS();

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    orgId: orgId(),
    userId: uuid("user_id").references(() => users.id),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    data: jsonb("data"),
    at: createdAt(),
  },
  (t) => [index("audit_log_org_at_idx").on(t.orgId, t.at), orgIsolation("audit_log")],
).enableRLS();
