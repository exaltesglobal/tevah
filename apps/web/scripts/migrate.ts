import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Applies schema migrations as the owner role, then makes sure the app role
 * exists with data-only privileges. The app role does not own the tables, so
 * row-level security always applies to it.
 */
export async function runMigrations(adminUrl: string, appPassword: string): Promise<void> {
  const sql = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle({ client: sql }), { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
    const [role] = await sql`select 1 from pg_roles where rolname = 'tevah_app'`;
    if (!role) {
      await sql.unsafe(`create role tevah_app login password '${appPassword.replaceAll("'", "''")}'`);
    }
    await sql.unsafe(`
      grant usage on schema public to tevah_app;
      grant select, insert, update, delete on all tables in schema public to tevah_app;
      grant usage, select on all sequences in schema public to tevah_app;
      revoke all on schema drizzle from tevah_app;
    `);
  } finally {
    await sql.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is not set");
  await runMigrations(adminUrl, process.env.APP_DB_PASSWORD ?? "tevah_app");
  console.log("Migrations applied");
}
