import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { trialBalance } from "@tevah/core";
import { eq, like } from "drizzle-orm";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withOrg, type Db } from "@/db";
import * as schema from "@/db/schema";
import type { Session } from "@/lib/auth";
import { importOdoo, odooExport, type OdooExport } from "@/lib/odoo-import";
import { createOrg } from "@/lib/org-setup";
import { accountTotals } from "@/lib/reports";
import { freshDatabase } from "./db";
import { MOCK_KEY, startMockOdoo } from "./odoo/mock-odoo";

const run = promisify(execFile);
const script = fileURLToPath(new URL("../scripts/odoo-export.mjs", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "tevah-odoo-"));

async function exportFrom(api: "json2" | "jsonrpc"): Promise<{ data: OdooExport; calls: string[] }> {
  const mock = await startMockOdoo(api);
  try {
    const out = join(dir, `${api}.json`);
    await run("node", [script, "--url", mock.url, "--db", "test", "--user", "anup@example.com", "--out", out], { env: { ...process.env, ODOO_API_KEY: MOCK_KEY } });
    return { data: odooExport.parse(JSON.parse(readFileSync(out, "utf8"))), calls: mock.calls };
  } finally {
    await mock.close();
  }
}

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("Odoo export script", () => {
  it("reads a company over JSON-2 using only read methods, and the same over JSON-RPC", async () => {
    const json2 = await exportFrom("json2");
    expect(new Set(json2.calls.map((c) => c.split(".").pop()))).toEqual(new Set(["search_read", "fields_get", "search_count"]));
    expect(json2.data.moves.map((m) => m.name)).not.toContain("/");
    expect(json2.data.moves).toHaveLength(8);
    expect(json2.data.company).toEqual({ name: "Exaltes Global Private Limited", gstin: "27AAJCE3276G1ZH", stateCode: "27" });
    expect(json2.data.tasks.find((t) => t.name === "Archive")!.description).toBe("Move the old site");
    expect(json2.data.checks).toEqual({ postedLineCount: 19, exportedPostedLines: 19 });

    const rpc = await exportFrom("jsonrpc");
    expect({ ...rpc.data, exportedAt: "", source: {} }).toEqual({ ...json2.data, exportedAt: "", source: {} });
  });

  it("refuses a wrong API key", async () => {
    const mock = await startMockOdoo("json2");
    try {
      await expect(
        run("node", [script, "--url", mock.url, "--db", "test", "--user", "anup@example.com", "--out", join(dir, "x.json")], { env: { ...process.env, ODOO_API_KEY: "wrong" } }),
      ).rejects.toThrow(/refused the API key/);
    } finally {
      await mock.close();
    }
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("Odoo import against MySQL", () => {
  let pool: mysql.Pool;
  let db: Db;
  let session: Session;
  let data: OdooExport;

  const as = <T>(fn: Parameters<typeof withOrg<T>>[1]) => withOrg(session.orgId, fn, db);
  class Rollback extends Error {
    constructor(readonly value: unknown) {
      super("rollback");
    }
  }

  beforeAll(async () => {
    ({ data } = await exportFrom("json2"));
    ({ db, pool } = await freshDatabase(url!));
    const a = await createOrg(db, { name: "Exaltes", gstin: "27AAJCE3276G1ZH" }, { email: "anup@example.com", name: "Anup", password: "test-password-123" });
    session = { userId: a.userId, orgId: a.orgId, userName: "Anup", email: "anup@example.com", orgName: "Exaltes", orgStateCode: "27", role: "admin" };
    // Typed into Tevah before the import; the import should link to it, not add a second Acme.
    await db.insert(schema.contacts).values({ orgId: a.orgId, kind: "customer", name: "ACME Software", gstin: "29AABCA1234B1ZD", stateCode: "29" });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("previews without writing anything", async () => {
    const preview = await as(async (s) => {
      throw new Rollback(await importOdoo(s, session, data));
    }).catch((e) => (e instanceof Rollback ? (e.value as Awaited<ReturnType<typeof importOdoo>>) : Promise.reject(e)));
    expect(preview.trialBalance.matches).toBe(true);
    expect(preview.added).toMatchObject({ entries: 8, documents: 4 });
    expect(await db.select().from(schema.contacts).where(like(schema.contacts.externalRef, "odoo:%"))).toEqual([]);
  });

  it("imports the ledger so it matches Odoo's trial balance", async () => {
    const report = await as((s) => importOdoo(s, session, data));
    expect(report.trialBalance.matches).toBe(true);
    expect(report.added).toEqual({ contacts: 2, products: 2, accounts: 4, entries: 8, documents: 4, projects: 2, tasks: 4, timesheets: 2 });
    expect(report.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("Pune Hosting: GSTIN 27ABC isn't valid"), expect.stringContaining("No Tevah user named Priya Shah"), expect.stringContaining("1 Odoo contacts matched")]),
    );
    expect(report.accountMap).toEqual(
      expect.arrayContaining([
        { odoo: "100200 Debtors", tevah: "1200 Trade Receivables (Debtors)", created: false },
        { odoo: "100400 HDFC Bank", tevah: "1110 Bank Account", created: false },
        { odoo: "100700 ICICI Bank", tevah: "100700 ICICI Bank", created: true },
        { odoo: "200302 IGST Output", tevah: "2202 Output IGST", created: false },
        { odoo: "200400 TDS Payable 194J", tevah: "2300 TDS Payable", created: false },
      ]),
    );
    const tb = trialBalance(await as((s) => accountTotals(s, { to: "2027-03-31" })));
    expect(tb.balanced).toBe(true);
    const bank = tb.rows.find((r) => r.code === "1110")!;
    expect(bank.debit - bank.credit).toBe(214_000_00);
    const [icici] = await db.select().from(schema.journals).where(eq(schema.journals.name, "ICICI Bank"));
    expect(icici).toMatchObject({ code: "BNK2", type: "bank" });
  });

  it("brings invoices, bills and credit notes across with what's still owed", async () => {
    const docs = await db.select().from(schema.documents).where(eq(schema.documents.orgId, session.orgId));
    const byNumber = Object.fromEntries(docs.map((d) => [d.number, d]));
    const acmes = await db.select().from(schema.contacts).where(eq(schema.contacts.gstin, "29AABCA1234B1ZD"));
    expect(acmes).toHaveLength(1);
    const acme = acmes[0];
    expect(acme).toMatchObject({ name: "ACME Software", externalRef: "odoo:res.partner:10" });
    expect(byNumber["INV/2026/00001"]).toMatchObject({ type: "invoice", status: "posted", contactId: acme!.id, supplyType: "inter", placeOfSupply: "29", igst: 4500_00, total: 29500_00, amountPaid: 25900_00 });
    expect(byNumber["RINV/2026/00001"]).toMatchObject({ type: "credit_note", originalDocumentId: byNumber["INV/2026/00001"]!.id, amountPaid: 5900_00 });
    const bill = byNumber["BILL/2026/10/0001"]!;
    expect(bill).toMatchObject({ type: "bill", vendorReference: "PH-778", cgst: 900_00, sgst: 900_00, tdsAmount: 1000_00, total: 11800_00, amountPaid: 0 });
    expect(bill.total - bill.tdsAmount - bill.amountPaid).toBe(10800_00);
    expect(byNumber["INV/2026/00002"]!.status).toBe("cancelled");
    const lines = await db.select().from(schema.documentLines).where(eq(schema.documentLines.documentId, byNumber["INV/2026/00001"]!.id));
    expect(lines).toEqual([expect.objectContaining({ hsnSac: "998314", unit: "HRS", quantityMilli: 10_000, gstRateBps: 1800, taxable: 25000_00, igst: 4500_00 })]);
  });

  it("brings projects, tasks and time across", async () => {
    const tasks = await db.select().from(schema.tasks).where(eq(schema.tasks.orgId, session.orgId));
    const byTitle = Object.fromEntries(tasks.map((t) => [t.title, t]));
    expect(byTitle["Design ledger"]).toMatchObject({ status: "in_progress", assigneeId: session.userId, priority: 1, estimateMinutes: 240, dueDate: "2026-10-30" });
    expect(byTitle.Reports!.status).toBe("done");
    expect(byTitle["Cancelled idea"]!.status).toBe("cancelled");
    expect(byTitle.Archive).toMatchObject({ status: "todo", assigneeId: null });
    expect(byTitle.Archive!.description).toContain("Assigned in Odoo to: Priya Shah");
    const time = await db.select().from(schema.timeEntries).where(eq(schema.timeEntries.orgId, session.orgId));
    expect(time.map((t) => t.minutes).sort()).toEqual([150, 60]);
  });

  it("skips everything already imported when run again", async () => {
    const again = await as((s) => importOdoo(s, session, data));
    expect(again.added).toEqual({ contacts: 0, products: 0, accounts: 0, entries: 0, documents: 0, projects: 0, tasks: 0, timesheets: 0 });
    expect(again.alreadyImported).toBe(8);
    expect(again.trialBalance.matches).toBe(true);
  });
});
