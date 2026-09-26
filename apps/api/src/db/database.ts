import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../config/env.js";
import { seedOdishaScenario } from "./seed.js";

export type SqliteDatabase = Database.Database;

export function createDatabase(filename = config.databasePath): SqliteDatabase {
  if (filename !== ":memory:") {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }

  const db = new Database(filename);
  db.pragma("foreign_keys = ON");
  applyMigrations(db, config.migrationsDirectory);
  // Re-seed on every boot rather than only when the row is missing. The seed
  // owns all reference data (scenario, track, zones, assets) and is idempotent,
  // so this keeps a long-lived database file from serving a scenario that has
  // drifted from the code -- previously an existing row was never refreshed, so
  // a seed edit (new defaults, revised summary) silently did not take effect.
  // Simulations and advisories live in their own tables and are untouched.
  seedOdishaScenario(db);
  return db;
}

export function applyMigrations(
  db: SqliteDatabase,
  migrationsDirectory = config.migrationsDirectory,
): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const applied = db
    .prepare("SELECT filename FROM schema_migrations")
    .all() as Array<{ filename: string }>;
  const appliedFiles = new Set(applied.map(({ filename }) => filename));
  const migrationFiles = fs
    .readdirSync(migrationsDirectory)
    .filter((filename) => filename.endsWith(".sql"))
    .sort();
  const executed: string[] = [];

  for (const filename of migrationFiles) {
    if (appliedFiles.has(filename)) continue;
    const sql = fs.readFileSync(path.join(migrationsDirectory, filename), "utf8");
    const runMigration = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (filename) VALUES (?)").run(filename);
    });
    runMigration();
    executed.push(filename);
  }

  return executed;
}
