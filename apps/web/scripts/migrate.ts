import { fileURLToPath, pathToFileURL } from "node:url";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { connect } from "../src/db";

export async function runMigrations(url: string): Promise<void> {
  const { db, pool } = connect(url, 1);
  try {
    // fileURLToPath, not URL.pathname, so Windows drive letters and spaces survive.
    await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  await runMigrations(url);
  console.log("Migrations applied");
}
