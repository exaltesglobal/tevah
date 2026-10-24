import type mysql from "mysql2/promise";
import { connect, type Db } from "@/db";
import { runMigrations } from "../scripts/migrate";

/** Empty the throwaway test database and migrate it from scratch. */
export async function freshDatabase(url: string): Promise<{ db: Db; pool: mysql.Pool }> {
  const { db, pool } = connect(url, 2);
  const [tables] = await pool.query<mysql.RowDataPacket[]>("show tables");
  await pool.query("set foreign_key_checks = 0");
  for (const t of tables) await pool.query(`drop table \`${Object.values(t)[0]}\``);
  await pool.query("set foreign_key_checks = 1");
  await runMigrations(url);
  return { db, pool };
}
