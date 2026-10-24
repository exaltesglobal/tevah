import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A small stand-in for Odoo's external API (JSON-2 and JSON-RPC) serving a
 * made-up company, so the export script and the importer can be tested
 * together without a real Odoo. All names and numbers are invented.
 */

type Row = Record<string, unknown> & { id: number };
const m2o = (id: number | false, name = "") => (id === false ? false : [id, name]);

const states: Row[] = [
  { id: 1, code: "MH", name: "Maharashtra", l10n_in_tin: "27", country_id: m2o(104, "India") },
  { id: 2, code: "KA", name: "Karnataka", l10n_in_tin: "29", country_id: m2o(104, "India") },
];

const partner = (id: number, name: string, extra: Partial<Row> = {}): Row => ({
  id,
  name,
  display_name: name,
  vat: false,
  email: false,
  phone: false,
  mobile: false,
  street: false,
  street2: false,
  city: false,
  zip: false,
  state_id: false,
  is_company: true,
  customer_rank: 0,
  supplier_rank: 0,
  active: true,
  parent_id: false,
  type: "contact",
  ...extra,
});

const partners: Row[] = [
  partner(1, "Exaltes Global Private Limited", { vat: "27AAJCE3276G1ZH", state_id: m2o(1) }),
  partner(10, "Acme Software Pvt Ltd", { vat: "29AABCA1234B1ZD", state_id: m2o(2), customer_rank: 2, city: "Bengaluru", zip: "560001", email: "accounts@acme.example" }),
  partner(11, "Ravi Kumar", { parent_id: m2o(10, "Acme Software Pvt Ltd"), is_company: false, state_id: m2o(2) }),
  partner(20, "Pune Hosting", { vat: "27ABC", state_id: m2o(1), supplier_rank: 1 }),
  partner(30, "Walk-in customer", { state_id: m2o(1), customer_rank: 1 }),
  partner(40, "Someone never used", { is_company: false }),
];

const taxes: Row[] = [
  { id: 1, name: "GST 18%", amount: 18, amount_type: "group", type_tax_use: "sale", tax_group_id: m2o(1, "GST"), children_tax_ids: [2, 3], active: true },
  { id: 2, name: "CGST 9%", amount: 9, amount_type: "percent", type_tax_use: "none", tax_group_id: m2o(2, "CGST"), children_tax_ids: [], active: true },
  { id: 3, name: "SGST 9%", amount: 9, amount_type: "percent", type_tax_use: "none", tax_group_id: m2o(3, "SGST"), children_tax_ids: [], active: true },
  { id: 4, name: "IGST 18%", amount: 18, amount_type: "percent", type_tax_use: "sale", tax_group_id: m2o(4, "IGST"), children_tax_ids: [], active: true },
  { id: 5, name: "GST 18% (purchase)", amount: 18, amount_type: "group", type_tax_use: "purchase", tax_group_id: m2o(1, "GST"), children_tax_ids: [6, 7], active: true },
  { id: 6, name: "CGST 9% (purchase)", amount: 9, amount_type: "percent", type_tax_use: "none", tax_group_id: m2o(2, "CGST"), children_tax_ids: [], active: true },
  { id: 7, name: "SGST 9% (purchase)", amount: 9, amount_type: "percent", type_tax_use: "none", tax_group_id: m2o(3, "SGST"), children_tax_ids: [], active: true },
  { id: 8, name: "TDS 194J 10%", amount: -10, amount_type: "percent", type_tax_use: "purchase", tax_group_id: m2o(5, "TDS"), children_tax_ids: [], active: true },
];

const account = (id: number, code: string, name: string, account_type: string): Row => ({ id, code, name, account_type, active: true });
const accounts: Row[] = [
  account(1, "100200", "Debtors", "asset_receivable"),
  account(2, "200200", "Creditors", "liability_payable"),
  account(3, "100400", "HDFC Bank", "asset_cash"),
  account(4, "100500", "Cash", "asset_cash"),
  account(5, "400100", "Consulting Income", "income"),
  account(6, "500100", "Hosting Expense", "expense"),
  account(7, "200300", "CGST Output", "liability_current"),
  account(8, "200301", "SGST Output", "liability_current"),
  account(9, "200302", "IGST Output", "liability_current"),
  account(10, "100600", "CGST Input", "asset_current"),
  account(11, "100601", "SGST Input", "asset_current"),
  account(12, "200400", "TDS Payable 194J", "liability_current"),
  account(13, "300100", "Share Capital", "equity"),
  account(14, "999999", "Undistributed Profits/Losses", "equity_unaffected"),
  account(15, "100700", "ICICI Bank", "asset_cash"),
];

const journals: Row[] = [
  { id: 1, code: "INV", name: "Customer Invoices", type: "sale", default_account_id: m2o(5) },
  { id: 2, code: "BILL", name: "Vendor Bills", type: "purchase", default_account_id: m2o(6) },
  { id: 3, code: "BNK1", name: "HDFC", type: "bank", default_account_id: m2o(3) },
  { id: 4, code: "CSH1", name: "Cash", type: "cash", default_account_id: m2o(4) },
  { id: 5, code: "MISC", name: "Miscellaneous", type: "general", default_account_id: false },
  { id: 6, code: "BNK2", name: "ICICI", type: "bank", default_account_id: m2o(15) },
];

const products: Row[] = [
  { id: 100, name: "Consulting", default_code: "CONS", type: "service", list_price: 2500, standard_price: 0, l10n_in_hsn_code: "998314", taxes_id: [1], supplier_taxes_id: [], uom_id: m2o(2, "Hours"), active: true },
  { id: 101, name: "Hosting", default_code: false, type: "service", list_price: 0, standard_price: 10000, l10n_in_hsn_code: "998315", taxes_id: [], supplier_taxes_id: [5], uom_id: m2o(1, "Units"), active: true },
];

interface LineSpec {
  account: number;
  debit?: number;
  credit?: number;
  partner?: number;
  name?: string;
  display?: string;
  product?: number;
  qty?: number;
  price?: number;
  taxes?: number[];
  taxLine?: number;
}

const moves: Row[] = [];
const lines: Row[] = [];
let lineId = 1000;
function move(id: number, name: string, move_type: string, journal: number, date: string, specs: LineSpec[], extra: Partial<Row> = {}) {
  const state = (extra.state as string) ?? "posted";
  moves.push({
    id,
    name,
    move_type,
    state,
    date,
    invoice_date: move_type === "entry" ? false : date,
    invoice_date_due: false,
    partner_id: false,
    ref: false,
    journal_id: m2o(journal),
    amount_total: 0,
    amount_residual: 0,
    amount_tax: 0,
    l10n_in_state_id: false,
    l10n_in_gst_treatment: false,
    reversed_entry_id: false,
    narration: false,
    ...extra,
  });
  specs.forEach((l, i) =>
    lines.push({
      id: ++lineId,
      move_id: m2o(id, name),
      parent_state: state,
      account_id: m2o(l.account),
      partner_id: l.partner ? m2o(l.partner) : false,
      name: l.name ?? false,
      debit: l.debit ?? 0,
      credit: l.credit ?? 0,
      display_type: l.display ?? "product",
      product_id: l.product ? m2o(l.product) : false,
      quantity: l.qty ?? 0,
      price_unit: l.price ?? 0,
      discount: 0,
      tax_ids: l.taxes ?? [],
      tax_line_id: l.taxLine ? m2o(l.taxLine) : false,
      l10n_in_hsn_code: false,
      product_uom_id: false,
      sequence: i,
    }),
  );
}

move(1, "MISC/2026/04/0001", "entry", 5, "2026-04-01", [
  { account: 3, debit: 200000, name: "Capital introduced", display: "product" },
  { account: 13, credit: 200000, name: "Capital introduced", display: "product" },
]);
move(
  2,
  "INV/2026/00001",
  "out_invoice",
  1,
  "2026-08-22",
  [
    { account: 5, credit: 25000, partner: 10, product: 100, qty: 10, price: 2500, taxes: [4], name: "Consulting" },
    { account: 9, credit: 4500, partner: 10, display: "tax", taxLine: 4, name: "IGST 18%" },
    { account: 1, debit: 29500, partner: 10, display: "payment_term", name: "INV/2026/00001" },
  ],
  { partner_id: m2o(11, "Ravi Kumar"), amount_total: 29500, amount_residual: 3600, amount_tax: 4500, l10n_in_state_id: m2o(2), invoice_date_due: "2026-09-21" },
);
move(3, "BNK1/2026/00001", "entry", 3, "2026-09-01", [
  { account: 3, debit: 20000, partner: 10, name: "Acme payment" },
  { account: 1, credit: 20000, partner: 10, name: "Acme payment" },
]);
move(
  4,
  "BILL/2026/10/0001",
  "in_invoice",
  2,
  "2026-10-05",
  [
    { account: 6, debit: 10000, partner: 20, product: 101, qty: 1, price: 10000, taxes: [5, 8], name: "Hosting October" },
    { account: 10, debit: 900, partner: 20, display: "tax", taxLine: 6 },
    { account: 11, debit: 900, partner: 20, display: "tax", taxLine: 7 },
    { account: 12, credit: 1000, partner: 20, display: "tax", taxLine: 8 },
    { account: 2, credit: 10800, partner: 20, display: "payment_term" },
  ],
  { partner_id: m2o(20), amount_total: 10800, amount_residual: 10800, amount_tax: 800, ref: "PH-778" },
);
move(
  5,
  "RINV/2026/00001",
  "out_refund",
  1,
  "2026-09-10",
  [
    { account: 5, debit: 5000, partner: 10, product: 100, qty: 2, price: 2500, taxes: [4], name: "Consulting (2 hours credited)" },
    { account: 9, debit: 900, partner: 10, display: "tax", taxLine: 4 },
    { account: 1, credit: 5900, partner: 10, display: "payment_term" },
  ],
  { partner_id: m2o(10), amount_total: 5900, amount_residual: 0, amount_tax: 900, reversed_entry_id: m2o(2), l10n_in_state_id: m2o(2) },
);
move(
  6,
  "INV/2026/00002",
  "out_invoice",
  1,
  "2026-10-01",
  [
    { account: 5, credit: 1000, partner: 30, product: 100, qty: 0.4, price: 2500, taxes: [1] },
    { account: 7, credit: 90, partner: 30, display: "tax", taxLine: 2 },
    { account: 8, credit: 90, partner: 30, display: "tax", taxLine: 3 },
    { account: 1, debit: 1180, partner: 30, display: "payment_term" },
  ],
  { state: "cancel", partner_id: m2o(30), amount_total: 1180, amount_residual: 1180, l10n_in_state_id: m2o(1) },
);
move(7, "CSH1/2026/00001", "entry", 4, "2026-10-02", [
  { account: 4, debit: 5000, name: "Cash withdrawal" },
  { account: 3, credit: 5000, name: "Cash withdrawal" },
]);
move(8, "BNK2/2026/00001", "entry", 6, "2026-10-03", [
  { account: 15, debit: 1000, name: "Transfer to ICICI" },
  { account: 3, credit: 1000, name: "Transfer to ICICI" },
]);
// A draft that must not be exported.
move(9, "/", "entry", 5, "2026-10-04", [{ account: 3, debit: 1 }, { account: 13, credit: 1 }], { state: "draft" });

const projects: Row[] = [
  { id: 1, name: "Tevah build", partner_id: m2o(10), description: "<p>Our own ERP</p>", active: true, date_start: "2026-10-01", date: false },
  { id: 2, name: "Old site", partner_id: false, description: false, active: false, date_start: false, date: false },
];
const users: Row[] = [
  { id: 2, name: "Anup", login: "anup@example.com" },
  { id: 3, name: "Priya Shah", login: "priya@example.com" },
];
const task = (id: number, project: number, name: string, extra: Partial<Row>): Row => ({
  id,
  project_id: m2o(project),
  name,
  stage_id: m2o(1, "New"),
  state: "01_in_progress",
  is_closed: false,
  user_ids: [],
  date_deadline: false,
  priority: "0",
  description: false,
  create_date: "2026-10-01 10:00:00",
  date_end: false,
  active: true,
  allocated_hours: 0,
  sequence: id,
  ...extra,
});
const tasks: Row[] = [
  task(1, 1, "Design ledger", { stage_id: m2o(2, "In Progress"), user_ids: [2], priority: "1", allocated_hours: 4, date_deadline: "2026-10-30" }),
  task(2, 1, "Reports", { stage_id: m2o(3, "Done"), is_closed: true, state: "1_done" }),
  task(3, 1, "Cancelled idea", { state: "1_canceled", is_closed: true }),
  task(4, 2, "Archive", { user_ids: [3], description: "<p>Move the <b>old</b> site</p>" }),
];
const timesheets: Row[] = [
  { id: 1, project_id: m2o(1), task_id: m2o(1), user_id: m2o(2, "Anup"), employee_id: false, date: "2026-10-20", unit_amount: 2.5, name: "Ledger design" },
  { id: 2, project_id: m2o(1), task_id: false, user_id: m2o(3, "Priya Shah"), employee_id: false, date: "2026-10-21", unit_amount: 1, name: "/" },
  { id: 3, project_id: false, task_id: false, user_id: m2o(2, "Anup"), employee_id: false, date: "2026-10-21", unit_amount: 1, name: "Not a project line" },
];

const MODELS: Record<string, Row[]> = {
  "res.company": [{ id: 1, name: "Exaltes Global Private Limited", vat: "27AAJCE3276G1ZH", state_id: m2o(1) }],
  "res.country.state": states,
  "res.partner": partners,
  "product.product": products,
  "account.tax": taxes,
  "account.account": accounts,
  "account.journal": journals,
  "account.move": moves,
  "account.move.line": lines,
  "project.project": projects,
  "project.task": tasks,
  "res.users": users,
  "account.analytic.line": timesheets,
};

type Domain = [string, string, unknown][];
function matches(row: Row, domain: Domain): boolean {
  return domain.every(([field, op, value]) => {
    if (field.includes(".")) return true;
    const raw = row[field];
    const v = Array.isArray(raw) ? raw[0] : raw;
    if (op === "=") return v === value;
    if (op === "!=") return value === false ? v !== false && v != null : v !== value;
    if (op === "in") return (value as unknown[]).includes(v);
    throw new Error(`mock: unsupported operator ${op}`);
  });
}

function run(model: string, method: string, kw: Record<string, unknown>) {
  const rows = MODELS[model];
  if (!rows) return { status: 404, body: { message: `Unknown model ${model}` } };
  if (method === "fields_get") {
    const fields: Record<string, { type: string }> = {};
    for (const r of rows) for (const k of Object.keys(r)) fields[k] = { type: "char" };
    return { status: 200, body: fields };
  }
  const found = rows.filter((r) => matches(r, (kw.domain as Domain) ?? []));
  if (method === "search_count") return { status: 200, body: found.length };
  if (method === "search_read") {
    const fields = (kw.fields as string[]) ?? Object.keys(rows[0] ?? {});
    const offset = (kw.offset as number) ?? 0;
    const limit = (kw.limit as number) ?? found.length;
    return { status: 200, body: found.slice(offset, offset + limit).map((r) => Object.fromEntries([["id", r.id], ...fields.filter((f) => f in r).map((f) => [f, r[f]])])) };
  }
  return { status: 400, body: { message: `mock: method ${method} not supported` } };
}

export const MOCK_KEY = "test-api-key";

export async function startMockOdoo(api: "json2" | "jsonrpc" = "json2"): Promise<{ url: string; close: () => Promise<void>; calls: string[] }> {
  const calls: string[] = [];
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      const json2 = /^\/json\/2\/([\w.]+)\/(\w+)$/.exec(req.url ?? "");
      if (json2) {
        if (api !== "json2") return send(404, { message: "Not found" });
        if (req.headers.authorization !== `bearer ${MOCK_KEY}`) return send(401, { message: "Invalid API key" });
        calls.push(`${json2[1]}.${json2[2]}`);
        const r = run(json2[1]!, json2[2]!, JSON.parse(raw || "{}"));
        return send(r.status, r.body);
      }
      if (req.url === "/jsonrpc") {
        const { id, params } = JSON.parse(raw);
        const [db, uidOrLogin, key, model, method, positional, kw] = params.args;
        if (params.service === "common" && params.method === "authenticate") return send(200, { jsonrpc: "2.0", id, result: key === MOCK_KEY && db === "test" ? 2 : false });
        if (key !== MOCK_KEY || uidOrLogin !== 2) return send(200, { jsonrpc: "2.0", id, error: { message: "Access denied" } });
        calls.push(`${model}.${method}`);
        const r = run(model, method, { ...kw, domain: positional?.[0] ?? [] });
        return send(200, r.status === 200 ? { jsonrpc: "2.0", id, result: r.body } : { jsonrpc: "2.0", id, error: { message: JSON.stringify(r.body) } });
      }
      send(404, { message: "Not found" });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, calls, close: () => new Promise((resolve) => server.close(() => resolve())) };
}
