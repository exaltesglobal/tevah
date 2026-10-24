import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, getTableName, is } from "drizzle-orm";
import { MySqlTable } from "drizzle-orm/mysql-core";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, withOrg, type Db } from "@/db";
import * as schema from "@/db/schema";
import { createOrg } from "@/lib/org-setup";
import { runMigrations } from "../scripts/migrate";

/** Tables holding one org's data: they have org_id and aren't the tenancy tables themselves. */
const TENANT_TABLES = Object.entries(schema)
  .filter(([, v]) => is(v, MySqlTable) && "orgId" in v)
  .map(([name]) => name)
  .filter((name) => !["memberships", "sessions"].includes(name));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

/**
 * MySQL has no row-level security, so this guards the convention instead:
 * every query that touches a tenant table must be scoped with `own(...)`
 * (reads, joins, updates, deletes) or carry `orgId` (inserts).
 */
describe("tenant scoping convention", () => {
  const src = fileURLToPath(new URL("../src", import.meta.url));
  const files = sourceFiles(src).filter((f) => !f.endsWith("db/schema.ts") && !f.endsWith("lib/org-setup.ts"));
  const tables = TENANT_TABLES.join("|");
  const query = new RegExp(`\\.(from|update|delete|leftJoin|innerJoin|insert)\\((${tables})\\b`, "g");

  it("finds the tenant tables", () => {
    expect(TENANT_TABLES).toEqual(expect.arrayContaining(["contacts", "accounts", "journalLines"]));
  });

  it("scopes every tenant query in src/", () => {
    const offences: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(query)) {
        const end = text.indexOf(";", m.index);
        const statement = text.slice(m.index, end === -1 ? undefined : end);
        const ok = m[1] === "insert" ? /orgId/.test(statement) : /own\(\s*\w+/.test(statement);
        if (!ok) {
          const line = text.slice(0, m.index).split("\n").length;
          offences.push(`${file.replace(src, "src")}:${line} ${m[0]}`);
        }
      }
    }
    expect(offences).toEqual([]);
  });
});

/** Needs a throwaway MySQL database in TEST_DATABASE_URL; skipped when it isn't set. */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("tenant isolation against MySQL", () => {
  let pool: mysql.Pool;
  let db: Db;
  let orgA: string;
  let orgB: string;
  let bContactId: string;

  beforeAll(async () => {
    ({ db, pool } = connect(url!, 2));
    const [tables] = await pool.query<mysql.RowDataPacket[]>("show tables");
    await pool.query("set foreign_key_checks = 0");
    for (const t of tables) await pool.query(`drop table \`${Object.values(t)[0]}\``);
    await pool.query("set foreign_key_checks = 1");
    await runMigrations(url!);

    const pw = "test-password-123";
    orgA = (await createOrg(db, { name: "A", gstin: "27AAJCE3276G1ZH" }, { email: "a@test.in", name: "A", password: pw })).orgId;
    orgB = (await createOrg(db, { name: "B", stateCode: "29" }, { email: "b@test.in", name: "B", password: pw })).orgId;
    await withOrg(orgA, (s) => s.tx.insert(schema.contacts).values({ orgId: s.orgId, kind: "customer", name: "A customer" }), db);
    bContactId = await withOrg(
      orgB,
      async (s) => {
        await s.tx.insert(schema.contacts).values({ orgId: s.orgId, kind: "vendor", name: "B vendor" });
        const [row] = await s.tx.select().from(schema.contacts).where(s.own(schema.contacts));
        return row!.id;
      },
      db,
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("seeds each org with its own chart of accounts", async () => {
    const a = await withOrg(orgA, (s) => s.tx.select().from(schema.accounts).where(s.own(schema.accounts)), db);
    const b = await withOrg(orgB, (s) => s.tx.select().from(schema.accounts).where(s.own(schema.accounts)), db);
    expect(a.length).toBeGreaterThan(40);
    expect(a.every((x) => x.orgId === orgA)).toBe(true);
    expect(b.every((x) => x.orgId === orgB)).toBe(true);
    expect(getTableName(schema.accounts)).toBe("accounts");
  });

  it("only shows the current org's rows", async () => {
    const seenByA = await withOrg(orgA, (s) => s.tx.select().from(schema.contacts).where(s.own(schema.contacts)), db);
    expect(seenByA.map((c) => c.name)).toEqual(["A customer"]);
  });

  it("can't read or change another org's row by id", async () => {
    const rows = await withOrg(
      orgA,
      (s) => s.tx.select().from(schema.contacts).where(s.own(schema.contacts, eq(schema.contacts.id, bContactId))),
      db,
    );
    expect(rows).toEqual([]);
    const [res] = await withOrg(
      orgA,
      (s) => s.tx.update(schema.contacts).set({ name: "hacked" }).where(s.own(schema.contacts, eq(schema.contacts.id, bContactId))),
      db,
    );
    expect(res.affectedRows).toBe(0);
    const [b] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, bContactId));
    expect(b?.name).toBe("B vendor");
  });

  it("refuses to run without an org", async () => {
    await expect(withOrg("", async () => 1, db)).rejects.toThrow(/No organisation/);
  });
});
