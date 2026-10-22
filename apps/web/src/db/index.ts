import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const globalForDb = globalThis as unknown as { tevahDb?: Db };

/** Shared connection pool, created on first use (not at import, so builds need no database). */
export function getDb(): Db {
  if (!globalForDb.tevahDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForDb.tevahDb = drizzle({ client: postgres(url, { max: 10 }), schema });
  }
  return globalForDb.tevahDb;
}

/**
 * Run tenant queries inside a transaction scoped to one org. Row-level
 * security reads app.org_id, so a query here can only see that org's rows.
 */
export async function withOrg<T>(orgId: string, fn: (tx: Tx) => Promise<T>, db: Db = getDb()): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    return fn(tx);
  });
}

export { schema };
