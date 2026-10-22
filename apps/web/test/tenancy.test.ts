import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withOrg, type Db } from "@/db";
import * as schema from "@/db/schema";
import { createOrg } from "@/lib/org-setup";
import { runMigrations } from "../scripts/migrate";

/**
 * Needs a throwaway database: TEST_DATABASE_ADMIN_URL (owner) and
 * TEST_DATABASE_URL (as tevah_app). Skipped when they aren't set.
 */
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const appUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!adminUrl || !appUrl)("tenant isolation", () => {
  let adminSql: postgres.Sql;
  let appSql: postgres.Sql;
  let admin: Db;
  let app: Db;
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    adminSql = postgres(adminUrl!, { max: 1, onnotice: () => {} });
    await adminSql.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(adminUrl!, "tevah_app");
    admin = drizzle({ client: adminSql, schema });
    appSql = postgres(appUrl!, { max: 2 });
    app = drizzle({ client: appSql, schema });

    const pw = "test-password-123";
    orgA = (await createOrg(app, { name: "A", gstin: "27AAJCE3276G1ZH" }, { email: "a@test", name: "A", password: pw })).orgId;
    orgB = (await createOrg(app, { name: "B", stateCode: "29" }, { email: "b@test", name: "B", password: pw })).orgId;
    await withOrg(orgA, (tx) => tx.insert(schema.contacts).values({ orgId: orgA, kind: "customer", name: "A customer" }), app);
    await withOrg(orgB, (tx) => tx.insert(schema.contacts).values({ orgId: orgB, kind: "vendor", name: "B vendor" }), app);
  });

  afterAll(async () => {
    await appSql?.end();
    await adminSql?.end();
  });

  it("seeds each org with its own chart of accounts", async () => {
    const a = await withOrg(orgA, (tx) => tx.select().from(schema.accounts), app);
    const b = await withOrg(orgB, (tx) => tx.select().from(schema.accounts), app);
    expect(a.length).toBeGreaterThan(40);
    expect(a.every((x) => x.orgId === orgA)).toBe(true);
    expect(b.every((x) => x.orgId === orgB)).toBe(true);
  });

  it("only shows the current org's rows", async () => {
    const seenByA = await withOrg(orgA, (tx) => tx.select().from(schema.contacts), app);
    expect(seenByA.map((c) => c.name)).toEqual(["A customer"]);
  });

  it("hides even an explicitly requested row from another org", async () => {
    const [bContact] = await admin.select().from(schema.contacts).where(eq(schema.contacts.orgId, orgB));
    const rows = await withOrg(orgA, (tx) => tx.select().from(schema.contacts).where(eq(schema.contacts.id, bContact!.id)), app);
    expect(rows).toEqual([]);
    const updated = await withOrg(
      orgA,
      (tx) => tx.update(schema.contacts).set({ name: "hacked" }).where(eq(schema.contacts.id, bContact!.id)).returning(),
      app,
    );
    expect(updated).toEqual([]);
  });

  it("refuses to write a row into another org", async () => {
    await expect(
      withOrg(orgA, (tx) => tx.insert(schema.contacts).values({ orgId: orgB, kind: "customer", name: "sneaky" }), app),
    ).rejects.toThrow();
  });

  it("shows nothing when no org is set", async () => {
    expect(await app.select().from(schema.contacts)).toEqual([]);
  });
});
