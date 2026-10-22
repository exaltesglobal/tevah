import { migrate } from "drizzle-orm/mysql2/migrator";
import { connect } from "../src/db";

export async function runMigrations(url: string): Promise<void> {
  const { db, pool } = connect(url, 1);
  try {
    await migrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  await runMigrations(url);
  console.log("Migrations applied");
}
