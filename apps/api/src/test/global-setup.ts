import postgres from "postgres";
import { runMigrations } from "../db/migrate.js";

/**
 * Crée (si besoin) la base de test et applique les migrations une fois pour tous les tests.
 * Variables : TEST_DATABASE_URL (défaut : postgres://task:task@127.0.0.1:5432/task_test).
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://task:task@127.0.0.1:5432/task_test";
  const admin = new URL(url);
  const dbName = admin.pathname.slice(1);
  admin.pathname = "/postgres";
  const sql = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  try {
    const exists = await sql`select 1 from pg_database where datname = ${dbName}`;
    if (exists.length === 0) await sql.unsafe(`create database "${dbName}"`);
  } finally {
    await sql.end();
  }
  await runMigrations(url);
  process.env.TEST_DATABASE_URL = url;
}
