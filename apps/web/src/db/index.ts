import { and, eq, type SQL } from "drizzle-orm";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";
import mysql from "mysql2/promise";
import * as schema from "./schema";

export type Db = MySql2Database<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const globalForDb = globalThis as unknown as { tevahDb?: Db };

export function connect(url: string, connectionLimit = 10): { db: Db; pool: mysql.Pool } {
  // Dates travel as strings so DATE columns aren't shifted by the server's time zone.
  const pool = mysql.createPool({ uri: url, connectionLimit, timezone: "Z", dateStrings: ["DATE"] });
  return { db: drizzle({ client: pool, schema, mode: "default" }), pool };
}

/** Shared connection pool, created on first use (not at import, so builds need no database). */
export function getDb(): Db {
  if (!globalForDb.tevahDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForDb.tevahDb = connect(url).db;
  }
  return globalForDb.tevahDb;
}

/**
 * One org's view of the database. MySQL has no row-level security, so every
 * tenant read, update and delete must be filtered with `own(table, ...)`, and
 * every insert must carry `orgId`. The tenancy tests exercise this.
 */
export interface Scope {
  tx: Tx;
  orgId: string;
  own: (table: { orgId: AnyMySqlColumn }, ...conditions: (SQL | undefined)[]) => SQL;
}

/** Run tenant queries for one org inside a transaction. */
export async function withOrg<T>(orgId: string, fn: (s: Scope) => Promise<T>, db: Db = getDb()): Promise<T> {
  if (!orgId) throw new Error("No organisation selected");
  return db.transaction((tx) =>
    fn({ tx, orgId, own: (table, ...conditions) => and(eq(table.orgId, orgId), ...conditions)! }),
  );
}

export { schema };
