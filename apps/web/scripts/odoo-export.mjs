#!/usr/bin/env node
// Read-only export of an Odoo company into one JSON file that Tevah can import
// (Settings → Import from Odoo). Runs on your own computer with Node 18 or later;
// no packages to install. It only reads from Odoo: search_read, search_count and
// fields_get. Nothing is created, changed or deleted.
//
//   ODOO_API_KEY=<key> node scripts/odoo-export.mjs \
//     --url https://yourcompany.odoo.com --db yourcompany --user you@example.com \
//     [--out odoo-export.json]
//
// The API key comes from Odoo: avatar → My Profile → Account Security → New API Key.
// Without ODOO_API_KEY the script asks for it and doesn't echo what you type.
// The output holds your customers' and vendors' details: keep it private and
// delete it after the import.

import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .split(/\s*--/)
    .filter(Boolean)
    .map((a) => {
      const [k, ...v] = a.split(/[= ]/);
      return [k, v.join(" ").trim()];
    }),
);
const url = (args.url || process.env.ODOO_URL || "").replace(/\/+$/, "");
const db = args.db || process.env.ODOO_DB;
const login = args.user || process.env.ODOO_USER;
const out = args.out || "odoo-export.json";
if (!url || !db || !login) {
  console.error("Usage: node scripts/odoo-export.mjs --url https://x.odoo.com --db x --user you@example.com [--out file.json]");
  process.exit(1);
}

async function askHidden(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (s) => rl.output.write(s.startsWith(question) ? s : "");
  const answer = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  process.stdout.write("\n");
  return answer.trim();
}
const key = process.env.ODOO_API_KEY || (await askHidden("Odoo API key: "));
if (!key) process.exit(1);

// --- Transport: Odoo 19's JSON-2 API, falling back to classic JSON-RPC ------------

let uid = null;
let mode = "json2";

async function json2(model, method, body) {
  const res = await fetch(`${url}/json/2/${model}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `bearer ${key}`, "x-odoo-database": db },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`${model}.${method}: HTTP ${res.status} ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return JSON.parse(text);
}

let rpcId = 0;
async function jsonrpc(service, method, params) {
  const res = await fetch(`${url}/jsonrpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "call", id: ++rpcId, params: { service, method, args: params } }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${service}.${method}: ${body.error.data?.message || body.error.message}`);
  return body.result;
}

/** Call a model method with keyword arguments. */
async function call(model, method, kwargs) {
  if (mode === "json2") return json2(model, method, kwargs);
  const { domain, ...rest } = kwargs;
  const positional = method === "fields_get" ? [] : [domain ?? []];
  return jsonrpc("object", "execute_kw", [db, uid, key, model, method, positional, rest]);
}

async function connect() {
  try {
    const me = await json2("res.users", "search_read", { domain: [["login", "=", login]], fields: ["id"], limit: 1 });
    if (me.length) {
      uid = me[0].id;
      return;
    }
  } catch (e) {
    if (e.status === 401 || e.status === 403) throw new Error("Odoo refused the API key. Check the key and the database name.");
    // Older Odoo without JSON-2: use JSON-RPC below.
  }
  mode = "jsonrpc";
  uid = await jsonrpc("common", "authenticate", [db, login, key, {}]);
  if (!uid) throw new Error("Odoo refused the login. Check the user, API key and database name.");
}

// --- Reading --------------------------------------------------------------------

const fieldCache = new Map();
async function fieldsOf(model) {
  if (!fieldCache.has(model)) {
    try {
      fieldCache.set(model, await call(model, "fields_get", { attributes: ["type"] }));
    } catch {
      fieldCache.set(model, null); // App not installed.
    }
  }
  return fieldCache.get(model);
}

/** search_read in pages, asking only for fields this Odoo version has. */
async function readAll(model, domain, wanted, context = {}) {
  const available = await fieldsOf(model);
  if (!available) return [];
  const fields = wanted.filter((f) => f in available);
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const page = await call(model, "search_read", { domain, fields, offset, limit: 500, order: "id", context: { active_test: false, ...context } });
    rows.push(...page);
    process.stdout.write(`\r  ${model}: ${rows.length}   `);
    if (page.length < 500) break;
  }
  process.stdout.write("\n");
  return rows;
}

const m2o = (v) => (Array.isArray(v) ? v[0] : v || null);
const m2oName = (v) => (Array.isArray(v) ? v[1] : null);
const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const html = (v) => {
  const s = text(v);
  if (!s) return null;
  return (
    s
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, "\n\n")
      .trim() || null
  );
};

await connect();
console.log(`Connected to ${url} (${db}) as ${login} using ${mode === "json2" ? "the JSON-2 API" : "JSON-RPC"}. Reading…`);

const [company] = await readAll("res.company", [], ["name", "vat", "state_id"]);
const states = await readAll("res.country.state", [["country_id.code", "=", "IN"]], ["code", "name", "l10n_in_tin"]);
const gstState = new Map(states.map((s) => [s.id, text(s.l10n_in_tin) ?? null]));

const partners = await readAll(
  "res.partner",
  [],
  ["name", "display_name", "vat", "l10n_in_pan", "l10n_in_pan_entity_id", "email", "phone", "mobile", "street", "street2", "city", "zip", "state_id", "is_company", "customer_rank", "supplier_rank", "active", "parent_id", "type"],
);
const products = await readAll(
  "product.product",
  [],
  ["name", "default_code", "type", "detailed_type", "list_price", "standard_price", "l10n_in_hsn_code", "taxes_id", "supplier_taxes_id", "uom_id", "active", "sale_ok", "purchase_ok"],
);
const taxes = await readAll("account.tax", [], ["name", "amount", "amount_type", "type_tax_use", "tax_group_id", "children_tax_ids", "active", "l10n_in_tax_type"]);
const accounts = await readAll("account.account", [], ["code", "code_store", "name", "account_type", "active"]);
const journals = await readAll("account.journal", [], ["code", "name", "type", "default_account_id"]);
const moves = await readAll(
  "account.move",
  [["state", "in", ["posted", "cancel"]]],
  ["name", "move_type", "state", "date", "invoice_date", "invoice_date_due", "partner_id", "ref", "journal_id", "amount_total", "amount_residual", "amount_tax", "l10n_in_state_id", "l10n_in_gst_treatment", "reversed_entry_id", "narration"],
);
const lines = await readAll(
  "account.move.line",
  [["parent_state", "in", ["posted", "cancel"]]],
  ["move_id", "account_id", "partner_id", "name", "debit", "credit", "display_type", "product_id", "quantity", "price_unit", "discount", "tax_ids", "tax_line_id", "l10n_in_hsn_code", "product_uom_id", "sequence"],
);
const projects = await readAll("project.project", [], ["name", "partner_id", "description", "active", "date_start", "date", "is_internal_project"]);
const tasks = await readAll(
  "project.task",
  [],
  ["name", "project_id", "stage_id", "state", "is_closed", "user_ids", "date_deadline", "priority", "description", "create_date", "date_end", "active", "allocated_hours", "sequence"],
);
const users = await readAll("res.users", [], ["name", "login"]);
const timesheets = await readAll("account.analytic.line", [["project_id", "!=", false]], ["project_id", "task_id", "user_id", "employee_id", "date", "unit_amount", "name"]);

const userName = new Map(users.map((u) => [u.id, u.name]));
const linesByMove = new Map();
for (const l of lines) {
  const id = m2o(l.move_id);
  if (!linesByMove.has(id)) linesByMove.set(id, []);
  linesByMove.get(id).push(l);
}

// Odoo's own trial balance, from every posted journal item.
const tb = new Map();
const postedMoves = new Set(moves.filter((m) => m.state === "posted").map((m) => m.id));
for (const l of lines) {
  if (!postedMoves.has(m2o(l.move_id)) || !l.account_id) continue;
  const a = m2o(l.account_id);
  const t = tb.get(a) ?? { accountId: a, debit: 0, credit: 0 };
  t.debit += l.debit || 0;
  t.credit += l.credit || 0;
  tb.set(a, t);
}
const postedLineCount = await call("account.move.line", "search_count", { domain: [["parent_state", "=", "posted"]] });

const exportData = {
  format: "tevah-odoo-export",
  version: 1,
  exportedAt: new Date().toISOString(),
  source: { url, db, api: mode },
  company: { name: company?.name ?? null, gstin: text(company?.vat), stateCode: company ? gstState.get(m2o(company.state_id)) ?? null : null },
  partners: partners
    .filter((p) => p.type !== "private")
    .map((p) => ({
      id: p.id,
      name: text(p.name) ?? text(p.display_name) ?? `Partner ${p.id}`,
      parentId: m2o(p.parent_id),
      isCompany: Boolean(p.is_company),
      gstin: text(p.vat),
      pan: text(p.l10n_in_pan) ?? (typeof p.l10n_in_pan_entity_id === "object" ? text(m2oName(p.l10n_in_pan_entity_id)) : null),
      email: text(p.email),
      phone: text(p.phone) ?? text(p.mobile),
      street: text(p.street),
      street2: text(p.street2),
      city: text(p.city),
      zip: text(p.zip),
      stateCode: gstState.get(m2o(p.state_id)) ?? null,
      customerRank: p.customer_rank ?? 0,
      supplierRank: p.supplier_rank ?? 0,
      active: p.active !== false,
    })),
  products: products.map((p) => ({
    id: p.id,
    name: text(p.name) ?? `Product ${p.id}`,
    code: text(p.default_code),
    type: (p.type ?? p.detailed_type) === "service" ? "service" : "goods",
    hsn: text(p.l10n_in_hsn_code),
    salePrice: p.list_price ?? 0,
    purchasePrice: p.standard_price ?? 0,
    saleTaxIds: p.taxes_id ?? [],
    purchaseTaxIds: p.supplier_taxes_id ?? [],
    uom: m2oName(p.uom_id),
    active: p.active !== false,
  })),
  taxes: taxes.map((t) => ({
    id: t.id,
    name: t.name,
    amount: t.amount,
    amountType: t.amount_type,
    use: t.type_tax_use,
    group: m2oName(t.tax_group_id),
    childIds: t.children_tax_ids ?? [],
    kind: text(t.l10n_in_tax_type),
  })),
  accounts: accounts.map((a) => ({ id: a.id, code: text(a.code) ?? text(a.code_store) ?? String(a.id), name: a.name, type: a.account_type, active: a.active !== false })),
  journals: journals.map((j) => ({ id: j.id, code: j.code, name: j.name, type: j.type, defaultAccountId: m2o(j.default_account_id) })),
  moves: moves.map((m) => ({
    id: m.id,
    name: m.name,
    type: m.move_type,
    state: m.state,
    date: m.date,
    invoiceDate: m.invoice_date || null,
    dueDate: m.invoice_date_due || null,
    partnerId: m2o(m.partner_id),
    ref: text(m.ref),
    narration: html(m.narration),
    journalId: m2o(m.journal_id),
    total: m.amount_total ?? 0,
    residual: m.amount_residual ?? 0,
    tax: m.amount_tax ?? 0,
    placeOfSupply: gstState.get(m2o(m.l10n_in_state_id)) ?? null,
    gstTreatment: text(m.l10n_in_gst_treatment),
    reversedEntryId: m2o(m.reversed_entry_id),
    lines: (linesByMove.get(m.id) ?? [])
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.id - b.id)
      .map((l) => ({
        id: l.id,
        accountId: m2o(l.account_id),
        partnerId: m2o(l.partner_id),
        name: text(l.name),
        debit: l.debit ?? 0,
        credit: l.credit ?? 0,
        displayType: l.display_type || null,
        productId: m2o(l.product_id),
        quantity: l.quantity ?? 0,
        priceUnit: l.price_unit ?? 0,
        discount: l.discount ?? 0,
        taxIds: l.tax_ids ?? [],
        taxLineId: m2o(l.tax_line_id),
        hsn: text(l.l10n_in_hsn_code),
        uom: m2oName(l.product_uom_id),
      })),
  })),
  projects: projects.map((p) => ({
    id: p.id,
    name: p.name,
    partnerId: m2o(p.partner_id),
    description: html(p.description),
    active: p.active !== false,
    startDate: p.date_start || null,
    dueDate: p.date || null,
  })),
  tasks: tasks.map((t) => ({
    id: t.id,
    projectId: m2o(t.project_id),
    name: t.name,
    stage: m2oName(t.stage_id),
    state: t.state ?? null,
    closed: Boolean(t.is_closed) || ["1_done", "1_canceled"].includes(t.state),
    cancelled: t.state === "1_canceled",
    assignees: (t.user_ids ?? []).map((u) => userName.get(u)).filter(Boolean),
    deadline: t.date_deadline ? String(t.date_deadline).slice(0, 10) : null,
    priority: Number(t.priority) > 0 ? 1 : 0,
    description: html(t.description),
    createdAt: t.create_date ?? null,
    doneAt: t.date_end ?? null,
    allocatedHours: t.allocated_hours ?? 0,
    active: t.active !== false,
  })),
  timesheets: timesheets.map((t) => ({
    id: t.id,
    projectId: m2o(t.project_id),
    taskId: m2o(t.task_id),
    user: m2oName(t.user_id) ?? m2oName(t.employee_id),
    date: t.date,
    hours: t.unit_amount ?? 0,
    note: text(t.name) === "/" ? null : text(t.name),
  })),
  trialBalance: [...tb.values()].map((t) => ({ accountId: t.accountId, debit: Math.round(t.debit * 100) / 100, credit: Math.round(t.credit * 100) / 100 })),
  checks: { postedLineCount, exportedPostedLines: lines.filter((l) => postedMoves.has(m2o(l.move_id))).length },
};

if (exportData.checks.postedLineCount !== exportData.checks.exportedPostedLines) {
  console.warn(`Warning: Odoo reports ${postedLineCount} posted journal items but ${exportData.checks.exportedPostedLines} were exported.`);
}
writeFileSync(out, JSON.stringify(exportData, null, 1));
console.log(
  `Wrote ${out}: ${exportData.partners.length} contacts, ${exportData.products.length} products, ${exportData.moves.length} journal entries, ` +
    `${exportData.projects.length} projects, ${exportData.tasks.length} tasks, ${exportData.timesheets.length} timesheet lines.`,
);
console.log("Upload it in Tevah under Company → Import from Odoo, then delete the file.");
